import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.13 — PUR-01 أوامر الشراء (4) + PUR-02 إنشاء أمر (4): الأمر وعدٌ لا التزام؛ القيمة التقديرية
 * موسومة في العنوان؛ أمين المخزن يرى بلا عمود القيمة ولا يُنشئ؛ الوحدة التي تشتري بها مع المكافئ
 * بوحدة البيع؛ كمية بلا وحدة تُسأل قبل الحفظ؛ الحفظ والإرسال منفصلان؛ النجاح يقول ما لم يتغيّر.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const daysAgo = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(10, 0, 0, 0);
  return x.toISOString();
};

const order = (o: Record<string, unknown>) => ({
  id: "o1",
  number: "121",
  supplier_id: "s1",
  supplier_name: "مؤسسة الرياض للمواد الغذائية",
  status: "sent",
  status_label: "مُرسل",
  status_hint: "ردّ المورد على الكميات. لا يتحرّك مخزون قبل الاستلام.",
  items_summary: "سكر وأرز وزيت",
  lines_count: 4,
  estimated_total_minor: "418000",
  value_hidden: false,
  created_by_name: "ندى",
  created_at: daysAgo(1),
  sent_at: daysAgo(1),
  cancelled_reason: "",
  ...o,
});

const ORDERS = [
  order({}),
  order({
    id: "o2",
    number: "120",
    supplier_name: "ألبان الوادي",
    status: "partial",
    status_label: "استُلم جزئياً",
    status_hint: "وصل 4 من 6. مستند الشراء 440 يغطّي ما وصل، والباقي ينتظر أو يُلغى.",
    items_summary: "لبن وأجبان",
    lines_count: 6,
    estimated_total_minor: "96000",
    created_by_name: "سالم",
    created_at: daysAgo(3),
  }),
  order({
    id: "o3",
    number: "119",
    supplier_name: "مخابز السنابل",
    status: "open",
    status_label: "مفتوحة",
    status_hint: "توريد يومي — يُستلم صباحاً بلا تأكيد مسبق.",
    items_summary: "خبز ومعجنات",
    lines_count: 3,
    estimated_total_minor: "12000",
    created_by_name: "سالم",
    created_at: daysAgo(4),
  }),
  order({
    id: "o4",
    number: "116",
    supplier_name: "منظفات الخليج",
    status: "cancelled",
    status_label: "ملغى",
    status_hint: "",
    items_summary: "منظفات",
    lines_count: 8,
    estimated_total_minor: "51000",
    created_by_name: "ندى",
    created_at: daysAgo(9),
    cancelled_reason: "تغيّر السعر بعد الإرسال",
  }),
];

const list = (o: Record<string, unknown> = {}) => ({
  orders: ORDERS,
  open_count: 6,
  closed_count: 2,
  scope: "open",
  supplier_id: "",
  suppliers: [
    { id: "s1", name: "مؤسسة الرياض للمواد الغذائية" },
    { id: "s2", name: "منظفات الخليج" },
  ],
  can_create: true,
  value_hidden: false,
  ask_name: "",
  last_closed: { number: "121", status_label: "مستلَم", at: daysAgo(1) },
  as_of: daysAgo(0),
  ...o,
});

const ITEMS = [
  {
    id: "i1",
    name: "سكر ناعم",
    base_unit_code: "bag",
    base_unit_name: "كيس",
    base_unit_decimal_places: 0,
    units: [{ code: "carton", name: "كرتون", factor_milli: "10000" }],
  },
  {
    id: "i2",
    name: "أرز بسمتي 5 كجم",
    base_unit_code: "bag",
    base_unit_name: "كيس",
    base_unit_decimal_places: 0,
    units: [{ code: "carton", name: "كرتون", factor_milli: "4000" }],
  },
  {
    id: "i3",
    name: "زيت دوّار الشمس 1.5 ل",
    base_unit_code: "bottle",
    base_unit_name: "عبوة",
    base_unit_decimal_places: 0,
    units: [{ code: "carton", name: "كرتون", factor_milli: "12000" }],
  },
];

const PRICES: Record<string, number> = { i1: 20000, i2: 13000, i3: 12625 };
const STOCK: Record<string, [string, number | null]> = {
  i1: ["8000", 3],
  i2: ["14000", 9],
  i3: ["3000", 2],
};

const preview = (
  supplierId: string,
  lines: { item_id: string; unit_code: string; qty_milli: string }[],
  confirmed: boolean,
) => {
  const errors: unknown[] = [];
  const out: unknown[] = [];
  let total = 0;
  lines.forEach((l, i) => {
    const it = ITEMS.find((x) => x.id === l.item_id)!;
    if (!l.unit_code) {
      errors.push({ line: i, code: "unit_required", item_name: it.name, qty_milli: l.qty_milli });
      return;
    }
    if (supplierId === "s2" && !confirmed) {
      errors.push({ line: i, code: "supplier_mismatch", item_name: it.name, confirmable: true });
      return;
    }
    const factor = l.unit_code === it.base_unit_code ? 1000 : Number(it.units[0]!.factor_milli);
    const qty = Number(l.qty_milli);
    const est = (PRICES[l.item_id]! * qty) / 1000;
    total += est;
    out.push({
      item_id: l.item_id,
      item_name: it.name,
      unit_code: l.unit_code,
      unit_name: l.unit_code === it.base_unit_code ? it.base_unit_name : it.units[0]!.name,
      factor_milli: String(factor),
      qty_milli: l.qty_milli,
      base_qty_milli: String((qty * factor) / 1000),
      base_unit_name: it.base_unit_name,
      base_decimal_places: 0,
      balance_milli: STOCK[l.item_id]![0],
      days_of_stock: STOCK[l.item_id]![1],
      est_unit_price_minor: String(PRICES[l.item_id]),
      est_total_minor: String(est),
    });
  });
  return {
    supplier: {
      id: supplierId,
      name: supplierId === "s2" ? "منظفات الخليج" : "مؤسسة الرياض للمواد الغذائية",
    },
    lines: out,
    errors,
    estimated_total_minor: out.length && !errors.length ? String(total) : "",
    estimated_partial: false,
    supplier_known_items: 3,
  };
};

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

test.describe("PUR-01", () => {
  test("loading → ready → empty: القيمة التقديرية موسومة، الملغى بسببه، ولا أوامر مفتوحة — آخرها استُلم", async ({
    page,
  }, info) => {
    let released = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = () => {
        released = true;
        r();
      };
    });
    await page.route("**/api/inventory/purchasing/orders?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("supplier_id") === "s2")
        return route.fulfill(
          json(200, list({ orders: [], open_count: 0, closed_count: 6, supplier_id: "s2" })),
        );
      if (!released) await held;
      return route.fulfill(json(200, list()));
    });
    await login(page, "/purchasing/orders");
    await expectFrame(page, info, {
      screenId: "PUR-01",
      state: "loading",
      texts: fromFrame("PUR-01", "loading", [
        "أوامر الشراء الداخلية — الأمر وعدٌ لا التزام",
        "تحميل القائمة",
        "ستة هياكل بعدد آخر قائمة معروفة، والمرشّحات فعّالة أثناء التحميل — اختيار المرشّح يعيد الطلب لا ينتظره.",
        "لا نُظهر",
        "«لا أوامر» أثناء التحميل. الفراغ حكمٌ، والقائمة لم تصل لتُحكَم.",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "PUR-01",
      state: "ready",
      texts: fromFrame("PUR-01", "ready", [
        "أوامر الشراء الداخلية — الأمر وعدٌ لا التزام",
        "أمر الشراء لا يحرّك مخزوناً ولا مالاً. الذي يحرّكهما مستند الشراء",
        "حين يُستلم ويُعتمد. الفصل بينهما يمنع أن يصير الطلبُ رصيداً.",
        "الأمر والمورد",
        "الأصناف",
        "القيمة التقديرية",
        "الحالة",
        "ما يُنتظر",
        "«القيمة التقديرية» موسومة بالتقدير في العنوان لا في حاشية. الرقم من آخر سعر شراء معروف، وقد يختلف عمّا يأتي في الفاتورة — ومن يقرأه في قائمة يبني عليه قراراً نقدياً.",
        "مفتوحة",
        "كل الموردين",
        "مؤسسة الرياض للمواد الغذائية",
        "أُنشئ أمس · ندى",
        "مُرسل",
        "ردّ المورد على الكميات. لا يتحرّك مخزون قبل الاستلام.",
        "ألبان الوادي",
        "قبل 3 أيام · سالم",
        "استُلم جزئياً",
        "وصل 4 من 6. مستند الشراء 440 يغطّي ما وصل، والباقي ينتظر أو يُلغى.",
        "مخابز السنابل",
        "قبل 4 أيام · سالم",
        "توريد يومي — يُستلم صباحاً بلا تأكيد مسبق.",
        "منظفات الخليج",
        "قبل 9 أيام · ندى",
        "ملغى",
        "أُلغي بسبب مكتوب: تغيّر السعر بعد الإرسال. الأمر يبقى في السجل ولا يُحذف.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="PUR-01"]');
    await expect(root).toContainText("أوامر الشراء — 6 مفتوحة");
    await expect(root).toContainText("سكر وأرز وزيت · 4 أصناف");
    await expect(root).toContainText("4,180.00");
    // مرشّح المورد: لا أوامر مفتوحة — حالة صحّية لا نقص
    await page.getByRole("button", { name: "منظفات الخليج" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-01",
      state: "empty",
      texts: fromFrame("PUR-01", "empty", [
        "لا أوامر مفتوحة",
        "نقول",
        "والسجل المغلق على بعد ضغطة.",
        "نعرض",
        "مدخلاً لأمر جديد ومدخلاً لاقتراح التوريد",
        "إن كانت مرحلته مفتوحة.",
      ]),
    });
    await expect(root).toContainText(
      "6 أوامر مغلقة في السجل وصفرٌ مفتوح. هذه حالة صحّية لا نقص: كل ما طُلب وصل.",
    );
    await expect(root).toContainText("«لا أوامر مفتوحة — آخرها 121 مستلَم أمس»");
    await expect(page.getByRole("button", { name: "أمر جديد" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "السجل المغلق" })).toBeVisible();
  });

  test("permission_denied: أمين المخزن يرى القائمة بلا عمود القيمة والزرّ معطّل بسببه", async ({
    page,
  }, info) => {
    await page.route("**/api/inventory/purchasing/orders?**", (route) =>
      route.fulfill(
        json(
          200,
          list({
            orders: ORDERS.map((o) => ({ ...o, estimated_total_minor: "", value_hidden: true })),
            can_create: false,
            value_hidden: true,
            ask_name: "ندى",
          }),
        ),
      ),
    );
    await login(page, "/purchasing/orders");
    await expectFrame(page, info, {
      screenId: "PUR-01",
      state: "permission_denied",
      texts: fromFrame("PUR-01", "permission_denied", [
        "أمين المخزن يرى ولا يُنشئ",
        "القائمة مرئية لأمين المخزن لأنه يستلم بناءً عليها. الإنشاء والإلغاء للمالك والمحاسب — كلاهما التزام مالي.",
        "القيمة التقديرية",
        "عمود القيمة محجوب عن أمين المخزن: عمله عدُّ الأصناف لا مطابقة المبالغ، والسعر يقود إلى التكلفة.",
        "الزرّ",
        "الصلاحية على العمود لا على الشاشة كلها: حجب الشاشة يمنعه من الاستلام أصلاً.",
      ]),
    });
    const root = page.locator('[data-screen="PUR-01"]');
    await expect(root).toContainText("مؤسسة الرياض للمواد الغذائية");
    await expect(root).not.toContainText("4,180.00");
    await expect(root.locator("th", { hasText: "القيمة التقديرية" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "أمر جديد" })).toBeDisabled();
    await expect(root).toContainText("اطلب من ندى");
  });
});

test.describe("PUR-02", () => {
  test("ready → validation_error → saving → success: وحدة الشراء ومكافئها، كمية بلا وحدة تُسأل، ثم أُرسل الأمر ولم يتحرّك مخزون", async ({
    page,
  }, info) => {
    let released = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = () => {
        released = true;
        r();
      };
    });
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/catalog/items?**", (route) =>
      route.fulfill(json(200, { items: ITEMS, total: 3, all_total: 3, groups: [], offset: 0 })),
    );
    await page.route("**/api/catalog/items", (route) =>
      route.fulfill(json(200, { items: ITEMS, total: 3, all_total: 3, groups: [], offset: 0 })),
    );
    await page.route("**/api/inventory/purchasing/orders/preview", (route) => {
      const b = route.request().postDataJSON() as {
        supplier_id: string;
        lines: { item_id: string; unit_code: string; qty_milli: string }[];
        confirmed: boolean;
      };
      return route.fulfill(json(200, preview(b.supplier_id, b.lines, b.confirmed)));
    });
    await page.route("**/api/inventory/purchasing/orders/o9/send", async (route) => {
      if (!released) await held;
      return route.fulfill(
        json(200, {
          order: { id: "o9", number: "122", status: "sent", status_label: "مُرسل", send_error: "" },
        }),
      );
    });
    await page.route(/\/api\/inventory\/purchasing\/orders(\?.*)?$/, (route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill(
          json(201, {
            order: {
              id: "o9",
              number: "122",
              status: "open",
              status_label: "مفتوحة",
              send_error: "",
            },
          }),
        );
      }
      return route.fulfill(json(200, list()));
    });
    await login(page, "/purchasing/orders/new");
    await expectFrame(page, info, {
      screenId: "PUR-02",
      state: "ready",
      texts: fromFrame("PUR-02", "ready", [
        "إنشاء أمر شراء — الوحدة التي تشتري بها لا التي تبيع بها",
        "تطلب كراتين وتبيع أكياساً. الأمر يُكتب بوحدة الشراء ويُعرض معه المكافئ بوحدة البيع، فلا يصل عشرة أضعاف ما أردت.",
        "أمر جديد — مؤسسة الرياض للمواد الغذائية",
        "الصنف",
        "الكمية ووحدة الشراء",
        "المكافئ بوحدة البيع",
        "سعر تقديري",
        "المجموع تقديري من آخر أسعار الشراء. الفاتورة قد تخالفه، والتكلفة تتبع الفاتورة لا هذا الرقم.",
        "تقديري",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="PUR-02"]');
    // ثلاثة أصناف بوحدة الشراء: المكافئ والرصيد والأيام والسعر التقديري
    const fill = async (row: number, item: string, qty: string, unit: string) => {
      await page.getByLabel("الصنف").nth(row).selectOption(item);
      await page.getByLabel("الكمية").nth(row).fill(qty);
      if (unit) await page.getByLabel("وحدة الشراء").nth(row).selectOption(unit);
    };
    await fill(0, "i1", "10", "carton");
    await expect(root).toContainText("= 100 كيس");
    await expect(root).toContainText("رصيد 8 كيس · يكفي 3 أيام");
    await page.getByRole("button", { name: "أضف صنفاً" }).click();
    await fill(1, "i2", "9", "carton");
    await expect(root).toContainText("= 36 كيس");
    await expect(root).toContainText("رصيد 14 كيس · يكفي 9 أيام");
    await page.getByRole("button", { name: "أضف صنفاً" }).click();
    await fill(2, "i3", "8", "carton");
    await expect(root).toContainText("= 96 عبوة");
    await expect(root).toContainText("رصيد 3 عبوة · يكفي يومين");
    await expect(root).toContainText("تقديري · 4,180.00");
    // صنف رابع بكمية 12 بلا وحدة → نسأل قبل الحفظ، والسطور الثلاثة تبقى
    await page.getByRole("button", { name: "أضف صنفاً" }).click();
    await fill(3, "i1", "12", "");
    await page.getByRole("button", { name: "حفظ وإرسال" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-02",
      state: "validation_error",
      texts: fromFrame("PUR-02", "validation_error", [
        "كمية بلا وحدة شراء",
        "الوحدة",
        "ماذا: كيساً أم كرتوناً. الفرق عشرة أضعاف، ويظهر يوم الاستلام لا اليوم.",
        "السطر الخاطئ وحده يُعلَّم؛ السطور",
      ]),
    });
    await expect(root).toContainText("«سكر ناعم» أُضيف بكمية 12 ولم تُختر وحدته.");
    expect(posted).toBeNull();
    await expect(page.locator(".pur-line--error")).toHaveCount(1);
    await expect(root).toContainText("= 100 كيس"); // السطور الصحيحة كما كُتبت
    await page.getByLabel("وحدة الشراء").nth(3).selectOption("carton");
    await expect(root).toHaveAttribute("data-state", "ready");
    // الحفظ ثم الإرسال منفصلان
    await page.getByRole("button", { name: "حفظ وإرسال" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-02",
      state: "saving",
      texts: fromFrame("PUR-02", "saving", [
        "جارٍ الحفظ والإرسال",
        "الحفظ والإرسال فعلان منفصلان يظهران منفصلين: يُحفظ الأمر أولاً، ثم يُرسل للمورد.",
        "لو فشل الإرسال",
        "الأمر محفوظ ومُعلَّم «لم يُرسل» مع زرّ إعادة. لا نُرجع المستخدم إلى نموذج فارغ بعد دقيقة عمل.",
        "الأزرار معطّلة والصفحة لا تُغادَر — والإلغاء متاح قبل الإرسال لا بعده.",
      ]),
    });
    await expect.poll(() => posted).not.toBeNull();
    release();
    await expectFrame(page, info, {
      screenId: "PUR-02",
      state: "success",
      texts: fromFrame("PUR-02", "success", [
        "أُرسل الأمر 122",
        "الأمر محفوظ ومُرسل. لم يتحرّك مخزون ولا ذمّة — وهذا مكتوب في شاشة النجاح لا مفترضاً.",
        "ما تغيّر",
        "أمر مفتوح في",
        "ينتظر الاستلام.",
        "ما لم يتغيّر",
        "الرصيد والتكلفة والذمّة كما كانت. تتحرّك عند اعتماد مستند الشراء.",
        "المسار التالي واحد وواضح: «تابع الأمر» — لا ثلاثة أزرار متساوية.",
      ]),
    });
    await expect(page.locator("body")).toContainText("أمر مفتوح في «أوامر الشراء» ينتظر الاستلام.");
    await expect(page.getByRole("button", { name: "تابع الأمر" })).toBeVisible();
    expect(posted).toMatchObject({ supplier_id: "s1", confirmed: false });
  });

  test("المورد لا يورّد الصنف: نسأل قبل الحفظ ثم نؤكّد؛ فشل الإرسال يبقي الأمر «لم يُرسل» مع إعادة", async ({
    page,
  }) => {
    let sends = 0;
    await page.route("**/api/catalog/items", (route) =>
      route.fulfill(json(200, { items: ITEMS, total: 3, all_total: 3, groups: [], offset: 0 })),
    );
    await page.route("**/api/inventory/purchasing/orders/preview", (route) => {
      const b = route.request().postDataJSON() as {
        supplier_id: string;
        lines: { item_id: string; unit_code: string; qty_milli: string }[];
        confirmed: boolean;
      };
      return route.fulfill(json(200, preview(b.supplier_id, b.lines, b.confirmed)));
    });
    await page.route("**/api/inventory/purchasing/orders/o9/send", (route) => {
      sends += 1;
      return sends === 1
        ? route.fulfill(
            json(400, {
              detail: "send_failed",
              field: "",
              extra: {
                order: {
                  id: "o9",
                  number: "123",
                  status: "unsent",
                  status_label: "لم يُرسل",
                  send_error: "supplier_channel_failed",
                },
              },
            }),
          )
        : route.fulfill(
            json(200, {
              order: {
                id: "o9",
                number: "123",
                status: "sent",
                status_label: "مُرسل",
                send_error: "",
              },
            }),
          );
    });
    await page.route(/\/api\/inventory\/purchasing\/orders(\?.*)?$/, (route) =>
      route.request().method() === "POST"
        ? route.fulfill(
            json(201, {
              order: {
                id: "o9",
                number: "123",
                status: "open",
                status_label: "مفتوحة",
                send_error: "",
              },
            }),
          )
        : route.fulfill(json(200, list())),
    );
    await login(page, "/purchasing/orders/new");
    const root = page.locator('[data-screen="PUR-02"]');
    await page.getByLabel("المورد").selectOption("s2");
    await page.getByLabel("الصنف").nth(0).selectOption("i1");
    await page.getByLabel("الكمية").nth(0).fill("10");
    await page.getByLabel("وحدة الشراء").nth(0).selectOption("carton");
    await page.getByRole("button", { name: "حفظ وإرسال" }).click();
    await expect(root).toHaveAttribute("data-state", "validation_error");
    await expect(root).toContainText(
      "«منظفات الخليج» لا يورّد سكر ناعم. لا نمنع — قد يكون توريداً جديداً — لكن نسأل قبل الحفظ لا بعده.",
    );
    await page.getByRole("button", { name: "نعم، توريد جديد" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await page.getByRole("button", { name: "حفظ وإرسال" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    await expect(root).toContainText("حُفظ الأمر 123 ولم يُرسل");
    await page.getByRole("button", { name: "أعد الإرسال" }).click();
    await expect(root).toContainText("أُرسل الأمر 123");
    expect(sends).toBe(2);
  });
});
