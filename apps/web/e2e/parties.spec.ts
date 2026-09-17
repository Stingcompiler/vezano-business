import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.22 — PTY-01 (6) + PTY-02 (4). الأسماء من الجهاز فوراً والأرصدة تُوسم حتى تُطابَق؛ الرصيد
 * مركّب «خادمي X + معلّق على جهازك Y» (ACC-02)؛ الترتيب بالمبلغ أو بتاريخ آخر حركة لا «أقدم دين»
 * (G-15)؛ الكاشير يرى من يبيع له لا القائمة كاملةً؛ الموردون سجلات داخلية لا صفحة سوق (ACC-118).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const daysAgo = (n: number, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const party = (
  id: string,
  name: string,
  phone: string,
  balance: string,
  limit: string,
  last: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name,
  name_normalized: name,
  phone,
  aliases: [] as string[],
  credit_limit_minor: limit,
  is_customer: true,
  is_supplier: false,
  distinct_from_id: "",
  balance_minor: balance,
  balance_as_of: daysAgo(0, 9, 0),
  last_sale_at: last,
  last_movement_at: last,
  supplier_owed_minor: "0",
  market_linked: false,
  is_active: true,
  deactivated_at: "",
  updated_at: last,
  ...extra,
});

/** صفوف إطار 04-D2 PTY-01 (الأرصدة الخادمية؛ أحمد 120 + معلّق 60 = 180 على الجهاز). */
const CUSTOMERS = [
  party("p1", "أحمد الطيب — تجريبي", "0912555447", "12000", "50000", daysAgo(0, 10, 34), {
    aliases: ["أبو محمد", "الطيب"],
  }),
  party("p2", "فاطمة حسن — تجريبي", "0900222118", "64000", "0", daysAgo(0, 9, 58)),
  party("p3", "خالد إبراهيم — تجريبي", "0918333902", "34000", "60000", daysAgo(8), {
    is_supplier: true,
  }),
  party("p4", "سعاد النور — تجريبي", "0915444336", "0", "0", daysAgo(15)),
  party("p5", "مطعم الواحة — تجريبي", "0923555771", "289000", "300000", daysAgo(9), {
    aliases: ["الواحة"],
  }),
  party("p6", "عمر بابكر — تجريبي", "0919666054", "36800", "30000", daysAgo(40)),
];

const SUPPLIERS = [
  party("s1", "مخزن البركة — تجريبي", "0155000200", "", "0", "", {
    is_customer: false,
    is_supplier: true,
    supplier_owed_minor: "420000",
    market_linked: true,
  }),
  party("s2", "مخزن النخيل — تجريبي", "0155000318", "", "0", "", {
    is_customer: false,
    is_supplier: true,
    supplier_owed_minor: "0",
  }),
];

const listBody = (
  kind: "customers" | "suppliers",
  rows: unknown[],
  extra: Partial<{ can_see_balances: boolean }> = {},
) => ({
  kind,
  can_see_balances: true,
  role_name: "مالك",
  as_of: new Date().toISOString(),
  rows,
  summary: { count: rows.length, total_due_minor: "0", total_owed_minor: "0" },
  ...extra,
});

interface Seed {
  readonly localParties?: readonly ReturnType<typeof party>[];
  readonly pendingSaleFor?: string;
  readonly matchedAt?: string;
}

async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ parties, pendingSaleFor, matchedAt, now }) => {
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
            userName: "سالم",
            roleName: "مالك",
            roleCode: "owner",
          }),
        });
        if (matchedAt) meta.put({ key: "parties.matched_at", value: matchedAt });
        else meta.delete("parties.matched_at");
        for (const p of parties) proj.put({ key: `entity:parties.Party:${p.id}`, value: p });
        if (pendingSaleFor) {
          proj.put({
            key: "entity:sales.Sale:sale-p",
            value: {
              id: "sale-p",
              invoice_number: "INV-KRT-A2-26-000009",
              shift_id: "s1",
              branch_id: "b1",
              device_id: "d1",
              user_id: "u1",
              user_name: "سميرة ع.",
              party_id: pendingSaleFor,
              party_name: "أحمد الطيب — تجريبي",
              subtotal_minor: "6000",
              discount_minor: "0",
              total_minor: "6000",
              cash_minor: "0",
              bank_minor: "0",
              credit_minor: "6000",
              received_minor: "",
              change_minor: "",
              lines: [],
              business_date: now.slice(0, 10),
              occurred_at: now,
              operation_id: "op-sale-p",
            },
          });
          ops.put({
            operationId: "op-sale-p",
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [],
            state: "pending",
            createdLocalSeq: 2,
            snapshotRelation: "none",
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      parties: s.localParties ?? [],
      pendingSaleFor: s.pendingSaleFor ?? "",
      matchedAt: s.matchedAt ?? "",
      now: new Date().toISOString(),
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
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

function listRoute(page: Page, body: unknown, opts: { delayMs?: number; status?: number } = {}) {
  return page.route("**/api/parties/list**", async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    return route.fulfill(json(opts.status ?? 200, body));
  });
}

const HEAD = [
  "قائمة العملاء",
  "بحث وأسماء بديلة ورصيد مخوَّل. الكاشير يرى رصيد العميل الذي يبيع له فقط، ولا يرى قائمة الذمم كاملة.",
  "كل العملاء",
  "عليهم رصيد",
  "بلا حركة 30 يوماً",
  "عميل جديد",
  "الاسم",
  "الهاتف",
  "عليه",
  "حد الائتمان",
  "اختياري · تنبيه لا منع",
  "آخر حركة",
  "كشف الحساب",
];

test.describe("PTY-01", () => {
  test("loading → ready: الأسماء من الجهاز فوراً ثم الأرصدة، والرصيد مركّب والترتيب بالمبلغ", async ({
    page,
  }, info) => {
    await seed(page, {
      localParties: CUSTOMERS.map((p) => ({ ...p, balance_minor: "", last_movement_at: "" })),
      pendingSaleFor: "p1",
    });
    await listRoute(page, listBody("customers", CUSTOMERS), { delayMs: 4000 });
    await login(page, "/parties");
    await expect(page.locator('[data-screen="PTY-01"]')).toContainText("مطعم الواحة — تجريبي");
    await expectFrame(page, info, {
      screenId: "PTY-01",
      state: "loading",
      texts: fromFrame("PTY-01", "loading", [
        "جلب الأطراف",
        "المحلي فوراً ثم تُطابَق الأرصدة. الأسماء لا تنتظر الخادم؛ الأرصدة تُوسم حتى تُطابَق.",
        "التفريق مقصود",
        "الكاشير يبحث عن اسم ليبيع، فلا يُحبَس على رصيدٍ لم يصل.",
        "قائمة العملاء",
        "أحمد الطيب — تجريبي",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "PTY-01",
      state: "ready",
      texts: fromFrame("PTY-01", "ready", [
        ...HEAD,
        "أحمد الطيب — تجريبي",
        "أبو محمد · الطيب",
        "اليوم 10:34",
        "فاطمة حسن — تجريبي",
        "اليوم 09:58",
        "خالد إبراهيم — تجريبي",
        "عميل ومورد",
        "سعاد النور — تجريبي",
        "مطعم الواحة — تجريبي",
        "الواحة",
        "عمر بابكر — تجريبي",
        "عملاء · مجموع ما على العملاء",
        "آخر تحديث خادمي",
        "تجاوز الحد",
        "غير محدد",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="PTY-01"]');
    // أحمد: خادمي 120 + معلّق 60 = 180 (ACC-02)؛ المجموع 180+640+340+0+2,890+368 = 4,418
    await expect(root).toContainText("180.00");
    await expect(root).toContainText("خادمي 120.00 + معلّق على جهازك 60.00");
    await expect(root).toContainText("6 عملاء · مجموع ما على العملاء 4,418.00");
    await expect(root).toContainText("يشمل عملية واحدة معلقة من هذا الجهاز");
    // الترتيب بالمبلغ: مطعم الواحة أولاً
    const names = await root.locator("tbody tr td:first-child, .c-table__card").allInnerTexts();
    expect(names.findIndex((t) => t.includes("مطعم الواحة"))).toBeLessThan(
      names.findIndex((t) => t.includes("أحمد الطيب")),
    );
    // «عليهم رصيد» يخفي سعاد (0)؛ «بلا حركة 30 يوماً» يبقي عمر وحده
    await page.getByRole("button", { name: "عليهم رصيد" }).click();
    await expect(root).not.toContainText("سعاد النور");
    await page.getByRole("button", { name: "بلا حركة 30 يوماً" }).click();
    await expect(root).toContainText("عمر بابكر");
    await expect(root).not.toContainText("فاطمة حسن");
    // كشف الحساب → PTY-05
    await page.getByRole("button", { name: "كل العملاء" }).click();
    await root.getByRole("button", { name: "كشف الحساب" }).first().click();
    await expect(page).toHaveURL(/\/parties\/[^/]+\/statement$/);
  });

  test("empty: محلٌّ نقدي بالكامل — حالة سويّة لا نقص", async ({ page }, info) => {
    await seed(page);
    await listRoute(page, listBody("customers", []));
    await login(page, "/parties");
    await expectFrame(page, info, {
      screenId: "PTY-01",
      state: "empty",
      texts: fromFrame("PTY-01", "empty", [
        "لا عملاء",
        "محلٌّ نقدي بالكامل. حالةٌ سويّة لا نقص.",
        "لا نُلحّ",
        "العميل يُنشأ حين يُباع له آجلاً (POS-04). إنشاء قائمة عملاء مسبقاً عملٌ لا يحتاجه أحد.",
      ]),
    });
  });

  test("offline: أرصدة محلية — من آخر مطابقة ومعها ما لم يُرفع من هذا الجهاز", async ({
    page,
    context,
  }, info) => {
    await seed(page, {
      localParties: CUSTOMERS,
      pendingSaleFor: "p1",
      matchedAt: daysAgo(0, 9, 0),
    });
    await listRoute(page, listBody("customers", CUSTOMERS));
    await login(page, "/parties");
    await expect(page.locator('[data-screen="PTY-01"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await expectFrame(page, info, {
      screenId: "PTY-01",
      state: "offline",
      texts: fromFrame("PTY-01", "offline", [
        "أرصدة محلية",
        "الأسماء كاملة والأرصدة من آخر مطابقة، ومعها ما لم يُرفع من هذا الجهاز.",
        "الرصيد مركّب",
        "«خادمي 1,240 + معلّق على جهازك 100 = 1,340» — نعرض التركيب لا المجموع وحده (ACC-02).",
        "أحمد الطيب — تجريبي",
      ]),
    });
    await expect(page.locator('[data-screen="PTY-01"]')).toContainText("180.00");
    await context.setOffline(false);
  });

  test("stale: المطابقة متعثّرة — الوقت مع كل رصيد", async ({ page }, info) => {
    await seed(page, { localParties: CUSTOMERS, matchedAt: daysAgo(1, 10, 30) });
    await listRoute(page, { detail: "server_error" }, { status: 500 });
    await login(page, "/parties");
    await expectFrame(page, info, {
      screenId: "PTY-01",
      state: "stale",
      texts: fromFrame("PTY-01", "stale", [
        "أرصدة قديمة",
        "المطابقة متعثّرة وقد سدّد طرفٌ في فرع آخر.",
        "الخطر المحدد",
        "أن تُطالب من سدّد. الوقت مع كل رصيد لا في ترويسة الصفحة.",
        "آخر تحديث خادمي",
      ]),
    });
    await expect(page.locator('[data-screen="PTY-01"]')).toContainText("10:30");
  });

  test("permission_denied: الكاشير يرى من يبيع له — لا القائمة كاملةً", async ({ page }, info) => {
    await seed(page, { localParties: CUSTOMERS });
    await listRoute(page, { detail: "finance_required" }, { status: 403 });
    await login(page, "/parties");
    await expectFrame(page, info, {
      screenId: "PTY-01",
      state: "permission_denied",
      texts: fromFrame("PTY-01", "permission_denied", [
        "الكاشير يرى من يبيع له",
        "يرى الطرف ورصيده وقت البيع، ولا يرى القائمة كاملةً بأرصدتها.",
        "لماذا",
        "القائمة الكاملة صورةٌ مالية للمنشأة. رؤية رصيد من أمامك حاجةُ عمل؛ رؤية الجميع ليست كذلك.",
      ]),
    });
    await expect(page.locator('[data-screen="PTY-01"]')).not.toContainText("مطعم الواحة");
    await page.getByRole("button", { name: "اختيار العميل" }).click();
    await expect(page).toHaveURL(/\/pos\/customer$/);
  });
});

test.describe("PTY-02", () => {
  test("loading → ready: الموردون سجلات داخلية — له علينا وصلة السوق", async ({ page }, info) => {
    await seed(page);
    await listRoute(page, listBody("suppliers", SUPPLIERS), { delayMs: 3000 });
    await login(page, "/parties/suppliers");
    await expectFrame(page, info, {
      screenId: "PTY-02",
      state: "loading",
      texts: fromFrame("PTY-02", "loading", [
        "جلب الموردين",
        "مع المستحقّ عليك لهم — وهو سبب فتح الشاشة غالباً.",
        "قائمة الموردين",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "PTY-02",
      state: "ready",
      texts: fromFrame("PTY-02", "ready", [
        "قائمة الموردين",
        "سجلات داخلية خاصة بك. المورد هنا لا يصبح صفحة في السوق تلقائياً — ACC-118.",
        "هذه سجلات موردين داخلية في دفترك. نشر أي منها كمنشأة في السوق يحتاج موافقة صريحة وتحققاً منفصلاً في",
        "MP-08",
        "المورد",
        "الهاتف",
        "له علينا",
        "صلة السوق",
        "كشف الحساب",
        "مخزن البركة — تجريبي",
        "مخزن النخيل — تجريبي",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="PTY-02"]');
    await expect(root).toContainText("4,200.00");
    await expect(root).toContainText("مرتبط بمنشأة سوق");
    await expect(root).toContainText("سجل داخلي فقط");
  });

  test("empty: الشراء نقدي بلا حساب مفتوح", async ({ page }, info) => {
    await seed(page);
    await listRoute(page, listBody("suppliers", []));
    await login(page, "/parties/suppliers");
    await expectFrame(page, info, {
      screenId: "PTY-02",
      state: "empty",
      texts: fromFrame("PTY-02", "empty", [
        "لا موردين",
        "الشراء نقدي بلا حساب مفتوح.",
        "المسار",
        "يُنشأ المورد عند أول استلام بضاعة (INV-04) أو أمر شراء. لا نطلب تسجيلاً مسبقاً.",
      ]),
    });
  });

  test("permission_denied: أمين المخزن يرى الأسماء لا المستحقّ", async ({ page }, info) => {
    await seed(page);
    await listRoute(
      page,
      listBody(
        "suppliers",
        SUPPLIERS.map((s) => ({ ...s, supplier_owed_minor: "" })),
        { can_see_balances: false },
      ),
    );
    await login(page, "/parties/suppliers");
    await expectFrame(page, info, {
      screenId: "PTY-02",
      state: "permission_denied",
      texts: fromFrame("PTY-02", "permission_denied", [
        "أمين المخزن يرى الأسماء",
        "يرى الموردين ليستلم منهم، ولا يرى ما لهم على المنشأة.",
        "الحدّ",
        "عمله عدُّ ما وصل لا مطابقة المبالغ. والمستحقّ يقود إلى التكلفة.",
        "مخزن البركة — تجريبي",
      ]),
    });
    await expect(page.locator('[data-screen="PTY-02"]')).not.toContainText("4,200.00");
  });
});
