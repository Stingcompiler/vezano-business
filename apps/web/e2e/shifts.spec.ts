import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.11 — SHIFT-01 (5) + SHIFT-02 (5). الفتح حدث ثابت يُحفظ محلياً (IndexedDB حقيقي) ثم يُرفع؛
 * الخادم يُحاكى على مستوى الشبكة. فتح بلا اتصال ثم رفع قبل الإغلاق يُقبل (ACC-34).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const CURRENT = {
  branch_id: "b1",
  branch_name: "فرع النور",
  device_name: "كاشير 2 — ديسكتوب",
  user_name: "سالم",
  current: null,
  others_open: [],
  previous: {
    id: "s0",
    closed_at: (() => {
      const d = new Date(Date.now() - 86_400_000);
      d.setHours(20, 42, 0, 0);
      return d.toISOString();
    })(),
    user_name: "سالم",
    counted_cash_minor: "50000",
    expected_cash_at_close_minor: "50000",
  },
};

const CASH_MOVEMENT = {
  operationId: "op-cm-1",
  kind: "cash_movement",
  opVersion: 1,
  dependencies: ["op-open-1"],
  members: [
    {
      entity: "shifts.CashMovement",
      id: "m1",
      schemaVersion: 1,
      payload: {
        movement_id: "m1",
        shift_id: "s1",
        kind: "withdrawal",
        signed_amount_minor: "-40000",
        reason: "رد من الصندوق",
        actor_user_id: "u1",
        occurred_at: new Date().toISOString(),
      },
      serverSeq: null,
    },
  ],
  state: "local",
  createdLocalSeq: 2,
  snapshotRelation: "none",
};

interface SeedShift {
  readonly opState: "synced" | "local";
  readonly shiftState: "open" | "closed";
  readonly withMovement: boolean;
}

/** تسجيل الجهاز محلياً كما يتركه ACC-05 (الوردية لجهاز وفرع)، واختيارياً وردية مفتوحة منذ 4 ساعات. */
async function seedDevice(page: Page, shift: SeedShift | null = null) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ shift, openedAt, movement }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections", "operations"], "readwrite");
        tx.objectStore("meta").put({
          key: "device.registration",
          value: JSON.stringify({ deviceId: "d1", prefix: "A2", branchId: "b1" }),
        });
        tx.objectStore("meta").put({ key: "sync_epoch", value: "epoch-A" });
        if (shift) {
          tx.objectStore("projections").put({
            key: "entity:shifts.Shift:s1",
            value: {
              id: "s1",
              number: "OPEN-0091",
              branch_id: "b1",
              branch_name: "الفرع الرئيسي",
              device_id: "d1",
              device_name: "الكاشير 1",
              user_id: "u1",
              user_name: "سميرة ع.",
              opening_float_minor: "50000",
              business_date: openedAt.slice(0, 10),
              opened_at: openedAt,
              state: shift.shiftState,
              closed_at: "",
              operation_id: "op-open-1",
            },
          });
          tx.objectStore("meta").put({
            key: "shift.open",
            value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
          });
          tx.objectStore("operations").put({
            operationId: "op-open-1",
            kind: "shift_open",
            opVersion: 1,
            dependencies: [],
            members: [
              {
                entity: "shifts.ShiftOpened",
                id: "s1",
                schemaVersion: 1,
                payload: { shift_id: "s1", opening_float_minor: "50000" },
                serverSeq: null,
              },
            ],
            state: shift.opState,
            createdLocalSeq: 1,
            snapshotRelation: "none",
          });
          if (shift.withMovement) tx.objectStore("operations").put(movement);
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      shift,
      openedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
      movement: CASH_MOVEMENT,
    },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

function acceptPush(page: Page, onPush?: (n: number) => void) {
  return page.route("**/api/sync/push", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string }[];
      request_id: string;
    };
    onPush?.(body.operations.length);
    return route.fulfill(
      json(200, {
        protocol_version: 1,
        sync_epoch: "epoch-A",
        request_id: body.request_id,
        results: body.operations.map((o) => ({
          operation_id: o.operation_id,
          status: "accepted",
          member_receipts: [],
        })),
        server_seq_high: "9",
      }),
    );
  });
}

test.describe("SHIFT-01", () => {
  test("ready: تُفتح بعدٍّ — الوردية السابقة وما تركته، والوردية والفرع والجهاز", async ({
    page,
  }, info) => {
    await seedDevice(page);
    await page.route("**/api/shifts/current**", (route) => route.fulfill(json(200, CURRENT)));
    await login(page, "/shifts/open");
    await expectFrame(page, info, {
      screenId: "SHIFT-01",
      state: "ready",
      texts: fromFrame("SHIFT-01", "ready", [
        "فتح وردية",
        "الوردية السابقة أُقفلت",
        "أمس",
        "سالم",
        "ما تركته في الدرج",
        "500.00",
        "ما تعدّه الآن في الدرج",
        "إلزامي",
        "الوردية والفرع والجهاز",
        "الفرع",
        "فرع النور",
        "الجهاز",
        "كاشير 2 — ديسكتوب",
        "المسؤول",
        "المعدود يطابق ما تركته الوردية السابقة. لو اختلف فليس خطأً يمنع الفتح — يُسجَّل الفارق باسم من عدّ ويُراجَع في SHIFT-05، والبيع يبدأ الآن.",
        "افتح الوردية وابدأ البيع",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator(".shift-prev")).toContainText("أمس 08:42 م · سالم");
  });

  test("validation_error: عدٌّ بلا رقم — الفراغ ليس صفراً والصفر يُدخَل صراحةً", async ({
    page,
  }, info) => {
    await seedDevice(page);
    await page.route("**/api/shifts/current**", (route) => route.fulfill(json(200, CURRENT)));
    await login(page, "/shifts/open");
    await page.getByRole("button", { name: "افتح الوردية وابدأ البيع" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-01",
      state: "validation_error",
      texts: fromFrame("SHIFT-01", "validation_error", [
        "عدٌّ بلا رقم",
        "محاولة الفتح والحقل فارغ. الفراغ ليس صفراً: «لم أعدّ» تختلف عن «الدرج فارغ».",
        "الصفر يُدخَل صراحةً",
        "درجٌ فارغ حالةٌ مشروعة تُكتب 0.00. والحقل الفارغ يُعلَّم ولا يُحسب صفراً بالنيابة.",
      ]),
    });
    await expect(page.getByLabel("ما تعدّه الآن في الدرج")).toHaveAttribute("aria-invalid", "true");
    // الصفر الصريح يُقبل
    await acceptPush(page);
    await page.getByLabel("ما تعدّه الآن في الدرج").fill("0.00");
    await page.getByRole("button", { name: "افتح الوردية وابدأ البيع" }).click();
    await expect(page.locator('[data-screen="SHIFT-01"][data-state="success"]')).toBeVisible();
    await expect(page.locator(".shift-facts")).toContainText("0.00");
  });

  test("success: الوردية مفتوحة — رقمها ووقتها والمعدود باسم من عدّ، والمسار الواحد نقطة البيع", async ({
    page,
  }, info) => {
    await seedDevice(page);
    await page.route("**/api/shifts/current**", (route) => route.fulfill(json(200, CURRENT)));
    let pushed = 0;
    await acceptPush(page, (n) => (pushed += n));
    await login(page, "/shifts/open");
    await page.getByLabel("ما تعدّه الآن في الدرج").fill("500");
    await page.getByRole("button", { name: "افتح الوردية وابدأ البيع" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-01",
      state: "success",
      texts: fromFrame("SHIFT-01", "success", [
        "الوردية مفتوحة",
        "رقمها ووقتها والمعدود الافتتاحي باسم من عدّ. والمسار الواحد: نقطة البيع.",
        "شهادة الفتح",
        "500.00",
      ]),
    });
    expect(pushed).toBe(1);
    await expect(page.locator(".shift-facts")).toContainText("OPEN-0001");
    await expect(page.getByRole("link", { name: "نقطة البيع" })).toHaveAttribute("href", "/pos");
  });

  test("offline → saved_local: تُفتح محلياً ويعمل البيع، وتُرفع عند عودة الاتصال (ACC-34)", async ({
    page,
    context,
  }, info) => {
    await seedDevice(page);
    await page.route("**/api/shifts/current**", (route) => route.fulfill(json(200, CURRENT)));
    await login(page, "/shifts/open");
    await expect(page.locator('[data-screen="SHIFT-01"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "SHIFT-01",
      state: "offline",
      texts: fromFrame("SHIFT-01", "offline", [
        "لا اتصال بالخادم الآن. تُفتح الوردية محلياً ويعمل البيع كاملاً، وتُرفع مع عملياتها عند عودة الاتصال.",
        "ما تعدّه الآن في الدرج",
        "الفرع",
        "الجهاز",
        "المسؤول",
      ]),
    });
    await page.getByLabel("ما تعدّه الآن في الدرج").fill("500");
    await page.getByRole("button", { name: "افتح الوردية وابدأ البيع" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-01",
      state: "saved_local",
      texts: fromFrame("SHIFT-01", "saved_local", [
        "فُتحت بلا اتصال",
        "الوردية مفتوحة على الجهاز والبيع يعمل. تُرفع عند عودة الشبكة.",
        "شهادة الفتح",
      ]),
    });
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    // العملية محفوظة محلياً بحالة local وتنتظر الرفع
    const local = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const rows = await new Promise<unknown[]>((res) => {
        const r = db.transaction("operations").objectStore("operations").getAll();
        r.onsuccess = () => res(r.result as unknown[]);
      });
      db.close();
      return rows as { kind: string; state: string }[];
    });
    expect(local.filter((o) => o.kind === "shift_open").map((o) => o.state)).toEqual(["local"]);
  });
});

test.describe("SHIFT-02", () => {
  test("ready: وردية سميرة — 4 ساعات، المتوقَّع معروض، والحركات مؤكدة", async ({ page }, info) => {
    await seedDevice(page, { opState: "synced", shiftState: "open", withMovement: false });
    await page.route("**/api/shifts/s1", (route) => route.fulfill(json(200, { id: "s1" })));
    await login(page, "/shifts/current");
    await expectFrame(page, info, {
      screenId: "SHIFT-02",
      state: "ready",
      texts: fromFrame("SHIFT-02", "ready", [
        "وردية مفتوحة منذ",
        "الكاشير 1 · الفرع الرئيسي",
        "النقد المتوقع في الدرج",
        "افتتاح الدرج",
        "مبيعات نقدية",
        "سدادات نقدية",
        "صرف من الصندوق",
        "الوقت والمستند",
        "البيان",
        "داخل الصندوق",
        "خارج الصندوق",
        "المزامنة",
        "سميرة ع.",
      ]),
      styles: [[".shift-expected", "background-color", "color.amber.50"]],
    });
    await expect(page.locator('[data-screen="SHIFT-02"]')).toContainText("OPEN-0091");
    await expect(page.locator('[data-screen="SHIFT-02"]')).toContainText("مؤكد");
    await expect(page.locator(".cat-head__title")).toContainText("وردية سميرة ع. — 4 ساعات");
    await expect(page.locator(".shift-expected__v")).toHaveText("500.00");
  });

  test("pending_sync: يشمل حركة معلقة من هذا الجهاز — والمرتجع النقدي يخرج من الصندوق", async ({
    page,
  }, info) => {
    await seedDevice(page, { opState: "synced", shiftState: "open", withMovement: true });
    await page.route("**/api/shifts/s1", (route) => route.fulfill(json(200, { id: "s1" })));
    await login(page, "/shifts/current");
    await expectFrame(page, info, {
      screenId: "SHIFT-02",
      state: "pending_sync",
      texts: fromFrame("SHIFT-02", "pending_sync", [
        "النقد المتوقع في الدرج",
        "معلّق",
        "رد من الصندوق",
        "صرف من الصندوق",
      ]),
    });
    await expect(page.locator('[data-screen="SHIFT-02"]')).toContainText("مؤكد");
    await expect(page.locator(".shift-expected__note")).toContainText(
      "يشمل حركة معلقة واحدة من هذا الجهاز",
    );
    await expect(page.locator(".shift-expected__v")).toHaveText("100.00");
    await expect(page.locator(".shift-totals")).toContainText("400.00");
  });

  test("loading: جلب الوردية — من الجهاز فوراً ثم تُطابَق (الأرقام المحلية معروضة)", async ({
    page,
  }, info) => {
    await seedDevice(page, { opState: "synced", shiftState: "open", withMovement: false });
    await page.route("**/api/shifts/s1", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill(json(200, { id: "s1" }));
    });
    await login(page, "/shifts/current");
    // الأرقام المحلية تُقرأ من Dexie بعد ظهور الجذر بلحظة — ننتظرها قبل فحص الإطار
    await expect(page.locator('[data-screen="SHIFT-02"]')).toContainText("النقد المتوقع في الدرج");
    await expectFrame(page, info, {
      screenId: "SHIFT-02",
      state: "loading",
      texts: fromFrame("SHIFT-02", "loading", [
        "جلب الوردية",
        "من الجهاز فوراً ثم تُطابَق.",
        "النقد المتوقع في الدرج",
      ]),
    });
    await expect(page.locator('[data-screen="SHIFT-02"]')).toContainText("OPEN-0091");
    await expect(page.locator('[data-screen="SHIFT-02"][data-state="ready"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".shift-expected__note")).toContainText("مطابَق مع الخادم");
  });

  test("offline: الوردية تعمل بلا اتصال — والحدّ المُعلن", async ({ page, context }, info) => {
    await seedDevice(page, { opState: "synced", shiftState: "open", withMovement: false });
    await page.route("**/api/shifts/s1", (route) => route.fulfill(json(200, { id: "s1" })));
    await login(page, "/shifts/current");
    await expect(page.locator('[data-screen="SHIFT-02"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "SHIFT-02",
      state: "offline",
      texts: fromFrame("SHIFT-02", "offline", [
        "الوردية تعمل بلا اتصال",
        "الأرقام كاملة لما بيع على هذا الجهاز.",
        "الحدّ المُعلن",
        "لو كان الفرع بجهازين فأرقام الآخر لا تظهر حتى تعود الشبكة",
        "النقد المتوقع في الدرج",
      ]),
    });
    await context.setOffline(false);
  });

  test("stale: مقفلة محلياً — أرقامها نهائية عندك ومعلّقة عند الخادم", async ({ page }, info) => {
    await seedDevice(page, { opState: "local", shiftState: "closed", withMovement: false });
    await page.route("**/api/shifts/s1", (route) => route.fulfill(json(200, { id: "s1" })));
    await login(page, "/shifts/current?id=s1");
    await expectFrame(page, info, {
      screenId: "SHIFT-02",
      state: "stale",
      texts: fromFrame("SHIFT-02", "stale", [
        "مقفلة · معلّقة الرفع",
        "أُقفلت محلياً وتُرفع عند المزامنة — الأرقام نهائية عندك لا عند الخادم",
      ]),
    });
  });
});
