import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.21 — السيناريو الموحَّد (القسم ٤ المرحلة ١ بند 5؛ ACC-08، ACC-13): بيع ١٠٠ = ٤٠ نقداً + ٦٠ آجلاً
 * بلا اتصال، ثم الأرقام نفسها في POS-07 (الوجهات الثلاث)، وSHIFT-02 (40 في الصندوق و60 خارجه)،
 * ورصيد الطرف المركّب في POS-06 (120 + 60 = 180 — نائب PTY-05 حتى T1.24)، وPOS-09 (الفاتورة 100
 * بوضع مزامنتها)؛ ثم عودة الاتصال والرفع — والأرقام لا تتغيّر، تتغيّر شارات المزامنة فقط.
 * مقارنةً بسلوك `48-Sting-App`: الحفظ محلياً أولاً، والصندوق والكشف من الحفظ نفسه لا من المزامنة.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const TEA = {
  id: "l1",
  item_id: "i2",
  item_name: "شاي أسود 250غ",
  unit_id: "u-pack",
  unit_code: "عبوة",
  unit_name: "عبوة",
  factor_milli: "1000",
  decimal_places: 0,
  qty_milli: "1000",
  unit_price_minor: "10000",
};

async function seed(page: Page) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ openedAt, tea }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections", "operations"], "readwrite");
        const meta = tx.objectStore("meta");
        const proj = tx.objectStore("projections");
        const ops = tx.objectStore("operations");
        meta.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d1",
            prefix: "A2",
            branchId: "b1",
            branchCode: "KRT",
          }),
        });
        meta.put({ key: "sync_epoch", value: "epoch-A" });
        meta.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الفرع الرئيسي",
            branchCode: "KRT",
            deviceId: "d1",
            deviceName: "كاشير 2",
            devicePrefix: "A2",
            userId: "u1",
            userName: "سميرة ع.",
            roleName: "كاشير",
            roleCode: "cashier",
          }),
        });
        meta.put({ key: "inventory.balances_as_of", value: openedAt });
        meta.put({
          key: "pos.cart",
          value: JSON.stringify({
            lines: [tea],
            customer: { id: "p1", name: "أحمد الطيب — تجريبي" },
            updated_at: openedAt,
          }),
        });
        meta.put({
          key: "shift.open",
          value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
        });
        proj.put({
          key: "entity:shifts.Shift:s1",
          value: {
            id: "s1",
            number: "OPEN-0091",
            branch_id: "b1",
            branch_name: "الفرع الرئيسي",
            device_id: "d1",
            device_name: "كاشير 2",
            user_id: "u1",
            user_name: "سميرة ع.",
            opening_float_minor: "184000",
            business_date: openedAt.slice(0, 10),
            opened_at: openedAt,
            state: "open",
            closed_at: "",
            operation_id: "op-open-1",
          },
        });
        ops.put({
          operationId: "op-open-1",
          kind: "shift_open",
          opVersion: 1,
          dependencies: [],
          members: [],
          state: "synced",
          createdLocalSeq: 1,
          snapshotRelation: "none",
        });
        // الطرف بلقطة خادمية 120.00 حتى `balance_as_of` — ما بعدها يُركَّب فوقها (ACC-02)
        proj.put({
          key: "entity:parties.Party:p1",
          value: {
            id: "p1",
            name: "أحمد الطيب — تجريبي",
            name_normalized: "احمد الطيب — تجريبي",
            phone: "0912555447",
            credit_limit_minor: "50000",
            is_customer: true,
            is_supplier: false,
            distinct_from_id: "",
            balance_minor: "12000",
            balance_as_of: openedAt,
            last_sale_at: "",
            is_active: true,
            deactivated_at: "",
            updated_at: openedAt,
          },
        });
        proj.put({
          key: "entity:inventory.Balance:i2",
          value: { item_id: "i2", qty_milli: "6000", as_of: openedAt },
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { openedAt: new Date(Date.now() - 60_000).toISOString(), tea: TEA },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/catalog/balances**", (route) =>
    route.fulfill(json(200, { branch_id: "b1", as_of: new Date().toISOString(), balances: [] })),
  );
  await page.route("**/api/shifts/s1", (route) => route.fulfill(json(200, { id: "s1" })));
  await page.route("**/api/sales?**", (route) =>
    route.fulfill(
      json(200, {
        scope: "device",
        can_all_branches: false,
        can_totals: false,
        can_decide: false,
        role_name: "كاشير",
        branch_name: "الفرع الرئيسي",
        as_of: new Date().toISOString(),
        range: "today",
        rows: [],
        totals: null,
        last_sale_at: "",
      }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

/** الخادم يقبل كل ما يُرفع — ويُحصى ما وصل. */
function pushRoute(page: Page, seen: { kind: string }[], gate: { open: boolean }) {
  return page.route("**/api/sync/push", async (route) => {
    // قبل عودة الاتصال فعلياً لا يصل شيء إلى الخادم
    if (!gate.open) return route.abort("internetdisconnected");
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string; kind: string }[];
      request_id: string;
    };
    seen.push(...body.operations);
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

/** يعيد السلة نفسها (شاي 100 على أحمد) ليُقرأ الرصيد المركّب في POS-06 — نائب PTY-05. */
async function reseedCart(page: Page) {
  await page.evaluate(async (tea) => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
    await new Promise<void>((res) => {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({
        key: "pos.cart",
        value: JSON.stringify({
          lines: [tea],
          customer: { id: "p1", name: "أحمد الطيب — تجريبي" },
          updated_at: new Date().toISOString(),
        }),
      });
      tx.oncomplete = () => res();
    });
    db.close();
  }, TEA);
}

const nav = (page: Page, name: string) => page.getByRole("link", { name }).click();

/** الأرقام الثلاثة في الشاشات الثلاث — قبل المزامنة وبعدها بالضبط. */
async function verifyEverywhere(
  page: Page,
  info: Parameters<typeof expectFrame>[1],
  synced: boolean,
) {
  // SHIFT-02: 40 داخل الصندوق، 60 خارجه، المتوقَّع 1,840 + 40 = 1,880 (ACC-08/13)
  await nav(page, "الوردية والصندوق");
  await expect(page).toHaveURL(/\/shifts\/current$/);
  const shift = page.locator('[data-screen="SHIFT-02"]');
  await expect(shift).toContainText("INV-KRT-A2-26-000001");
  await expect(shift).toContainText("بيع نقدي");
  await expect(shift.locator(".shift-expected__v")).toContainText("1,880.00");
  await expect(shift).toContainText("40.00");
  await expect(shift).toContainText("60.00");
  await expectFrame(page, info, {
    screenId: "SHIFT-02",
    state: synced ? "ready" : "pending_sync",
    texts: fromFrame("SHIFT-02", synced ? "ready" : "pending_sync", [
      "النقد المتوقع في الدرج",
      "داخل الصندوق",
      "خارج الصندوق",
      synced ? "مؤكد" : "معلّق",
    ]),
  });

  // POS-09: الفاتورة 100 بوضع مزامنتها (شريط الوردية شريط الرئيسية — العودة بالتاريخ داخل التطبيق)
  await page.goBack();
  await nav(page, "الفواتير");
  await expect(page).toHaveURL(/\/pos\/invoices$/);
  const inv = page.locator('[data-screen="POS-09"]');
  await expect(inv).toContainText("INV-KRT-A2-26-000001");
  await expect(inv).toContainText("100.00");
  await expect(inv).toContainText("أحمد الطيب — تجريبي");
  await expect(inv).toContainText(synced ? "مؤكد خادمياً" : "محفوظ محلياً");
  await expect(inv).toHaveAttribute("data-state", synced ? "ready" : "pending_sync");

  // POS-06 (نائب PTY-05): خادمي 120 + هذا الجهاز 60 = 180 — قبل التأكيد وبعده
  await reseedCart(page);
  await nav(page, "نقطة البيع");
  await expect(page).toHaveURL(/\/pos$/);
  // زرّ الدفع معطّل حتى تُقرأ السلة من Dexie — ننتظر تفعيله
  await expect(page.getByRole("button", { name: /متابعة إلى الدفع|تحصيل/ })).toBeEnabled();
  await page.getByRole("button", { name: /متابعة إلى الدفع|تحصيل/ }).click();
  await expect(page).toHaveURL(/\/pos\/pay$/);
  await page.getByRole("button", { name: "آجل" }).click();
  await expect(page).toHaveURL(/\/pos\/pay\/credit$/);
  const credit = page.locator('[data-screen="POS-06"]');
  await expect(credit).toContainText("عليه قبل هذا البيع");
  await expect(credit.locator(".shift-facts__v").first()).toContainText("180.00");
  await expect(credit).toContainText("120.00");
  await expect(credit).toContainText("60.00");
}

test("١٠٠ = ٤٠ نقداً + ٦٠ آجلاً: الأرقام نفسها في POS-07 وSHIFT-02 وPOS-06 وPOS-09 قبل المزامنة وبعدها", async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  await seed(page);
  const pushed: { kind: string }[] = [];
  const gate = { open: false };
  await pushRoute(page, pushed, gate);
  await login(page, "/pos/pay/mixed");
  // تسخين المسارات وهي متصلة (كما تفعل خدمة العامل في WEB-03): التنقّل بلا اتصال يعتمد على ما حُمِّل
  await nav(page, "الوردية والصندوق");
  await expect(page).toHaveURL(/\/shifts\/current$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/pos\/pay\/mixed$/);
  await nav(page, "الفواتير");
  await expect(page).toHaveURL(/\/pos\/invoices$/);
  await nav(page, "نقطة البيع");
  await expect(page).toHaveURL(/\/pos$/);
  // زرّ الدفع معطّل حتى تُقرأ السلة من Dexie — ننتظر تفعيله
  await expect(page.getByRole("button", { name: /متابعة إلى الدفع|تحصيل/ })).toBeEnabled();
  await page.getByRole("button", { name: /متابعة إلى الدفع|تحصيل/ }).click();
  await expect(page).toHaveURL(/\/pos\/pay$/);
  await page.getByRole("button", { name: "آجل" }).click();
  await expect(page).toHaveURL(/\/pos\/pay\/credit$/);
  await page.getByRole("button", { name: "مختلط" }).click();
  await expect(page).toHaveURL(/\/pos\/pay\/mixed$/);
  await expect(page.locator('[data-screen="POS-07"]')).toBeVisible();

  // ١) انقطاع: البيع يُحفظ محلياً والصندوق والكشف من الحفظ نفسه
  await context.setOffline(true);
  await page.getByLabel("نقداً").fill("40");
  await page.getByLabel("آجل").fill("60");
  await page.getByRole("button", { name: /حفظ البيع/ }).click();
  await expectFrame(page, info, {
    screenId: "POS-07",
    state: "saved_local",
    texts: fromFrame("POS-07", "saved_local", [
      "إلى الصندوق — نقد فقط",
      "إلى ذمّة",
      "رصيد الطرف بعد الحفظ",
      "SHIFT-02",
      "PTY-05",
      "POS-09",
    ]),
  });
  const pos07 = page.locator('[data-screen="POS-07"]');
  // 100 = 40 + 60 في الوجهات؛ الإجمالي نفسه يظهر في POS-08 وPOS-09
  for (const n of ["40.00", "60.00", "180.00", "INV-KRT-A2-26-000001"])
    await expect(pos07).toContainText(n);
  expect(pushed).toHaveLength(0);
  // الشبكة تعود لكن الخادم ما زال بعيداً (البوابة مغلقة): ما حُفظ يبقى محلياً حتى الرفع —
  // التنقّل بلا اتصال في Next dev يحتاج غلاف الخدمة (WEB-03) فلا يُختبر هنا
  await context.setOffline(false);
  await verifyEverywhere(page, info, false);

  // ٢) الخادم يعود والرفع من POS-08 — القبول يغيّر الشارة لا الرقم
  gate.open = true;
  await nav(page, "الفواتير");
  await page.locator('[data-screen="POS-09"]').getByRole("button", { name: "فتح" }).first().click();
  await expect(page).toHaveURL(/\/pos\/invoices\/[^/]+$/);
  await page.getByRole("button", { name: "إعادة طباعة نسخة" }).click();
  await expect(page).toHaveURL(/\/pos\/receipt\//);
  await expect(page.locator('[data-screen="POS-08"]')).toHaveAttribute("data-state", "saved_local");
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expectFrame(page, info, {
    screenId: "POS-08",
    state: "synced",
    texts: fromFrame("POS-08", "synced", ["مؤكد خادمياً", "وصلت الخادم", "وصارت مرجعية."]),
  });
  expect(pushed.map((o) => o.kind)).toEqual(["sale"]);
  const receipt = page.locator('[data-screen="POS-08"]');
  await expect(receipt).toContainText("100.00");
  await expect(receipt).toContainText("40.00");
  await expect(receipt).toContainText("60.00");
  await verifyEverywhere(page, info, true);
});
