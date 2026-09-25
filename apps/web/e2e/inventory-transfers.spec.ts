import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.32 — INV-08 قائمة التحويلات (5) + INV-09 إنشاء وإرسال تحويل (6). خرج وصل، لا حركة واحدة: الإرسال
 * يخصم من المصدر ولا يضيف للمستقبِل و«في الطريق» طور ثالث ظاهر؛ لا تحويل لما ليس موجوداً؛ يُحفظ
 * محلياً ثم يُعلَم الفرع بالمزامنة؛ نصف المستلم يبقى مفتوحاً بالمتبقّي؛ مخوَّل للفرعين والمالك.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const item = (
  id: string,
  name: string,
  base: [string, string, 0 | 3],
  extra: [string, string, number][],
  price: string,
) => ({
  id,
  name,
  name_normalized: name,
  group_id: "g-1",
  group_name: "بقالة",
  base_unit_id: `u-${base[0]}`,
  base_unit_code: base[0],
  base_unit_name: base[1],
  base_unit_decimal_places: base[2],
  units: extra.map(([code, n, f]) => ({
    id: `iu-${id}-${code}`,
    unit_id: `u-${code}`,
    code,
    name: n,
    decimal_places: 0,
    factor_milli: String(f * 1000),
    barcode: "",
  })),
  barcode: "",
  sale_price_minor: price,
  price_updated_at: "2026-09-01T10:00:00.000Z",
  alert_threshold_milli: "",
  aliases: [] as string[],
  is_active: true,
  deactivated_at: "",
  updated_at: "2026-09-01T10:00:00.000Z",
});

const ITEMS = [
  item("i1", "سكر أبيض", ["bag", "كيس 1كغ", 0], [], "10000"),
  item("i2", "شاي أسود", ["pack", "علبة 250غ", 0], [], "24000"),
  item("i3", "دقيق", ["sack", "كيس 50كغ", 0], [], "300000"),
];
const BALANCES: Record<string, string> = { i1: "1834000", i2: "346000", i3: "42000" };
const BRANCHES = [
  { id: "b1", name: "الرئيسي" },
  { id: "b2", name: "بحري" },
];

async function seed(page: Page, role: "owner" | "storekeeper" = "owner") {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, items, balances }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections"], "readwrite");
        const meta = tx.objectStore("meta");
        const proj = tx.objectStore("projections");
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
            branchName: "الرئيسي",
            branchCode: "KRT",
            deviceId: "d1",
            deviceName: "مخزن",
            devicePrefix: "A2",
            userId: "u1",
            userName: "أمين مخزن الرئيسي",
            roleName: role === "owner" ? "مالك" : "أمين مخزن",
            roleCode: role,
          }),
        });
        for (const i of items) proj.put({ key: `entity:catalog.Item:${i.id}`, value: i });
        for (const [id, qty] of Object.entries(balances))
          proj.put({
            key: `entity:inventory.Balance:${id}`,
            value: { item_id: id, qty_milli: qty, as_of: "2026-09-17T09:00:00.000Z" },
          });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role, items: ITEMS, balances: BALANCES },
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

function pushRoute(page: Page, seen: Record<string, unknown>[], opts: { delayMs?: number } = {}) {
  return page.route("**/api/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: {
        operation_id: string;
        kind: string;
        members: { entity: string; payload: Record<string, unknown> }[];
      }[];
      request_id: string;
    };
    seen.push(...body.operations);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
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

/** أمس 16:20 بالتوقيت المحلي للمتصفح — كما يُعرض. */
const yesterdayAt = (h: number, m: number) => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const line = (
  id: string,
  name: string,
  unit: string,
  qty: string,
  received = "0",
  value = "0",
) => ({
  id: `ln-${id}`,
  item_id: id,
  item_name: name,
  unit_name: unit,
  factor_milli: "1000",
  qty_milli: qty,
  base_qty_milli: qty,
  received_base_milli: received,
  value_minor: value,
});

const transfer = (over: Record<string, unknown> = {}) => ({
  id: "t-42",
  transfer_number: "TRF-042",
  branch_from_id: "b1",
  branch_from_name: "الرئيسي",
  branch_to_id: "b2",
  branch_to_name: "بحري",
  status: "sent",
  user_name: "أمين مخزن الرئيسي",
  note: "",
  sent_at: yesterdayAt(16, 20),
  received_at: "",
  cancelled_at: "",
  late: false,
  in_transit_milli: "6000",
  in_transit_value_minor: "708000",
  line_count: 1,
  lines: [line("i9", "زيت قلي", "كراتين", "6000", "0", "708000")],
  ...over,
});

const listBody = (transfers: unknown[], over: Record<string, unknown> = {}) => ({
  branch_id: "b1",
  branches: BRANCHES,
  can_send: true,
  awaiting_count: transfers.length,
  partial_count: 0,
  transfers,
  as_of: new Date().toISOString(),
  ...over,
});

function listRoute(page: Page, body: unknown, opts: { delayMs?: number } = {}) {
  return page.route(/\/api\/inventory\/transfers(\?.*)?$/, async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    return route.fulfill(json(200, body));
  });
}

test.describe("INV-08", () => {
  test("ready + pending_sync: التحويلات بمراحلها وكميةُ الطريق؛ بطاقة التحويل بدفتريه؛ الإلغاء يرجع للرئيسي", async ({
    page,
  }, info) => {
    await seed(page);
    await listRoute(page, listBody([transfer()]));
    let cancelled = false;
    await page.route("**/api/inventory/transfers/t-42/cancel", (route) => {
      cancelled = true;
      return route.fulfill(
        json(200, { transfer: transfer({ status: "cancelled", in_transit_milli: "0" }) }),
      );
    });
    await login(page, "/inventory/transfers?id=t-42");
    await expectFrame(page, info, {
      screenId: "INV-08",
      state: "ready",
      texts: fromFrame("INV-08", "ready", [
        "التحويلات وحالاتها",
        "كل تحويل بمرحلته: أُرسل، في الطريق، استُلم، استُلم جزئياً. وكميةُ الطريق معروضة صراحةً.",
        "مخزون الطريق",
        "لا يُحسب في رصيد الفرعين. إهماله يُفقد بضاعةً من الدفتر؛ وعدّه مرتين يضاعفها.",
        "تحويل",
        "TRF-042",
        "— الرئيسي ← بحري",
        "المسؤول: أمين مخزن الرئيسي",
        "في الطريق — لم يُستلم بعد",
        "دفتر الفرع الرئيسي — المرسِل",
        "خرج من الرصيد",
        "بقيمة",
        "حالة القيد",
        "مؤكد",
        "خرج من رصيده فوراً: البضاعة ليست عنده. لكنها لم تدخل رصيد بحري بعد.",
        "دفتر فرع بحري — المستلم",
        "دخل الرصيد",
        "متوقع",
        "بانتظار العدّ",
        "لا يستطيع بيع ما لم يستلمه. لو باعه قبل الاستلام لصار رصيده سالباً بسبب لا يخصه.",
        "«بضاعة في الطريق» — حساب وسيط",
        "تظهر في تقرير المنشأة المجمَّع ولا تُنسب لأي فرع. من دون هذا الحساب تختفي البضاعة من الدفاتر بين الخروج والدخول.",
        "لو تأخر الاستلام فوق 72 ساعة يظهر تنبيه للمالك — تأخر لا اتهام.",
        "تسجيل استلام بحري",
        "تذكير المستلم",
        "إلغاء التحويل — يرجع للرئيسي",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="INV-08"]');
    await expect(root).toContainText("أُرسل أمس 16:20 · المسؤول: أمين مخزن الرئيسي");
    await expect(root).toContainText("6 كراتين · 7,080.00");
    await expect(root).toContainText("−6 كراتين");
    // المالك يستلم لأي فرع (INV-10) — الزر مفعّل له
    await expect(page.getByRole("button", { name: "تسجيل استلام بحري" })).toBeEnabled();
    await page.getByRole("button", { name: "إلغاء التحويل — يرجع للرئيسي" }).click();
    expect(cancelled).toBe(true);
  });

  test("empty / loading / partial", async ({ page }, info) => {
    await seed(page);
    await listRoute(page, listBody([]), { delayMs: 2500 });
    await login(page, "/inventory/transfers");
    await expectFrame(page, info, {
      screenId: "INV-08",
      state: "loading",
      texts: fromFrame("INV-08", "loading", [
        "جلب التحويلات",
        "مع عدد ما ينتظر استلاماً — وهو سبب فتح الشاشة.",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "INV-08",
      state: "empty",
      texts: fromFrame("INV-08", "empty", [
        "لا تحويلات",
        "فرعٌ واحد أو لا نقل بين الفروع.",
        "لا اقتراح",
        "التحويل قرار تشغيلي. اقتراحه من قائمة فارغة عبث.",
      ]),
    });
    await page.unroute(/\/api\/inventory\/transfers(\?.*)?$/);
    await listRoute(
      page,
      listBody(
        [
          transfer({
            id: "t-1",
            transfer_number: "TRF-041",
            status: "partially_received",
            in_transit_milli: "1000",
            lines: [line("i9", "زيت قلي", "كراتين", "6000", "5000", "708000")],
          }),
          transfer({
            id: "t-2",
            transfer_number: "TRF-043",
            status: "partially_received",
            in_transit_milli: "2000",
            lines: [line("i1", "سكر أبيض", "كيس 1كغ", "10000", "8000", "100000")],
          }),
          transfer({
            id: "t-3",
            transfer_number: "TRF-044",
            status: "partially_received",
            in_transit_milli: "1000",
            lines: [line("i2", "شاي أسود", "علبة 250غ", "4000", "3000", "96000")],
          }),
          transfer({
            id: "t-4",
            transfer_number: "TRF-045",
            status: "received",
            in_transit_milli: "0",
            lines: [line("i2", "شاي أسود", "علبة 250غ", "4000", "4000", "96000")],
          }),
        ],
        { partial_count: 3 },
      ),
    );
    await page.getByRole("button", { name: "إنشاء وإرسال تحويل" }).first().click();
    await expect(page).toHaveURL(/\/inventory\/transfers\/new$/);
    await page.getByRole("button", { name: "قائمة التحويلات" }).click();
    await expectFrame(page, info, {
      screenId: "INV-08",
      state: "partial",
      texts: fromFrame("INV-08", "partial", [
        "تحويلات نصف مستلمة",
        "تحويلات استُلم بعض سطورها — والباقي في الطريق أو مفقود.",
        "لا يُغلق بالسهو",
        "التحويل يبقى مفتوحاً بالمتبقّي حتى يُستلم أو يُلغى بقرار. والإغلاق التلقائي يُبخّر الفرق.",
        "استُلم جزئياً",
        "استُلم",
      ]),
    });
    await expect(page.locator('[data-screen="INV-08"]')).toContainText(
      "3 تحويلات استُلم بعض سطورها",
    );
  });
});

const NEW = "/inventory/transfers/new";

test.describe("INV-09", () => {
  test("ready → validation_error → saving → success: لا تحويل لما ليس موجوداً، ثم أُرسل — مستند خروج", async ({
    page,
  }, info) => {
    await seed(page);
    await listRoute(page, listBody([]));
    const pushed: Record<string, unknown>[] = [];
    await pushRoute(page, pushed, { delayMs: 2500 });
    await login(page, NEW);
    await page.getByLabel("إلى").selectOption("b2");
    await page.getByLabel("الصنف").nth(0).selectOption("i1");
    await page.getByLabel("كمية التحويل").nth(0).fill("200");
    await page.getByRole("button", { name: "صنف آخر" }).click();
    await page.getByLabel("الصنف").nth(1).selectOption("i2");
    await page.getByLabel("كمية التحويل").nth(1).fill("60");
    await page.getByRole("button", { name: "صنف آخر" }).click();
    await page.getByLabel("الصنف").nth(2).selectOption("i3");
    await page.getByLabel("كمية التحويل").nth(2).fill("60");
    await expectFrame(page, info, {
      screenId: "INV-09",
      state: "validation_error",
      texts: fromFrame("INV-09", "validation_error", [
        "إنشاء وإرسال تحويل — البضاعة في الطريق ليست في أي فرع",
        "مستند خروج يخصم من المُرسل ولا يضيف للمستقبِل. الكمية تصبح «في الطريق» حتى استلام مستقلّ",
        "— بلا زيادة مزدوجة.",
        "من",
        "إلى",
        "الصنف",
        "متاح بالمصدر",
        "كمية التحويل",
        "التحقّق",
        "سكر أبيض",
        "كيس 1كغ",
        "ضمن المتاح.",
        "شاي أسود",
        "علبة 250غ",
        "دقيق",
        "كيس 50كغ",
        "يتجاوز المتاح بـ",
        "الأقصى",
        "— الإرسال موقوف.",
        "لا نسمح بتحويل ما ليس موجوداً حتى لو كان في الطريق إلى المصدر — البضاعة تُحوَّل بعد وصولها لا قبله.",
        "أثر الإرسال — ثلاثة أرقام لا رقمان",
        "في الطريق",
        "«في الطريق» طور ثالث حقيقي. بلا هذا الطور إمّا تختفي البضاعة من الدفتر أو تُحسب مرتين — والاثنان خطأ يظهر عند أول جرد.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="INV-09"]');
    await expect(root).toContainText("يتجاوز المتاح بـ18. الأقصى 42 — الإرسال موقوف.");
    await expect(root).toContainText("0 — حتى الاستلام");
    await expect(page.getByRole("button", { name: "إرسال التحويل" })).toBeDisabled();
    await page.getByLabel("كمية التحويل").nth(2).fill("40");
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("−300");
    await expect(root).toContainText("+300");
    await page.getByRole("button", { name: "إرسال التحويل" }).click();
    await expectFrame(page, info, {
      screenId: "INV-09",
      state: "saving",
      texts: fromFrame("INV-09", "saving", [
        "جارٍ الإرسال",
        "الحفظ والإرسال فعلان: يُحفظ التحويل ثم يُعلَم الفرع المستقبل.",
        "لو فشل الإعلام",
        "التحويل محفوظ ومُعلَّم «لم يُعلَم» بزرّ إعادة. البضاعة قد خرجت فعلاً من الرفّ.",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "INV-09",
      state: "success",
      texts: fromFrame("INV-09", "success", [
        "أُرسل — مستند خروج",
        "يُطبع مع الشحنة ويُطابق عند الاستلام. الفرق إن وُجد يُحسم في ساق استلام مستقلّة لا بتعديل هذا المستند.",
        "دفتر الفرع الرئيسي — المرسِل",
        "دفتر فرع بحري — المستلم",
        "«بضاعة في الطريق» — حساب وسيط",
      ]),
    });
    await expect(root).toContainText("TRF-KRT-A2-26-000001");
    expect(pushed).toHaveLength(1);
    const op = pushed[0] as {
      kind: string;
      members: { entity: string; payload: Record<string, unknown> }[];
    };
    expect(op.kind).toBe("stock_transfer");
    const moves = op.members.filter((m) => m.entity === "inventory.StockMovement");
    expect(
      moves.map((m) => [
        m.payload["item_id"],
        m.payload["delta_base_qty_milli"],
        m.payload["reason"],
        m.payload["branch_id"],
      ]),
    ).toEqual([
      ["i1", "-200000", "transfer_out", "b1"],
      ["i2", "-60000", "transfer_out", "b1"],
      ["i3", "-40000", "transfer_out", "b1"],
    ]);
    // الرصيد المحلي للمصدر خُصم فوراً: 1834 − 200
    const bal = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const row = await new Promise<{ value: { qty_milli: string } }>((res) => {
        const r = db
          .transaction("projections")
          .objectStore("projections")
          .get("entity:inventory.Balance:i1");
        r.onsuccess = () => res(r.result as { value: { qty_milli: string } });
      });
      db.close();
      return row.value.qty_milli;
    });
    expect(bal).toBe("1634000");
  });

  test("saved_local: المخزن بلا شبكة — محفوظ محلياً والفرع المستقبل لا يعلم", async ({
    page,
    context,
  }, info) => {
    await seed(page, "storekeeper");
    await listRoute(page, listBody([]));
    await login(page, NEW);
    await page.getByLabel("إلى").selectOption("b2");
    await page.getByLabel("الصنف").nth(0).selectOption("i1");
    await page.getByLabel("كمية التحويل").nth(0).fill("200");
    await context.setOffline(true);
    await page.getByRole("button", { name: "إرسال التحويل" }).click();
    await expectFrame(page, info, {
      screenId: "INV-09",
      state: "saved_local",
      texts: fromFrame("INV-09", "saved_local", [
        "محفوظ محلياً",
        "المخزن بلا شبكة. التحويل محفوظ وخرج من رصيد المصدر محلياً.",
        "الفرع المستقبل لا يعلم",
        "حتى تعود الشبكة. نقولها: «سيصل إعلام الفرع عند المزامنة» — والسائق قد يصل قبل الإعلام.",
      ]),
    });
    await expect(page.locator('[data-screen="INV-09"]')).toContainText("معلّق هذا الجهاز");
    await context.setOffline(false);
    // INV-08 يعرض المحفوظ محلياً موسوماً
    await page.getByRole("button", { name: "قائمة التحويلات" }).click();
    await expectFrame(page, info, {
      screenId: "INV-08",
      state: "pending_sync",
      texts: fromFrame("INV-08", "pending_sync", [
        "التحويلات وحالاتها",
        "تحويل",
        "— الرئيسي ← بحري",
      ]),
    });
    await expect(page.locator('[data-screen="INV-08"]')).toContainText("معلّق هذا الجهاز");
  });

  test("partial: تحويل استُلم بفارق — يبقى المتبقّي «فارق تحويل» ولا يُغلق بالسهو", async ({
    page,
  }, info) => {
    await seed(page);
    await listRoute(page, listBody([]));
    await page.route("**/api/inventory/transfers/t-42", (route) =>
      route.fulfill(
        json(200, {
          transfer: transfer({
            status: "partially_received",
            in_transit_milli: "1000",
            in_transit_value_minor: "118000",
            lines: [line("i9", "زيت قلي", "كراتين", "6000", "5000", "708000")],
          }),
        }),
      ),
    );
    await login(page, "/inventory/transfers/new?id=t-42");
    await expectFrame(page, info, {
      screenId: "INV-09",
      state: "partial",
      texts: fromFrame("INV-09", "partial", [
        "TRF-042",
        "— الرئيسي ← بحري",
        "دفتر الفرع الرئيسي — المرسِل",
        "دفتر فرع بحري — المستلم",
        "دخل الرصيد",
        "«بضاعة في الطريق» — حساب وسيط",
        "عند الاستلام بفارق:",
        "يُسجَّل المستلم فعلاً، ويبقى",
        "«فارق تحويل»، ويُحسم بجرد أو بإقرار من أحد الفرعين — الاثنان دفتران لمالك واحد لكن مسؤولية العدّ لشخصين.",
      ]),
    });
    await expect(page.locator('[data-screen="INV-09"]')).toContainText("استُلم جزئياً");
    await expect(page.locator('[data-screen="INV-09"]')).toContainText("1 كراتين · 1,180.00");
  });
});
