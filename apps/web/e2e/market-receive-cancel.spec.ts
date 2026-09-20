import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.14 — ORD-09 استلام جزئي ورفض كمية (5) + ORD-10 إلغاء المتبقّي (5): المشحون دعوى المورد
 * والمستلم عدّك؛ الاستلام لا يتجاوز المشحون (ACC-128)؛ دفتران مستقلان والفارق خلاف (ACC-132)؛
 * الذمّة من المستلم وحده؛ الإلغاء يطال غير المسلَّم فقط بسبب وبصلاحية حدّ مالي (ACC-129).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const ORDER = (o: Record<string, unknown> = {}) => ({
  id: "po1",
  op_id: "op1",
  number: 2041,
  number_label: "PO-2041",
  kind: "order",
  kind_label: "طلب",
  status: "preparing",
  status_label: "قيد التجهيز",
  version: 3,
  supplier_tenant_id: "t2",
  supplier_name: "مخزن البركة — تجريبي",
  buyer_name: "بقالة النيل — تجريبي",
  currency: "SDG",
  lines: [],
  lines_count: 1,
  total_minor: "",
  delivery_to: "الفرع الرئيسي",
  fees_label: "",
  note: "",
  response_hours: 72,
  deadline_at: "2026-09-22T10:00:00Z",
  sent_at: "2026-09-10T10:00:00Z",
  updated_at: "2026-09-12T10:00:00Z",
  responsibilities: [],
  no_reply: false,
  near_deadline: false,
  remaining_hours: 0,
  content_line: "",
  buyer_step: "",
  supplier_step: "",
  flagged: false,
  list_status_label: "مشحون جزئياً — 80%",
  shipped_percent: 80,
  remaining_cancelled: false,
  cancel_reason: "",
  ...o,
});

const RECEIVE = (o: Record<string, unknown> = {}) => ({
  order: ORDER(),
  shipment: {
    id: "sh2",
    number: 2,
    ref_label: "SH-118",
    shipped_at: "2026-09-12T08:00:00Z",
    received_at: "",
    received_lines: [],
    dispute_opened: false,
  },
  pending_shipments: ["SH-118"],
  lines: [
    {
      offer_id: "o1",
      public_name: "سكر أبيض",
      pack_label: "كرتونة 12×1كغ",
      unit_name: "كرتونة",
      requested: 10,
      confirmed: 8,
      shipped_in_this: 8,
      received_before: 0,
      shipped_total: 8,
      price_minor: "118000",
    },
  ],
  ...o,
});

const DETAIL_AFTER = (o: Record<string, unknown> = {}) => ({
  order: ORDER({ status: "disputed", status_label: "خلاف مفتوح", list_status_label: "خلاف مفتوح" }),
  side: "buyer",
  versions: [],
  events: [],
  agreed_version: 3,
  latest_version: 3,
  conflict: false,
  partial: true,
  ladder: [],
  received_value_minor: String(7 * 118000),
  gap_value_minor: "118000",
  ladder_rule: "",
  received: "SH-118",
  gap: 1,
  dispute_opened: true,
  ...o,
});

const BREAKDOWN = (o: Record<string, unknown> = {}) => ({
  lines: [
    {
      offer_id: "o1",
      public_name: "سكر أبيض",
      pack_label: "كرتونة 12×1كغ",
      unit_name: "كرتونة",
      confirmed: 200,
      shipped: 160,
      received: 150,
      in_transit: 10,
      cancellable: 40,
      already_cancelled: 0,
      price_minor: "118000",
    },
    {
      offer_id: "o2",
      public_name: "زيت طعام",
      pack_label: "كرتونة 4×5ل",
      unit_name: "كرتونة",
      confirmed: 120,
      shipped: 100,
      received: 100,
      in_transit: 0,
      cancellable: 20,
      already_cancelled: 0,
      price_minor: "248500",
    },
    {
      offer_id: "o3",
      public_name: "دقيق",
      pack_label: "كيس 50كغ",
      unit_name: "كيس",
      confirmed: 105,
      shipped: 70,
      received: 70,
      in_transit: 0,
      cancellable: 35,
      already_cancelled: 0,
      price_minor: "154000",
    },
  ],
  cancellable_total: 95,
  received_total: 320,
  in_transit_total: 10,
  received_value_minor: "41200000",
  shipment_refs: ["SH-01", "SH-02", "SH-03"],
  full_cancel_available: false,
  already_cancelled: false,
  cancel_reason: "",
  order: ORDER({ id: "po7", number: 7741, number_label: "ORD-7741" }),
  can_cancel: true,
  ...o,
});

async function login(page: Page, next: string, urlRe: RegExp) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(urlRe);
}

test.describe("ORD-09", () => {
  test("ready → partial → validation_error → conflict → success: العدّ لا يتجاوز المشحون، الرفض بسبب، والفارق خلاف لا تسوية", async ({
    page,
  }, info) => {
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders\/po1\/receive(\?.*)?$/, (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, RECEIVE()));
      const b = route.request().postDataJSON() as Record<string, unknown>;
      posted.push(b);
      return route.fulfill(json(200, DETAIL_AFTER()));
    });
    await login(page, "/market/orders/po1/receive", /\/market\/orders\/po1\/receive$/);
    await expect(page.getByText("أربعة أعمدة وعمود تعدّه")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-09",
      state: "ready",
      texts: fromFrame("ORD-09", "ready", [
        "أربعة أعمدة وعمود تعدّه",
        "مطلوب ومؤكَّد ومشحون — والخامس ما تعدّه أنت. والمشحون معروضٌ صراحةً.",
        "لماذا يُعرض المشحون",
        "لأنه دعوى الطرف الآخر لا رقمُ النظام (كما INV-10). أنت تُقرّ بما وصلك مقابل ما يدّعي أنه أرسله.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-09"]');
    await page.getByLabel("مستلم فعلاً — سكر أبيض").fill("7");
    await expectFrame(page, info, {
      screenId: "ORD-09",
      state: "partial",
      texts: fromFrame("ORD-09", "partial", [
        "استلام جزئي ورفض كمية — أربعة أرقام لا رقم واحد",
        "ACC-132: دفتر المشتري ودفتر البائع مستقلان، والفارق يُسجَّل خلافاً لا يُسوّى تلقائياً.",
        "استلام الشحنة",
        "SH-118",
        "من الطلب",
        "PO-2041",
        "تنفيذ جزئي",
        "الصنف",
        "مطلوب",
        "مؤكد",
        "مشحون",
        "مستلم فعلاً",
        "الفارق وسببه",
        "ما يكتبه هذا الإجراء في دفترك:",
        "إدخال مخزون بالكميات المستلمة فعلاً، وذمة للمورد بقيمة المستلم وحده. المشحون غير المستلم لا يُخصم من مخزونك ولا يُحتسب عليك.",
        "ما لا يكتبه:",
        "تسجيل الاستلام وفتح خلاف الفارق",
        "تسجيل الاستلام دون خلاف",
        "إلغاء المتبقي —",
        "ORD-10",
      ]),
    });
    await expect(root).toContainText("الشحنة الثانية · مخزن البركة — تجريبي · المستلم:");
    await expect(root).toContainText(
      "هو يقول «شحنت 8»، وأنت تقول «استلمت 7». الرقمان يبقيان، ويُفتح خلاف في ORD-12",
    );
    await page.getByLabel("مستلم فعلاً — سكر أبيض").fill("11");
    await page.getByRole("button", { name: "تسجيل الاستلام" }).first().click();
    await expectFrame(page, info, {
      screenId: "ORD-09",
      state: "validation_error",
      texts: fromFrame("ORD-09", "validation_error", [
        "استلام يتجاوز المتبقّي",
        "رفض خادمي لا تحذير",
        "الاستلام التراكمي لا يتجاوز المشحون (ACC-128). الزيادة تُسجَّل بسبب مكتوب وتُحال إلى مراجعة الفرق.",
      ]),
    });
    await expect(root).toContainText("المتبقّي 8 والعدّ 11.");
    expect(posted).toHaveLength(0);
    await page.getByLabel("مستلم فعلاً — سكر أبيض").fill("6");
    await page.getByLabel("مرفوض — سكر أبيض").fill("2");
    await expectFrame(page, info, {
      screenId: "ORD-09",
      state: "conflict",
      texts: fromFrame("ORD-09", "conflict", [
        "رفض كمية يدّعي البائع تسليمها",
        "دفتران مستقلان",
        "لا تسوية تلقائية ولا ترجيح (ACC-132). كلٌّ يقيّد ما يقرّ به، والفرق محجوز حتى يُغلق.",
        "البابُ خلاف",
        "المسار المعروض «افتح خلافاً بالأدلة» (ORD-12) لا «صحّح الكمية». تصحيحُ رقمٍ يخفي نزاعاً.",
      ]),
    });
    await page.getByLabel("سبب الفارق — سكر أبيض").fill("صندوقان تالفان");
    await page.getByRole("button", { name: "تسجيل الاستلام وفتح خلاف الفارق" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-09",
      state: "success",
      texts: fromFrame("ORD-09", "success", [
        "سُجّل الاستلام",
        "ما دخل المخزون، وما رُفض ومصيره: مرتجعٌ للمورد أو حجرٌ حتى القرار.",
        "الذمّة من المستلم",
        "تُقيَّد قيمة ما استُلم فقط. والمرفوض لا يُقيَّد ولا يُحذف — يبقى بندَ مطالبة.",
      ]),
    });
    await expect(root).toContainText("SH-118 · الفارق 1 — فُتح خلاف الفارق (ORD-12)");
    await expect(root).toContainText("قيمة المستلم 8,260.00");
    const sent = posted[0] as {
      open_dispute: boolean;
      lines: { qty_received: number; qty_rejected: number; reason: string }[];
    };
    expect(sent.open_dispute).toBe(true);
    expect(sent.lines[0]).toMatchObject({
      qty_received: 6,
      qty_rejected: 2,
      reason: "صندوقان تالفان",
    });
  });
});

test.describe("ORD-10", () => {
  test("ready → validation_error → partial → success: ما يُلغى وما لا يُلغى، السبب مطلوب، الحوار هو الجدول، والحالة النهائية دقيقة", async ({
    page,
  }, info) => {
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders\/po7\/cancel-remaining$/, (route) => {
      if (route.request().method() === "GET") return route.fulfill(json(200, BREAKDOWN()));
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill(
        json(
          200,
          BREAKDOWN({
            already_cancelled: true,
            cancellable_total: 0,
            order: ORDER({
              id: "po7",
              number: 7741,
              number_label: "ORD-7741",
              remaining_cancelled: true,
              list_status_label: "مكتمل جزئياً — أُلغي المتبقّي",
            }),
          }),
        ),
      );
    });
    await login(
      page,
      "/market/orders/po7/cancel-remaining",
      /\/market\/orders\/po7\/cancel-remaining$/,
    );
    await expect(page.getByText("ما يُلغى وما لا يُلغى")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-10",
      state: "ready",
      texts: fromFrame("ORD-10", "ready", [
        "ما يُلغى وما لا يُلغى",
        "تُعرض الكميات الثلاث قبل التأكيد: المستلم يبقى، والمشحون في الطريق يحتاج قراراً، والمتبقّي غير المشحون يُلغى.",
        "لا محو لما وقع",
        "المسلَّم والمسجَّل مالياً لا يُمسّ (ACC-129). الإلغاء يُقفل الباقي ولا يُعيد التاريخ.",
        "المشحون ليس متبقّياً",
        "بضاعةٌ خرجت من مخزن المورد لا تُلغى بضغطة مشترٍ. تُستلم أو تُرتجع بمستند.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-10"]');
    await expect(
      page.getByRole("button", { name: "إلغاء الطلب كاملاً — غير متاح" }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: /^إلغاء 95 كرتونة غير المشحونة/ }).click();
    await expectFrame(page, info, {
      screenId: "ORD-10",
      state: "validation_error",
      texts: fromFrame("ORD-10", "validation_error", [
        "إلغاء المتبقي — ماذا يُلغى بالضبط",
        "الإلغاء يحتاج سبباً مكتوباً يظهر لطرفي الطلب. «لم يُسلَّم في الموعد» ليس تهمة بل بند في سجل الاتفاق.",
        "إلغاء الطلب كاملاً — غير متاح",
        "يُلغى",
        "المؤكد غير المشحون. يخرج من الطلب ولا يُحتسب عليك ولا على المورد.",
        "لا يُلغى — سُلِّم",
        "مستلم ومسجَّل في مخزونك وذمتك. الإلغاء لا يسترد بضاعة بحوزتك.",
        "لا يُلغى — محل خلاف",
      ]),
    });
    await expect(root).toContainText("الإلغاء لا يُنهي خلافاً قائماً.");
    expect(posted).toHaveLength(0);
    await page
      .getByLabel("سبب الإلغاء — مطلوب ويراه المورد")
      .fill("تأخّر المتبقّي عن موسم الطلب — دبّرنا البديل محلياً.");
    await page.getByRole("button", { name: /^إلغاء 95 كرتونة غير المشحونة/ }).click();
    await expectFrame(page, info, {
      screenId: "ORD-10",
      state: "partial",
      texts: fromFrame("ORD-10", "partial", [
        "إلغاء المتبقّي — لا محو لما سُلّم أو سُجّل مالياً",
        "الإلغاء يطال",
        "غير المسلَّم فقط",
        "إجراء لا رجعة فيه",
        "إلغاء متبقّي الطلب",
        "ORD-7741",
        "اقرأ ما سيُلغى وما سيبقى قبل التأكيد. هذا الجدول هو الحوار نفسه لا ملحقاً له.",
        "يبقى — مستلَم",
        "يُلغى — متبقٍّ",
        "لن يُمسّ:",
        "سبب الإلغاء — مطلوب ويراه المورد",
        "تأخّر المتبقّي عن موسم الطلب — دبّرنا البديل محلياً.",
        "إلغاء المتبقّي — 95 كرتونة",
        "رجوع",
        "سكر أبيض — كرتونة 12×1كغ",
        "زيت طعام — كرتونة 4×5ل",
        "دقيق — كيس 50كغ",
      ]),
    });
    await expect(root).toContainText(
      "320 كرتونة مستلَمة دخلت المخزون، ومستندات الاستلام SH-01/02/03، ومبلغ 412,000.00 SDG المسجَّل على الذمّة. الإلغاء ليس تسوية مالية.",
    );
    await page.getByRole("button", { name: "إلغاء المتبقّي — 95 كرتونة" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-10",
      state: "success",
      texts: fromFrame("ORD-10", "success", [
        "الحالة النهائية دقيقة",
        "الطلب صار «مكتمل جزئياً — أُلغي المتبقّي». لا نسمّيه «ملغى» فذلك يمحو من التاريخ",
      ]),
    });
    expect(posted[0]).toEqual({ reason: "تأخّر المتبقّي عن موسم الطلب — دبّرنا البديل محلياً." });
  });

  test("permission_denied: أمين المخزن يحاول الإلغاء — قيمة المتبقّي وزرّ «طلب إلغاء من المالك»", async ({
    page,
  }, info) => {
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders\/po7\/cancel-remaining$/, (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, BREAKDOWN({ can_cancel: false })));
      posted.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill(json(200, BREAKDOWN({ can_cancel: false })));
    });
    await login(
      page,
      "/market/orders/po7/cancel-remaining",
      /\/market\/orders\/po7\/cancel-remaining$/,
    );
    await expectFrame(page, info, {
      screenId: "ORD-10",
      state: "permission_denied",
      texts: fromFrame("ORD-10", "permission_denied", [
        "أمين المخزن يحاول الإلغاء",
        "إلغاء المتبقّي التزام تجاري تجاه مورد، فهو صلاحية من يملك حدّاً مالياً لا من يستلم البضاعة.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-10"]');
    await expect(root).toContainText("قيمة المتبقّي: 150,800.00 · 95 كرتونة");
    await expect(page.getByRole("button", { name: /إلغاء .* غير المشحونة/ })).toHaveCount(0);
    await page.getByRole("button", { name: "طلب إلغاء من المالك" }).click();
    await expect(root).toContainText("أُرسل الطلب إلى المالك");
    expect(posted).toEqual([{ request: true }]);
  });
});
