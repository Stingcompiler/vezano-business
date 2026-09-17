import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.28 — INV-01 أرصدة المخزون (7) + INV-02 سجل حركة الصنف (5). السالب يُعرض بلونه لا يُصفَّر ولا
 * يمنع البيع (ACC-17)؛ وحدة الشراء بمعاملها قراءةً مساعدة لا مجموعاً (R-08)؛ حد التنبيه اقتراح؛
 * المعلّق من هذا الجهاز داخل في الأرصدة وموسوم ومفصول عن المؤكَّد برقمين (SYS-03)؛ المواقع تَرِد
 * واحداً واحداً ولا مجموع جزئي.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const unit = (id: string, code: string, name: string, dp: 0 | 3) => ({
  base_unit_id: id,
  base_unit_code: code,
  base_unit_name: name,
  base_unit_decimal_places: dp,
});

const item = (
  id: string,
  name: string,
  base: [string, string, string, 0 | 3],
  extra: [string, number][],
  price: string,
  threshold = "",
) => ({
  id,
  name,
  name_normalized: name,
  group_id: "g-1",
  group_name: "بقالة",
  ...unit(...base),
  units: extra.map(([n, f]) => ({
    unit_id: `u-${n}`,
    code: n,
    name: n,
    decimal_places: 0,
    factor_milli: String(f * 1000),
    barcode: "",
  })),
  barcode: "",
  sale_price_minor: price,
  price_updated_at: "2026-09-01T10:00:00.000Z",
  alert_threshold_milli: threshold,
  aliases: [] as string[],
  is_active: true,
  deactivated_at: "",
  updated_at: "2026-09-01T10:00:00.000Z",
});

const ITEMS = [
  item("i1", "سكر", ["u-kg", "كغ", "كغ", 3], [["كرتونة", 12]], "10000", "5000"),
  item("i2", "شاي أسود 250غ", ["u-pack", "عبوة", "عبوة", 0], [], "24000", "8000"),
  item("i3", "زيت 1 لتر", ["u-pack", "عبوة", "عبوة", 0], [], "78000"),
];

const srow = (
  it: (typeof ITEMS)[number],
  qty: string,
  tag: "negative" | "low" | "ok",
  last: string,
) => ({
  item_id: it.id,
  name: it.name,
  qty_milli: qty,
  sale_unit: {
    code: it.base_unit_code,
    name: it.base_unit_name,
    decimal_places: it.base_unit_decimal_places,
  },
  purchase_unit: it.units[0]
    ? {
        code: it.units[0].code,
        name: it.units[0].name,
        decimal_places: 0,
        factor_milli: it.units[0].factor_milli,
      }
    : null,
  alert_threshold_milli: it.alert_threshold_milli,
  tag,
  quarantine_milli: "0",
  last_movement_at: last,
  price_missing: it.sale_price_minor === "0",
});

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const BRANCHES = [
  { id: "b1", name: "الفرع الرئيسي" },
  { id: "b2", name: "فرع بحري" },
];

const balances = (over: Record<string, unknown> = {}) => ({
  branch_id: "b1",
  branches: BRANCHES,
  as_of: at(10, 30),
  rows: [
    srow(ITEMS[0]!, "10000", "ok", at(10, 34)),
    srow(ITEMS[1]!, "6000", "low", at(9, 58)),
    srow(ITEMS[2]!, "-2000", "negative", at(10, 12)),
  ],
  ...over,
});

interface Seed {
  readonly role?: "owner" | "cashier";
  readonly pending?: boolean;
  readonly cache?: unknown;
  readonly movementsCache?: unknown;
}

async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, pending, cache, movementsCache, items, asOf }) => {
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
            deviceName: "كاشير 1",
            devicePrefix: "A2",
            userId: "u1",
            userName: role === "owner" ? "سالم" : "سميّة",
            roleName: role === "owner" ? "مالك" : "كاشير",
            roleCode: role,
          }),
        });
        for (const i of items) proj.put({ key: `entity:catalog.Item:${i.id}`, value: i });
        // أرصدة الجهاز (آخر مطابقة): السكر 10 والشاي 6 والزيت −2
        for (const [id, qty] of [
          ["i1", "10000"],
          ["i2", "6000"],
          ["i3", "-2000"],
        ] as const)
          proj.put({
            key: `entity:inventory.Balance:${id}`,
            value: { item_id: id, qty_milli: qty, as_of: asOf },
          });
        meta.put({ key: "inventory.balances_as_of", value: asOf });
        if (cache) meta.put({ key: "inventory.stock_cache.b1", value: JSON.stringify(cache) });
        if (movementsCache)
          meta.put({
            key: "inventory.stock_cache.movements.i1.b1.30",
            value: JSON.stringify(movementsCache),
          });
        if (pending) {
          // بيع محلي لم يُرفع: سكر −1 كغ وشاي −1 — حركتان معلقتان
          proj.put({
            key: "entity:sales.Sale:sale-1",
            value: {
              id: "sale-1",
              invoice_number: "INV-KRT-A2-26-000009",
              user_name: "سميّة",
              party_id: "",
              credit_minor: "0",
              cash_minor: "34000",
              bank_minor: "0",
              total_minor: "34000",
              lines: [],
              occurred_at: asOf,
              business_date: asOf.slice(0, 10),
              operation_id: "op-sale-1",
            },
          });
          ops.put({
            operationId: "op-sale-1",
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [
              ["mv-1", "i1", "-1000"],
              ["mv-2", "i2", "-1000"],
            ].map(([id, itemId, delta]) => ({
              entity: "inventory.StockMovement",
              id,
              schemaVersion: 1,
              payload: {
                movement_id: id,
                branch_id: "b1",
                item_id: itemId,
                delta_base_qty_milli: delta,
                reason: "sale",
                source_entity: "sales.Sale",
                source_id: "sale-1",
                occurred_at: asOf,
              },
              serverSeq: null,
            })),
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
      role: s.role ?? "owner",
      pending: s.pending ?? false,
      cache: s.cache ?? null,
      movementsCache: s.movementsCache ?? null,
      items: ITEMS,
      asOf: at(10, 30),
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

function balancesRoute(
  page: Page,
  perBranch: Record<string, { status?: number; body?: unknown; delayMs?: number }>,
) {
  return page.route("**/api/inventory/balances**", async (route) => {
    const url = new URL(route.request().url());
    const b = url.searchParams.get("branch_id") ?? "b1";
    const cfg = perBranch[b] ?? { status: 404, body: { detail: "not_found" } };
    if (cfg.delayMs) await new Promise((r) => setTimeout(r, cfg.delayMs));
    return route.fulfill(json(cfg.status ?? 200, cfg.body ?? balances({ branch_id: b })));
  });
}

const HEAD = [
  "المخزون — الفرع الرئيسي",
  "الرصيد السالب يُنبَّه عليه ولا يمنع البيع — ACC-17. لكل رصيد تغطية زمنية.",
  "الفرع الرئيسي",
  "كل الأصناف",
  "السالب فقط",
  "تحت حد التنبيه",
  "الصنف",
  "وحدة الشراء",
  "الوحدة",
  "الرصيد",
  "بالكرتونة",
  "التنبيه",
  "آخر حركة",
  "أصناف تحتاج انتباهاً",
  "لا عمود «إجمالي القطع».",
  "معامل التحويل معلن ومحرَّر.",
  "الرصيد بوحدة البيع، والشراء يحوَّل بالمعامل المعلن عند الاستلام.",
];

test.describe("INV-01", () => {
  test("ready: الأرصدة بوحدة البيع ووحدة الشراء بمعاملها؛ السالب بلونه؛ حد التنبيه اقتراح؛ المرشّحات", async ({
    page,
  }, info) => {
    await seed(page);
    await balancesRoute(page, { b1: {}, b2: { body: balances({ branch_id: "b2", rows: [] }) } });
    await login(page, "/inventory");
    await expectFrame(page, info, {
      screenId: "INV-01",
      state: "ready",
      texts: fromFrame("INV-01", "ready", [
        ...HEAD,
        "سكر",
        "كغ",
        "شاي أسود 250غ",
        "زيت 1 لتر",
        "عبوة",
        "رصيد سالب",
        "بيع فوق الرصيد الدفتري. لا يُصحَّح تلقائياً — يحتاج جرد أو تسجيل استلام فائت.",
        "التنبيه اقتراح لا أمر — قد تكون تعرف أن شحنة في الطريق.",
        "سليم",
        "وحدة واحدة — لا تحويل",
        "آخر تحديث خادمي",
        "الرصيد السالب لا يمنع البيع",
        "— يعني أن بيعاً سُجّل قبل تسجيل الاستلام، والتسوية تتم بالجرد لا بالمنع.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="INV-01"]');
    await expect(page.getByLabel("اسم الصنف")).toBeVisible();
    await expect(root).toContainText("0.83 كرتونة");
    await expect(root).toContainText("3 صنفاً · 2 أصناف تحتاج انتباهاً");
    await expect(root).toContainText("المعامل: 1 كرتونة = 12.000 كغ");
    await expect(root).toContainText("تحت حد إعادة الطلب (8)");
    // السالب بلونه لا يُصفَّر
    await expect(root.locator(".inv-qty--neg")).toHaveText("−2");
    await expect(root).toContainText("كل المواقع 10.000");
    // «السالب فقط» يُبقي الزيت وحده
    await page.getByLabel("الأصناف").selectOption("negative");
    await expect(root.locator("tbody tr, .c-table__card")).toHaveCount(1);
    await expect(root).toContainText("زيت 1 لتر");
    await page.getByLabel("الأصناف").selectOption("low");
    await expect(root).toContainText("شاي أسود 250غ");
    await expect(root).not.toContainText("زيت 1 لتر");
    await page.getByLabel("الأصناف").selectOption("all");
    await page.getByLabel("اسم الصنف").fill("سكر");
    await expect(root.locator("tbody tr, .c-table__card")).toHaveCount(1);
  });

  test("pending_sync: حركتان معلقتان من هذا الجهاز داخلتان في الأرصدة — خادمي + معلّق برقمين", async ({
    page,
  }, info) => {
    await seed(page, { pending: true });
    await balancesRoute(page, { b1: {}, b2: { body: balances({ branch_id: "b2", rows: [] }) } });
    await login(page, "/inventory");
    await expectFrame(page, info, {
      screenId: "INV-01",
      state: "pending_sync",
      texts: fromFrame("INV-01", "pending_sync", [
        ...HEAD,
        "آخر تحديث خادمي",
        "حركتان معلقتان من هذا الجهاز داخلتان في الأرصدة.",
        "الرصيد السالب لا يمنع البيع",
      ]),
    });
    const root = page.locator('[data-screen="INV-01"]');
    await expect(root).toContainText("آخر تحديث خادمي 10:30 · حركتان معلقتان");
    // السكر: خادمي 10 + معلّق −1 = 9
    await expect(root).toContainText("خادمي 10.000 + معلّق هذا الجهاز −1.000");
    await expect(root.locator("tbody tr").first()).toContainText("9.000");
  });

  test("loading: المواقع تَرِد واحداً واحداً — لا مجموع جزئي قبل اكتمالها", async ({
    page,
  }, info) => {
    await seed(page);
    await balancesRoute(page, {
      b1: {},
      b2: { body: balances({ branch_id: "b2", rows: [] }), delayMs: 3000 },
    });
    await login(page, "/inventory");
    await expectFrame(page, info, {
      screenId: "INV-01",
      state: "loading",
      texts: fromFrame("INV-01", "loading", [
        "جمع المواقع",
        "المواقع تَرِد واحداً واحداً، والمجموع لا يُعرض قبل اكتمالها.",
        "لا مجموع جزئي",
        "مجموعٌ ناقص يُقرأ كاملاً ويُبنى عليه أمر شراء.",
      ]),
    });
    await expect(page.locator('[data-screen="INV-01"]')).toContainText("كل المواقع —");
    await expect(page.locator('[data-screen="INV-01"]')).toHaveAttribute("data-state", "ready", {
      timeout: 10_000,
    });
    await expect(page.locator('[data-screen="INV-01"]')).toContainText("كل المواقع 10.000");
  });

  test("partial: اتصالٌ وموقع لم يَرد — الصفوف تظهر والمجموع لا يُعرض", async ({ page }, info) => {
    await seed(page);
    await balancesRoute(page, { b1: {}, b2: { status: 500, body: { detail: "boom" } } });
    await login(page, "/inventory");
    await expectFrame(page, info, {
      screenId: "INV-01",
      state: "partial",
      texts: fromFrame("INV-01", "partial", [
        "جمع المواقع",
        "اتصالٌ ومواقع لم تَرد",
        "لا مجموع جزئي",
        "فرع بحري",
        "سكر",
      ]),
    });
    await expect(page.locator('[data-screen="INV-01"]')).toContainText("كل المواقع —");
  });

  test("empty: لا أرصدة — بدايةٌ لا عطب، والمسار افتتاحيات أو استلام", async ({ page }, info) => {
    await seed(page);
    await balancesRoute(page, {
      b1: { body: balances({ rows: [] }) },
      b2: { body: balances({ branch_id: "b2", rows: [] }) },
    });
    await login(page, "/inventory");
    await expectFrame(page, info, {
      screenId: "INV-01",
      state: "empty",
      texts: fromFrame("INV-01", "empty", [
        "لا أرصدة",
        "كتالوجٌ فيه أصناف بلا رصيد — محلٌّ لم يُدخل افتتاحياته.",
        "المسار",
        "أدخل افتتاحيات المخزون",
        "استلم بضاعة",
        "والفراغ هنا بدايةٌ لا عطب.",
      ]),
    });
  });

  test("stale: المطابقة متعثّرة — أرصدة قديمة بوقتها مع كل رقم", async ({ page }, info) => {
    await seed(page, { cache: balances({ as_of: at(8, 30) }) });
    await balancesRoute(page, { b1: { status: 500, body: { detail: "boom" } } });
    await login(page, "/inventory");
    await expectFrame(page, info, {
      screenId: "INV-01",
      state: "stale",
      texts: fromFrame("INV-01", "stale", [
        "أرصدة قديمة",
        "من آخر مطابقة قبل ساعتين وقد بيع منها.",
        "الوقت مع الرقم",
        "لا في الترويسة. صفحةٌ تُطبع للجرد تأخذ طابعها معها.",
        "سكر",
      ]),
    });
    await expect(page.locator('[data-screen="INV-01"]').locator("tbody tr").first()).toContainText(
      "حتى 08:30",
    );
  });

  test("offline: أرصدة محلية من الجهاز ومعها ما لم يُرفع", async ({ page, context }, info) => {
    await seed(page, { pending: true });
    await balancesRoute(page, { b1: {}, b2: { body: balances({ branch_id: "b2", rows: [] }) } });
    await login(page, "/inventory");
    await expect(page.locator('[data-screen="INV-01"]')).toHaveAttribute(
      "data-state",
      "pending_sync",
    );
    await context.setOffline(true);
    await expectFrame(page, info, {
      screenId: "INV-01",
      state: "offline",
      texts: fromFrame("INV-01", "offline", [
        "أرصدة محلية",
        "أرصدة هذا الجهاز وما زامنه، ومعها ما لم يُرفع.",
        "الفرق عن partial",
        "هنا لا اتصال أصلاً؛ وهناك اتصالٌ ومواقع لم تَرد. الأولى مفهومة والثانية تحتاج بياناً.",
        "سكر",
        "زيت 1 لتر",
      ]),
    });
    await context.setOffline(false);
  });
});

const mrow = (
  id: string,
  occurred: string,
  reason: string,
  label: string,
  actor: string,
  doc: string,
  delta: string,
  after: string,
) => ({
  id,
  occurred_at: occurred,
  reason,
  label,
  actor,
  doc,
  source_entity: "sales.Sale",
  source_id: `src-${id}`,
  delta_milli: delta,
  balance_after_milli: after,
});

const movements = (over: Record<string, unknown> = {}) => ({
  item: {
    id: "i1",
    name: "سكر أبيض",
    sale_unit: { code: "bag", name: "كيس 1كغ", decimal_places: 0 },
  },
  branch_id: "b1",
  branch_name: "فرع بحري",
  range: "30",
  as_of: new Date(Date.now() - 14 * 60_000).toISOString(),
  rows: [
    mrow(
      "m1",
      "2026-09-01T08:00:00.000Z",
      "opening",
      "افتتاحية",
      "عثمان",
      "OP-0001",
      "1800000",
      "1800000",
    ),
    mrow(
      "m2",
      "2026-09-12T09:12:00.000Z",
      "return",
      "مرتجع زبون",
      "سميّة",
      "RT-0330",
      "3000",
      "1803000",
    ),
    mrow(
      "m3",
      "2026-09-13T13:40:00.000Z",
      "count",
      "تسوية جرد",
      "عثمان",
      "TS-0914",
      "-8000",
      "1795000",
    ),
    mrow(
      "m4",
      "2026-09-13T14:22:00.000Z",
      "sale",
      "بيع نقطة بيع",
      "سميّة",
      "INV-9921",
      "-12000",
      "1783000",
    ),
  ],
  balance_milli: "1783000",
  total_count: 4,
  last_movement_at: "2026-09-13T14:22:00.000Z",
  ...over,
});

function movementsRoute(
  page: Page,
  body: unknown,
  opts: { status?: number; delayMs?: number } = {},
) {
  return page.route("**/api/inventory/items/i1/movements**", async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    return route.fulfill(json(opts.status ?? 200, body));
  });
}

const MOV = "/inventory/items/i1?branch=b1&range=30";

test.describe("INV-02", () => {
  test("ready: كل حركة لها مصدر ومستند ورصيد بعدها؛ آخر تحديث خادمي بوقته", async ({
    page,
  }, info) => {
    await seed(page);
    await movementsRoute(page, movements());
    await login(page, MOV);
    await expectFrame(page, info, {
      screenId: "INV-02",
      state: "ready",
      texts: fromFrame("INV-02", "ready", [
        "سجل حركة الصنف",
        "هذا هو الجواب على «كيف صار الرصيد كذا». لا سطر بلا مستند، والحركات المحفوظة محلياً معلَّمة بصراحة فلا تُقرأ كمؤكَّدة.",
        "سكر أبيض — كيس 1كغ · فرع بحري",
        "الرصيد الحالي",
        "آخر تحديث خادمي قبل",
        "الوقت",
        "المصدر",
        "المستند",
        "الحركة",
        "الرصيد بعدها",
        "الطور",
        "بيع نقطة بيع",
        "تسوية جرد",
        "مرتجع زبون",
        "افتتاحية",
        "مؤكَّد",
        "الصفوف المعلّقة لا تُخفى ولا تُخلط.",
        "الرصيد المعروض يفصل «مؤكَّد خادمياً» عن «معلّق هذا الجهاز» برقمين، لأن دمجهما في رقم واحد يعطي التاجر ثقة لا أساس لها عند تعارض لاحق (SYS-03).",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="INV-02"]');
    await expect(root).toContainText("الرصيد الحالي 1783");
    await expect(root).toContainText("آخر تحديث خادمي قبل 14 دقيقة");
    // الأحدث أولاً: بيع −12 ثم الرصيد بعده 1783؛ الافتتاحية +1800 آخراً
    const first = root.locator("tbody tr").first();
    await expect(first).toContainText("بيع نقطة بيع");
    await expect(first).toContainText("INV-9921");
    await expect(first).toContainText("−12");
    await expect(root.locator("tbody tr").last()).toContainText("+1800");
    await expect(root.locator("tbody tr")).toHaveCount(4);
  });

  test("pending_sync: الصفوف المعلّقة لا تُخفى ولا تُخلط — «منه N من حركات لم تُرفع بعد»", async ({
    page,
  }, info) => {
    await seed(page, { pending: true });
    await movementsRoute(page, movements());
    await login(page, MOV);
    await expectFrame(page, info, {
      screenId: "INV-02",
      state: "pending_sync",
      texts: fromFrame("INV-02", "pending_sync", [
        "معلّق هذا الجهاز",
        "· منه",
        "من حركات لم تُرفع بعد",
        "بيع نقطة بيع",
        "مؤكَّد",
      ]),
    });
    const root = page.locator('[data-screen="INV-02"]');
    // 1783 خادمي + (−1) معلّق = 1782 · منه −1
    await expect(root).toContainText("الرصيد الحالي 1782 · منه −1 من حركات لم تُرفع بعد");
    const first = root.locator("tbody tr").first();
    await expect(first).toContainText("معلّق هذا الجهاز");
    await expect(first).toContainText("INV-KRT-A2-26-000009");
    await expect(first).toContainText("—");
    await expect(root.locator("tbody tr")).toHaveCount(5);
  });

  test("loading: جلب الحركات مع المدى وعدد الحركات المتوقَّع", async ({ page }, info) => {
    await seed(page, { movementsCache: movements() });
    await movementsRoute(page, movements(), { delayMs: 3000 });
    await login(page, MOV);
    await expectFrame(page, info, {
      screenId: "INV-02",
      state: "loading",
      texts: fromFrame("INV-02", "loading", ["جلب الحركات", "مع المدى وعدد الحركات المتوقَّع."]),
    });
    await expect(page.locator('[data-screen="INV-02"]')).toContainText("الحركات المتوقَّعة 4");
    await expect(page.locator('[data-screen="INV-02"]')).toHaveAttribute("data-state", "ready", {
      timeout: 10_000,
    });
  });

  test("empty: نفرّق بين «الصنف لم يتحرّك بعد» و«لا حركة في هذا المدى — آخرها …»", async ({
    page,
  }, info) => {
    await seed(page);
    await movementsRoute(
      page,
      movements({ rows: [], total_count: 1, last_movement_at: "2026-09-12T09:12:00.000Z" }),
    );
    await login(page, MOV);
    await expectFrame(page, info, {
      screenId: "INV-02",
      state: "empty",
      texts: fromFrame("INV-02", "empty", [
        "لا حركة",
        "لا حركة في هذا المدى — آخرها",
        "12 سبتمبر",
        "نفرّق",
        "«الصنف لم يتحرّك بعد» تختلف عن «لا حركة في هذا المدى — آخرها 12 سبتمبر». الأولى عن الصنف والثانية عن المرشّح.",
      ]),
    });
    await page.unroute("**/api/inventory/items/i1/movements**");
    await movementsRoute(page, movements({ rows: [], total_count: 0, last_movement_at: "" }));
    await page.getByRole("button", { name: "كل الحركات" }).click();
    await expect(page.locator('[data-screen="INV-02"]')).toContainText("الصنف لم يتحرّك بعد");
  });

  test("stale: الخادم متعثّر — الحركات المحفوظة معلَّمة ولا تُقرأ كمؤكَّدة", async ({
    page,
  }, info) => {
    await seed(page, { pending: true, movementsCache: movements() });
    await movementsRoute(page, { detail: "boom" }, { status: 500 });
    await login(page, MOV);
    await expectFrame(page, info, {
      screenId: "INV-02",
      state: "stale",
      texts: fromFrame("INV-02", "stale", [
        "آخر تحديث خادمي",
        "الحركات المحفوظة محلياً معلَّمة بصراحة فلا تُقرأ كمؤكَّدة.",
        "معلّق هذا الجهاز",
        "مؤكَّد",
      ]),
    });
  });

  test("من INV-01: الصنف يفتح سجله بالفرع نفسه", async ({ page }) => {
    await seed(page);
    await balancesRoute(page, { b1: {}, b2: { body: balances({ branch_id: "b2", rows: [] }) } });
    await movementsRoute(page, movements());
    await login(page, "/inventory");
    await page.getByRole("button", { name: "سكر" }).click();
    await expect(page).toHaveURL(/\/inventory\/items\/i1\?branch=b1$/);
    await expect(page.locator('[data-screen="INV-02"]')).toHaveAttribute("data-state", "ready");
  });
});
