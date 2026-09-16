import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.12 — SHIFT-03 (4) + SHIFT-04 (5). حركة الصندوق والإقفال أحداث محلية (IndexedDB حقيقي) تُرفع
 * عند الاتصال؛ الخادم يُحاكى على مستوى الشبكة. المتوقَّع محجوب حتى يُدخل المعدود: لا في DOM ولا في
 * الشبكة (ACC-67).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface Seed {
  readonly openingMinor: string;
  readonly withPendingCard?: boolean;
}

/** جهاز مسجّل ووردية مفتوحة منذ 4 ساعات (حدثها مؤكد) باسم سالم. */
async function seed(page: Page, s: Seed) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ s, openedAt }) => {
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
        tx.objectStore("meta").put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "فرع النور",
            deviceId: "d1",
            deviceName: "كاشير 2",
            userId: "u1",
            userName: "سالم",
            roleName: "الكاشير",
            canWithdraw: false,
            ownerName: "ندى",
          }),
        });
        tx.objectStore("projections").put({
          key: "entity:shifts.Shift:s1",
          value: {
            id: "s1",
            number: "OPEN-0091",
            branch_id: "b1",
            branch_name: "فرع النور",
            device_id: "d1",
            device_name: "كاشير 2",
            user_id: "u1",
            user_name: "سالم",
            opening_float_minor: s.openingMinor,
            business_date: openedAt.slice(0, 10),
            opened_at: openedAt,
            state: "open",
            closed_at: "",
            operation_id: "op-open-1",
          },
        });
        if (s.withPendingCard)
          tx.objectStore("projections").put({
            key: "entity:shifts.PendingCard:s1",
            value: { count: 3, amount_minor: "64000" },
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
              payload: { shift_id: "s1", opening_float_minor: s.openingMinor },
              serverSeq: null,
            },
          ],
          state: "synced",
          createdLocalSeq: 1,
          snapshotRelation: "none",
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { s, openedAt: new Date(Date.now() - 4 * 3_600_000).toISOString() },
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

function current(canWithdraw: boolean) {
  return {
    branch_id: "b1",
    branch_name: "فرع النور",
    device_name: "كاشير 2",
    user_name: "سالم",
    role_name: canWithdraw ? "مالك" : "الكاشير",
    can_withdraw: canWithdraw,
    owner_name: "ندى",
    current: { id: "s1" },
    others_open: [],
    previous: null,
  };
}

function acceptPush(page: Page, onPush?: (ops: { kind: string }[]) => void) {
  return page.route("**/api/sync/push", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string; kind: string }[];
      request_id: string;
    };
    onPush?.(body.operations);
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

test.describe("SHIFT-03", () => {
  test("ready: الرصيد الحالي والوردية والأنواع الثلاثة والسبب إلزامي — وحركات الوردية", async ({
    page,
  }, info) => {
    await seed(page, { openingMinor: "243000" });
    await page.route("**/api/shifts/current**", (route) => route.fulfill(json(200, current(true))));
    await login(page, "/shifts/movements");
    await expectFrame(page, info, {
      screenId: "SHIFT-03",
      state: "ready",
      texts: fromFrame("SHIFT-03", "ready", [
        "حركة صندوق",
        "الرصيد الحالي",
        "2,430.00",
        "وردية مفتوحة",
        "سالم · منذ 4 س",
        "إيداع",
        "سحب",
        "مصروف",
        "المبلغ",
        "السبب",
        "إلزامي",
        "وبوقتها، وتظهر في تسوية الوردية بنداً مستقلاً عن البيع. السبب يُقرأ بعد شهر في تقرير المصروفات — فاكتبه لمن يقرأ لا لمن يعرف.",
        "سجّل الحركة",
        "حركات الوردية",
        "البيع لا يظهر هنا — له سجلّه",
        "الحركة والسبب",
        "من ومتى",
        "إيداع افتتاحي",
        "عهدة بداية الوردية",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator(".c-table, table").first()).toContainText("+2,430.00");
  });

  test("validation_error: خطآن يمنعان التسجيل — السحب يتجاوز الرصيد وسبب من كلمة واحدة", async ({
    page,
  }, info) => {
    await seed(page, { openingMinor: "243000" });
    await page.route("**/api/shifts/current**", (route) => route.fulfill(json(200, current(true))));
    await login(page, "/shifts/movements");
    await page.getByRole("button", { name: "سحب", exact: true }).click();
    await page.getByLabel("المبلغ").fill("3000");
    await page.getByLabel("السبب").fill("مصروف");
    await page.getByRole("button", { name: "سجّل الحركة" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-03",
      state: "validation_error",
      texts: fromFrame("SHIFT-03", "validation_error", [
        "خطآن يمنعان التسجيل",
        "المبلغ",
        "السحب يتجاوز الرصيد بـ",
        ". الصندوق لا يصير سالباً بحركة يدوية — وإن كان فيه نقص فهو فرقُ عدّ يُراجَع في SHIFT-05، لا سحبٌ يُسجَّل هنا.",
        "السبب",
        "«مصروف» يعيد اسم النوع ولا يقول شيئاً. من يقرأ التقرير بعد شهر يحتاج: على ماذا، ولمن، وبأيّ إيصال.",
        "المبلغ يبقى كما كُتب والمؤشّر يذهب إلى السبب. لا نمسح رقماً صحيح الصياغة لأن قيمته كبيرة.",
      ]),
    });
    await expect(page.locator(".cat-errors")).toContainText("السحب يتجاوز الرصيد بـ570.00");
    await expect(page.getByLabel("المبلغ")).toHaveValue("3000");
    await expect(page.getByLabel("السبب")).toBeFocused();
  });

  test("permission_denied: الكاشير يودع ولا يسحب — الزرّ ظاهر بسببه، و«اطلب من ندى»", async ({
    page,
  }, info) => {
    await seed(page, { openingMinor: "243000" });
    await page.route("**/api/shifts/current**", (route) =>
      route.fulfill(json(200, current(false))),
    );
    const requests: unknown[] = [];
    await page.route("**/api/shifts/s1/requests", (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill(
        json(201, {
          id: "rq1",
          shift_id: "s1",
          kind: "withdrawal",
          amount_minor: "100000",
          reason: "توريد للخزنة الرئيسية",
          status: "pending",
          requested_by_name: "سالم",
          owner_name: "ندى",
        }),
      );
    });
    await login(page, "/shifts/movements");
    await page.getByLabel("المبلغ").fill("1000");
    await page.getByLabel("السبب").fill("توريد للخزنة الرئيسية");
    // الزرّ معطّل دلالياً (aria-disabled) لكنه يستجيب ليُظهر السبب والمخرج
    await page.getByRole("button", { name: "سحب", exact: true }).dispatchEvent("click");
    await expectFrame(page, info, {
      screenId: "SHIFT-03",
      state: "permission_denied",
      texts: fromFrame("SHIFT-03", "permission_denied", [
        "الكاشير يودع ولا يسحب",
        "الإيداع والمصروف مفتوحان ل",
        "والسحب للمالك وحده — لأنه يُخرج النقد من دورة المحل إلى خارجها.",
        "المخرج الحاضر",
        "الحركة تُنسب لمن أذن بها لا لمن أدخلها، وكلاهما مذكور في السطر.",
        "اطلب من ندى",
      ]),
    });
    await expect(page.getByRole("button", { name: "سحب", exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("button", { name: "سجّل الحركة" })).toBeDisabled();
    await page.getByRole("button", { name: "اطلب من ندى" }).click();
    await expect(page.locator(".c-notice")).toContainText("أُرسل الطلب إلى ندى");
    expect(requests[0]).toEqual({
      kind: "withdrawal",
      amount_minor: "100000",
      reason: "توريد للخزنة الرئيسية",
    });
  });

  test("success: سُجّلت الحركة — الرصيد الجديد والرقم والاسم والوقت، ثم العكس بحركة مضادّة", async ({
    page,
  }, info) => {
    await seed(page, { openingMinor: "243000" });
    await page.route("**/api/shifts/current**", (route) => route.fulfill(json(200, current(true))));
    const pushed: string[] = [];
    await acceptPush(page, (ops) => pushed.push(...ops.map((o) => o.kind)));
    await login(page, "/shifts/movements");
    await page.getByRole("button", { name: "مصروف", exact: true }).click();
    await page.getByLabel("المبلغ").fill("300");
    await page.getByLabel("السبب").fill("شراء أكياس وأشرطة تغليف من محل الهدى");
    await page.getByRole("button", { name: "سجّل الحركة" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-03",
      state: "success",
      texts: fromFrame("SHIFT-03", "success", [
        "سُجّلت الحركة",
        "مسجّل. الرصيد",
        "، والحركة رقم",
        "باسم سالم في",
        "شراء أكياس وأشرطة تغليف من محل الهدى",
        "اعكس هذه الحركة",
      ]),
    });
    const notice = page.locator(".c-notice");
    await expect(notice).toContainText("مصروف 300.00 مسجّل. الرصيد 2,130.00، والحركة رقم 101");
    await expect(page.locator(".shift-expected__v")).toHaveText("2,130.00");
    expect(pushed).toEqual(["cash_movement"]);
    // العكس: الأصل يبقى مشطوباً والحركة المضادّة تشير إليه
    await page.getByRole("button", { name: "اعكس هذه الحركة" }).click();
    await expect(page.locator(".shift-expected__v")).toHaveText("2,430.00");
    const table = page.locator("table").first();
    await expect(table).toContainText("مصروف — معكوس");
    await expect(table).toContainText("عُكس بحركة 102");
    await expect(table).toContainText("عكس مصروف 101");
    await expect(page.locator(".cat-foot")).toContainText(
      "الحركة المعكوسة تبقى ومعها الأصلية مشطوبةً لا محذوفة.",
    );
    expect(pushed).toEqual(["cash_movement", "cash_movement"]);
  });
});

async function fillDenominations(page: Page, counts: Record<string, string>) {
  for (const [face, n] of Object.entries(counts)) {
    await page.locator(`.shift-denom[data-face="${face}"] input`).fill(n);
  }
}
/** الفئات كما في الإطار: 2×500 + 9×100 + 6×50 + 15×10 + 6×5 + 5×1 = 2,385.00 */
const FRAME_COUNT = {
  "50000": "2",
  "10000": "9",
  "5000": "6",
  "1000": "15",
  "500": "6",
  "100": "5",
};

test.describe("SHIFT-04", () => {
  test("ready: العدّ يسبق الرقم — المتوقَّع لا في DOM ولا في الشبكة قبل التأكيد (ACC-67)", async ({
    page,
  }, info) => {
    await seed(page, { openingMinor: "243000" });
    let shiftRequests = 0;
    await page.route("**/api/shifts/**", (route) => {
      shiftRequests += 1;
      return route.fulfill(json(200, {}));
    });
    await login(page, "/shifts/close");
    await fillDenominations(page, FRAME_COUNT);
    await expectFrame(page, info, {
      screenId: "SHIFT-04",
      state: "ready",
      texts: fromFrame("SHIFT-04", "ready", [
        "عدّ صندوق وردية سالم",
        "عدّ الفئات",
        "العدد × الفئة",
        "المعدود",
        "2,385.00",
        "المتوقَّع محجوب.",
        "يظهر بعد تأكيد العدّ، ومعه الفارق. الترتيب هو الضمانة — لا رسالة تحذير ولا سياسة مكتوبة.",
        "أكّد العدّ واعرض الفارق",
      ]),
      styles: [[".shift-hidden", "background-color", "color.amber.50"]],
    });
    for (const v of ["1,000.00", "900.00", "300.00", "150.00", "30.00", "5.00"])
      await expect(page.locator(".shift-denoms")).toContainText(v);
    const html = await page.content();
    expect(html).not.toContain("2,430.00");
    expect(html).not.toContain("243000");
    expect(shiftRequests).toBe(0);
  });

  test("validation_error: عدٌّ غير مكتمل — ثلاث فئات فارغة والمعدود لا يُجمع", async ({
    page,
  }, info) => {
    await seed(page, { openingMinor: "243000" });
    await login(page, "/shifts/close");
    await fillDenominations(page, { "50000": "2", "10000": "9", "5000": "6" });
    await expect(page.locator(".shift-denoms__total")).toContainText("—");
    await page.getByRole("button", { name: "أكّد العدّ واعرض الفارق" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-04",
      state: "validation_error",
      texts: fromFrame("SHIFT-04", "validation_error", [
        "عدٌّ غير مكتمل",
        "فئات تُركت فارغة والإقفال مطلوب. الفراغ ليس صفراً: «لم أعدّ» تختلف عن «عددتُ فوجدتُ صفراً».",
        "نفرّق بينهما",
        "كل فئة تحتاج إدخالاً صريحاً ولو كان صفراً. الحقل الفارغ يُعلَّم ولا يُحسب صفراً بالنيابة.",
        "لا نجمع الناقص",
        "لا نعرض «المعدود» ما دامت فئة بلا إدخال — مجموعٌ ناقص يُقرأ كاملاً ويُبنى عليه الفارق.",
      ]),
    });
    await expect(page.locator(".c-notice")).toContainText("3 فئات تُركت فارغة");
    await expect(page.locator('.shift-denom[data-face="1000"] input')).toBeFocused();
    await expect(page.locator('.shift-denom[data-face="50000"] input')).toHaveValue("2");
    expect(await page.content()).not.toContain("2,430.00");
  });

  test("success: أُقفلت الوردية — المعدود والمتوقَّع والفارق نقصاً، وشهادة العدّ", async ({
    page,
  }, info) => {
    await seed(page, { openingMinor: "243000" });
    const pushed: string[] = [];
    await acceptPush(page, (ops) => pushed.push(...ops.map((o) => o.kind)));
    await login(page, "/shifts/close");
    await fillDenominations(page, FRAME_COUNT);
    await page.getByRole("button", { name: "أكّد العدّ واعرض الفارق" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-04",
      state: "success",
      texts: fromFrame("SHIFT-04", "success", [
        "أُقفلت الوردية",
        "المعدود",
        "2,385.00",
        "المتوقَّع",
        "الفارق",
        "نقصاً.",
        "يُسجَّل باسم الوردية لا باسم سالم شخصياً، ولا يُطالَب به تلقائياً. الفارق واقعةٌ تُراجَع في SHIFT-05، والمطالبة قرار إنسان لا نتيجة حساب.",
        "شهادة العدّ",
        "عدَّ",
        "سالم — الكاشير",
        "الوقت",
        "الصيغة",
        "مقفلة بشهادة الكاشير",
        "اطبع الشهادة",
        "افتح وردية جديدة",
      ]),
      styles: [[".cat-counter--bad", "background-color", "color.red.50"]],
    });
    expect(pushed).toEqual(["shift_close"]);
    await expect(page.locator(".cat-counters")).toContainText("2,430.00");
    await expect(page.locator(".cat-counters")).toContainText("−45.00");
    await expect(page.locator(".cat-saving__note")).toContainText("فارق 45.00 نقصاً.");
  });

  test("saved_local: العدّ محفوظ بلا اتصال — المتوقَّع محلي والفارق احتمال لا حكم", async ({
    page,
    context,
  }, info) => {
    await seed(page, { openingMinor: "243000" });
    await login(page, "/shifts/close");
    await expect(page.locator('[data-screen="SHIFT-04"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await fillDenominations(page, FRAME_COUNT);
    await page.getByRole("button", { name: "أكّد العدّ واعرض الفارق" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-04",
      state: "saved_local",
      texts: fromFrame("SHIFT-04", "saved_local", [
        "العدّ محفوظ بلا اتصال",
        "المتوقَّع محسوب محلياً — قد تنقصه مبيعات أجهزة أخرى",
        "الفارق المعروض احتمال لا حكم.",
        "الشهادة",
        "تُحفظ بالعدّ وبوقته وباسم من عدّ. هذه وقائع لا تحتاج شبكة، والفارق وحده هو المؤجَّل.",
        "شهادة العدّ",
      ]),
    });
    await context.setOffline(false);
    // الإقفال محفوظ محلياً بحالة local ومعه العدّ (عضوان)
    const ops = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const rows = await new Promise<unknown[]>((res) => {
        const r = db.transaction("operations").objectStore("operations").getAll();
        r.onsuccess = () => res(r.result as unknown[]);
      });
      db.close();
      return rows as { kind: string; state: string; members: { entity: string }[] }[];
    });
    const close = ops.find((o) => o.kind === "shift_close");
    expect(close?.state).toBe("local");
    expect(close?.members.map((m) => m.entity).sort()).toEqual([
      "shifts.CashCounted",
      "shifts.ShiftClosed",
    ]);
  });

  test("partial: النقد عُدّ والبطاقة لم تُسوَّ — مقفلة نقداً · بطاقة معلّقة", async ({
    page,
  }, info) => {
    await seed(page, { openingMinor: "243000", withPendingCard: true });
    await acceptPush(page);
    await login(page, "/shifts/close");
    await fillDenominations(page, FRAME_COUNT);
    await page.getByRole("button", { name: "أكّد العدّ واعرض الفارق" }).click();
    await expectFrame(page, info, {
      screenId: "SHIFT-04",
      state: "partial",
      texts: fromFrame("SHIFT-04", "partial", [
        "النقد عُدّ والبطاقة لم تُسوَّ",
        "نُقفل النقد",
        "شهادة عدّ النقد تُسجَّل الآن باسم من عدّ",
        "نُبقي البطاقة",
        "بند مفتوح موسوم «بانتظار كشف المزوّد»",
        "ويُسوّى في SHIFT-05 حين يصل. الوردية «مقفلة نقداً · بطاقة معلّقة».",
      ]),
    });
    await expect(page.locator(".c-notice")).toContainText("3 حركة بمبلغ 640.00");
  });
});
