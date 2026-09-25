import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.15 — PUR-05 التكلفة والهامش (4): الشاشة كلها محجوبة عن غير المالك والمحاسب؛ بلا تفعيل
 * `phase_locked` بلقطة «مثال» وزرّ «فعّل الشراء الداخلي» حاضر؛ بلا مستند «لا تكلفة بعد» بأعمدة
 * فارغة؛ الهامش السالب بلونه، لا هامش من وحدتين، ومستند واحد يُقال عنه ذلك.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const ROWS = [
  {
    item_id: "i1",
    item_name: "سكر ناعم — كيس 1 كجم",
    base_unit_name: "كيس",
    sale_price_minor: "6500",
    cost_minor: "5300",
    cost_unit_name: "كرتون",
    method_label: "متوسط مرجّح · 3 مستندات",
    docs_count: 3,
    margin_bps: null,
    note: "unit_mismatch",
    note_extra: {},
  },
  {
    item_id: "i2",
    item_name: "أرز بسمتي 5 كجم",
    base_unit_name: "كيس",
    sale_price_minor: "4200",
    cost_minor: "3600",
    cost_unit_name: "كيس",
    method_label: "متوسط مرجّح · 5 مستندات",
    docs_count: 5,
    margin_bps: 1429,
    note: "stable",
    note_extra: { months: 4 },
  },
  {
    item_id: "i3",
    item_name: "زيت دوّار الشمس 1.5 ل",
    base_unit_name: "عبوة",
    sale_price_minor: "1050",
    cost_minor: "921",
    cost_unit_name: "عبوة",
    method_label: "متوسط مرجّح · 4 مستندات",
    docs_count: 4,
    margin_bps: 1229,
    note: "cost_rose",
    note_extra: { document_number: "441", previous_margin_bps: 1400, price_moved: false },
  },
  {
    item_id: "i4",
    item_name: "خبز صامولي",
    base_unit_name: "رغيف",
    sale_price_minor: "100",
    cost_minor: "110",
    cost_unit_name: "رغيف",
    method_label: "آخر سعر شراء",
    docs_count: 9,
    margin_bps: -1000,
    note: "negative",
    note_extra: {},
  },
  {
    item_id: "i5",
    item_name: "عسل الواحة 1 كجم",
    base_unit_name: "علبة",
    sale_price_minor: "4500",
    cost_minor: "3000",
    cost_unit_name: "علبة",
    method_label: "مستند واحد",
    docs_count: 1,
    margin_bps: 3333,
    note: "single_doc",
    note_extra: {},
  },
];

const report = (o: Record<string, unknown> = {}) => ({
  state: "ready",
  policy: "weighted_average",
  can_enable: true,
  rows: ROWS,
  items_count: 12,
  ...o,
});

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

test.describe("PUR-05", () => {
  test("ready: التكلفة بطريقتها وعدد مستنداتها، شرطة لوحدتين، سالب بلونه، ومستند واحد", async ({
    page,
  }, info) => {
    await page.route("**/api/inventory/purchasing/cost-margin", (route) =>
      route.fulfill(json(200, report())),
    );
    await login(page, "/purchasing/cost-margin");
    await expectFrame(page, info, {
      screenId: "PUR-05",
      state: "ready",
      texts: fromFrame("PUR-05", "ready", [
        "التكلفة والهامش — الرقم الذي لا يُعرض إلا لمن يملكه",
        "التكلفة تتبع مستندات الشراء بالمتوسط المرجّح، وتتغيّر مع كل استلام. والهامش مشتقٌّ منها ومن سعر البيع — فمن يرى الهامش يرى التكلفة ضمناً، ولذلك صلاحيتهما واحدة.",
        "التكلفة والهامش — 12 صنفاً",
        "مرئية للمالك والمحاسب",
        "الصنف",
        "التكلفة",
        "سعر البيع",
        "الهامش",
        "ملاحظة",
        "الهامش السالب يُعرض بلونه ولا يُنبَّه عليه بنافذة: بيعٌ بخسارة قد يكون قراراً واعياً (تصريف قارب الانتهاء) وقد يكون سهواً. الشاشة تُري ولا تحكم — والحكم في يد من يملك السعر.",
        "سكر ناعم — كيس 1 كجم",
        "متوسط مرجّح · 3 مستندات",
        "الوحدتان مختلفتان: التكلفة للكرتون والسعر للكيس. لا نحسب هامشاً من وحدتين — نُظهر شرطة ونطلب ضبط التحويل.",
        "أرز بسمتي 5 كجم",
        "متوسط مرجّح · 5 مستندات",
        "مستقرّ منذ أربعة أشهر.",
        "زيت دوّار الشمس 1.5 ل",
        "متوسط مرجّح · 4 مستندات",
        "التكلفة ارتفعت بمستند 441 والسعر لم يتحرّك. الهامش كان 14%",
        "خبز صامولي",
        "آخر سعر شراء",
        "بيع بخسارة. قد يكون مقصوداً —",
        "— والشاشة لا تحكم.",
        "عسل الواحة 1 كجم",
        "مستند واحد",
        "مبنيّ على مستند واحد — المتوسط يصير ذا معنى بعد ثلاثة.",
      ]),
    });
    await expect(page.locator(".pur-neg")).toHaveText("-10%");
    await expect(page.locator("td", { hasText: /^—$/ })).toHaveCount(1);
  });

  test("phase_locked → empty: لقطة «مثال» خلف القفل، «فعّل الشراء الداخلي» زرٌّ حاضر، ثم لا تكلفة بعد بأعمدة فارغة", async ({
    page,
  }, info) => {
    let enabled = false;
    await page.route("**/api/inventory/purchasing/cost-margin", (route) => {
      if (route.request().method() === "POST") enabled = true;
      return route.fulfill(
        json(
          200,
          enabled
            ? report({
                state: "empty",
                items_count: 2,
                rows: [
                  {
                    item_id: "i1",
                    item_name: "سكر",
                    base_unit_name: "كيلو",
                    sale_price_minor: "10000",
                    cost_minor: "",
                    method_label: "",
                    margin_bps: null,
                    note: "",
                  },
                  {
                    item_id: "i2",
                    item_name: "شاي",
                    base_unit_name: "كيلو",
                    sale_price_minor: "5000",
                    cost_minor: "",
                    method_label: "",
                    margin_bps: null,
                    note: "",
                  },
                ],
              })
            : report({
                state: "phase_locked",
                items_count: 0,
                rows: [
                  {
                    item_name: "سكر ناعم — كيس 1 كجم",
                    method_label: "متوسط مرجّح · 3 مستندات",
                    cost_minor: "5300",
                    sale_price_minor: "6500",
                    margin_bps: 1846,
                    note: "example",
                  },
                ],
              }),
        ),
      );
    });
    await login(page, "/purchasing/cost-margin");
    await expectFrame(page, info, {
      screenId: "PUR-05",
      state: "phase_locked",
      texts: fromFrame("PUR-05", "phase_locked", [
        "الشراء الداخلي غير مفعّل",
        "المنشأة لم تفعّل وحدة الشراء الداخلي. لا تكلفة محسوبة لأن لا مستندات شراء أصلاً — والقفل هنا صدقٌ لا منع.",
        "صيغة «مشروط»",
        "الوحدة مبنيّة وتنتظر مفتاحاً في يد المالك: «فعّل الشراء الداخلي» زرٌّ حاضر، لا «تواصل مع المبيعات».",
        "ما نُريه خلف القفل",
        "لقطة حقيقية بأرقام تجريبية موسومة «مثال» — القرار بالتفعيل يحتاج أن يرى ما سيحصل عليه.",
        "يفترق هذا عن قفل",
        "ذاك قرار منتج لم يُفتح بعد، وهذا مفتاح في يد المالك الآن.",
        "سكر ناعم — كيس 1 كجم",
        "مثال",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "يفترق هذا عن قفل المرحلة: ذاك قرار منتج لم يُفتح بعد",
    );
    await page.getByRole("button", { name: "فعّل الشراء الداخلي" }).click();
    await expectFrame(page, info, {
      screenId: "PUR-05",
      state: "empty",
      texts: fromFrame("PUR-05", "empty", [
        "لا تكلفة بعد",
        "المنشأة تبيع ولم تُسجّل مستند شراء واحداً — أصنافها أُدخلت برصيد افتتاحي بلا سعر تكلفة.",
        "نقول السبب",
        "«التكلفة تُبنى من مستندات الشراء، ولم يُسجَّل مستند بعد» — لا «لا بيانات».",
        "المخرج",
        "سجّل مستند شراء، أو أدخل تكلفة افتتاحية يدوية تُوسم «يدوية» وتُستبدل بأول مستند حقيقي.",
        "الجدول يُعرض بأعمدته فارغةً ليُفهم ما الذي سيملؤه، لا رسالة في وسط شاشة بيضاء.",
        "الصنف",
        "التكلفة",
        "سعر البيع",
        "الهامش",
        "ملاحظة",
      ]),
    });
    expect(enabled).toBe(true);
    await expect(page.getByRole("button", { name: "فعّل الشراء الداخلي" })).toHaveCount(0);
  });

  test("permission_denied: الكاشير يرى القفل لا الأرقام — الشاشة كلها محجوبة", async ({
    page,
  }, info) => {
    await page.route("**/api/inventory/purchasing/cost-margin", (route) =>
      route.fulfill(
        json(403, { detail: "permission_denied", field: "", extra: { role_name: "كاشير" } }),
      ),
    );
    await login(page, "/purchasing/cost-margin");
    await expectFrame(page, info, {
      screenId: "PUR-05",
      state: "permission_denied",
      texts: fromFrame("PUR-05", "permission_denied", [
        "الشاشة كلها محجوبة",
        "الاستثناء الوحيد في النظام: هنا نحجب الشاشة لا عموداً منها. كل رقم فيها يقود إلى التكلفة — والهامش يكشفها بالطرح.",
        "لماذا لا نحجب عموداً",
        "إخفاء التكلفة وإبقاء الهامش والسعر يعني إعطاءها: التكلفة = السعر ÷ (1 + الهامش). الحجب الجزئي هنا وهمٌ لا سياسة.",
        "ما يبقى",
        "الشاشة تظهر في القائمة بقفل مرئي لا تختفي — الموظف يعرف أن ثمّة تقريراً يطلبه إن احتاجه.",
        "للمالك والمحاسب فقط، والقائمة معرّفة في ORG لا في الكود.",
      ]),
    });
    await expect(page.getByRole("columnheader", { name: "سعر البيع" })).toHaveCount(0);
  });
});
