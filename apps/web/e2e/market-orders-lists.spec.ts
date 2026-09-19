import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.11 — ORD-03 طلبات المشتري (5) + ORD-04 طلبات المورد (4): كلٌّ يرى طرفه فقط؛ الفلتر يُعلن ما
 * يُخفي ولا «إجمالي كل الطلبات»؛ المسودة المحلية بلا رقم (`pending_sync`)؛ المهلة تنقضي وعدم الرد
 * حالة لا فراغ — «لم يُرد عليه» لا «مرفوض»، وللمشتري إعادة الإرسال.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const ORDER = (o: Record<string, unknown> = {}) => ({
  id: "po1",
  op_id: "op1",
  number: 2041,
  number_label: "PO-2041",
  kind: "order",
  kind_label: "طلب",
  status: "sent",
  status_label: "بانتظار رد المورد",
  version: 1,
  supplier_tenant_id: "t2",
  supplier_name: "مخزن البركة — تجريبي",
  buyer_name: "بقالة النيل — تجريبي",
  currency: "SDG",
  lines: [],
  lines_count: 2,
  total_minor: "1702000",
  delivery_to: "الفرع الرئيسي",
  fees_label: "",
  note: "",
  response_hours: 72,
  deadline_at: hoursFromNow(48),
  sent_at: daysAgo(1),
  updated_at: new Date(Date.now() - 3_600_000).toISOString(),
  responsibilities: [],
  no_reply: false,
  near_deadline: false,
  remaining_hours: 48,
  content_line: "سكر أبيض كرتونة 12×1كغ ×40 · شاي ×15",
  buyer_step: "بانتظار رد المورد",
  supplier_step: "أعِدّ عرض سعر (ORD-06) أو اعتذر بسبب.",
  flagged: false,
  list_status_label: "بانتظار رد المورد",
  ...o,
});

const BUYER_ROWS = [
  ORDER(),
  ORDER({
    id: "po2",
    number: 2077,
    number_label: "PO-2077",
    supplier_name: "متجر الأمان — تجريبي",
    status: "quoted",
    status_label: "عرض سعر من المورد",
    list_status_label: "عرض سعر من المورد",
    buyer_step: "قارن العرض واقبله أو ارفضه (ORD-07)",
    content_line: "زيت 5 لتر ×60",
  }),
  ORDER({
    id: "po3",
    number: 1990,
    number_label: "PO-1990",
    supplier_name: "موردون بالجملة — تجريبي",
    status: "disputed",
    status_label: "خلاف مفتوح",
    list_status_label: "خلاف مفتوح",
    buyer_step: "خلاف مفتوح — تابع أدلته (ORD-12)",
    flagged: true,
    content_line: "دقيق 50كغ ×30",
  }),
];

const BUYER = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
  orders: rows,
  awaiting_count: 1,
  hidden_by_filter: rows.filter((r) => (r as { flagged: boolean }).flagged).length,
  fetched_at: new Date().toISOString(),
  ...extra,
});

const INCOMING = (rows: unknown[]) => {
  const typed = rows as {
    status: string;
    no_reply: boolean;
    near_deadline: boolean;
    remaining_hours: number;
  }[];
  const active = typed.filter((r) => r.status === "sent" && !r.no_reply);
  return {
    orders: rows,
    counts: {
      all: rows.length,
      awaiting: active.length,
      near: active.filter((r) => r.near_deadline).length,
      no_reply: typed.filter((r) => r.no_reply).length,
    },
    ending_today: active.filter((r) => r.remaining_hours < 24).length,
    fetched_at: new Date().toISOString(),
  };
};

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

test.describe("ORD-03", () => {
  test("loading → ready → stale: الفلتر يُخفي بإعلان، الوقت مع كل صفّ، ولا «إجمالي كل الطلبات»، ثم من آخر مطابقة", async ({
    page,
    context,
  }, info) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/market\/orders$/, async (route) => {
      if (!released) await held;
      return route.fulfill(json(200, BUYER(BUYER_ROWS)));
    });
    await login(page, "/market/orders", /\/market\/orders$/);
    await expectFrame(page, info, {
      screenId: "ORD-03",
      state: "loading",
      texts: fromFrame("ORD-03", "loading", [
        "جلب الطلبات",
        "مع عدد ما ينتظر ردّاً — أول ما يُبحث عنه.",
      ]),
    });
    released = true;
    release();
    await expect(page.getByText("الفلتر يُخفي")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-03",
      state: "ready",
      texts: fromFrame("ORD-03", "ready", [
        "قوائم الطلبات — الفلتر يُعلن ما يُخفي",
        "طلب محل خلاف أو معلَّق بعد استعادة لا يختفي من القائمة بصمت: يظهر عدده ومكان إظهاره.",
        "قائمة الشراء",
        "قائمة البيع",
        "الحالة: قائمة",
        "أظهرها",
        "الطلب والطرف",
        "القيمة",
        "الحالة الحقيقية",
        "الخطوة التي تنتظرك",
        "طلباتي",
        "مخزن البركة — تجريبي",
        "بانتظار رد المورد",
        "متجر الأمان — تجريبي",
      ]),
    });
    const root = page.locator('[data-screen="ORD-03"]');
    await expect(root).toContainText("الفلتر يُخفي 1");
    await expect(root).not.toContainText("موردون بالجملة — تجريبي");
    await expect(root).not.toContainText("إجمالي كل الطلبات:");
    await expect(root).toContainText("لا عمود «إجمالي كل الطلبات»");
    await expect(root).toContainText("PO-2041 · سكر أبيض كرتونة 12×1كغ ×40 · شاي ×15");
    await expect(root).toContainText("17,020.00 SDG");
    await expect(root).toContainText("قبل ساعة");
    await page.getByRole("button", { name: "أظهرها" }).click();
    await expect(root).toContainText("موردون بالجملة — تجريبي");
    await expect(root).toContainText("خلاف مفتوح");
    await expect(root).toContainText("يظهر رغم الفلتر بإعلان");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ORD-03",
      state: "stale",
      texts: fromFrame("ORD-03", "stale", [
        "حالات من آخر مطابقة",
        "الوقت مع كل صفّ",
        "لا في الترويسة وحدها. «مؤكَّد» عمرها ساعة قد تكون «مشحون» الآن، ومن يقرأها يقرّر نقلاً.",
      ]),
    });
    await expect(root).toContainText("، وقد شُحن طلبٌ أو انتهت مهلة عرض.");
    await context.setOffline(false);
  });

  test("empty → pending_sync: لا طلبات بعد، ثم مسودة محلية بلا رقم طلب مع طلب لم يُرد عليه يُعاد إرساله", async ({
    page,
  }, info) => {
    let rows: unknown[] = [];
    const resent: string[] = [];
    await page.route(/\/api\/market\/orders$/, (route) =>
      route.fulfill(json(200, BUYER(rows, { awaiting_count: 0 }))),
    );
    await page.route(/\/api\/market\/orders\/po9\/resend$/, (route) => {
      resent.push("po9");
      rows = [ORDER({ id: "po9", version: 2 })];
      return route.fulfill(json(200, { order: rows[0] }));
    });
    await login(page, "/market/orders", /\/market\/orders$/);
    await expectFrame(page, info, {
      screenId: "ORD-03",
      state: "empty",
      texts: fromFrame("ORD-03", "empty", [
        "لا طلبات",
        "منشأةٌ لم تشترِ من السوق بعد.",
        "المسار",
        "مدخل السوق (MP-01). والفراغ هنا بدايةٌ لا عطب — الشراء المحلي قائمٌ بلا سوق.",
      ]),
    });
    rows = [
      ORDER({
        id: "po9",
        no_reply: true,
        list_status_label: "لم يُرد عليه",
        buyer_step: "لم يُرد عليه — أعد الإرسال أو توجّه لمورد آخر",
        deadline_at: daysAgo(1),
      }),
    ];
    await page.evaluate(() => {
      localStorage.setItem(
        "market.cart",
        JSON.stringify({
          at: new Date().toISOString(),
          data: [
            {
              offer_id: "o7",
              seller_tenant_id: "t3",
              seller_name: "متجر الأمان — تجريبي",
              public_name: "أرز",
              pack_label: "كيس 25كغ",
              unit_name: "كيس",
              price_minor: "",
              currency: "SDG",
              confirmed_at: "",
              valid_until: "",
              qty: 3,
            },
          ],
        }),
      );
    });
    await page.getByRole("link", { name: "السلة" }).first().click();
    await expect(page).toHaveURL(/\/market\/cart$/);
    await page.getByRole("link", { name: "طلباتي" }).first().click();
    await expect(page).toHaveURL(/\/market\/orders$/);
    await expectFrame(page, info, {
      screenId: "ORD-03",
      state: "pending_sync",
      texts: fromFrame("ORD-03", "pending_sync", [
        "جزئي",
        "متجر الأمان — تجريبي",
        "مسودة محلية بلا سعر محمَّل · لا رقم طلب",
        "مسودة",
        "مخزن البركة — تجريبي",
      ]),
    });
    const root = page.locator('[data-screen="ORD-03"]');
    await expect(root).toContainText("لم يُرد عليه");
    await expect(root).not.toContainText("مرفوض");
    await page.getByRole("button", { name: "أعد الإرسال" }).click();
    await expect(root).toContainText("بانتظار رد المورد");
    expect(resent).toEqual(["po9"]);
  });
});

test.describe("ORD-04", () => {
  test("loading → ready: الواردة بالمهلة لا بالتاريخ — بانتظار ردّي، مهلة قاربت، رُدّ عليه", async ({
    page,
  }, info) => {
    const rows = [
      ORDER({
        id: "s1",
        number: 2093,
        number_label: "RQ-2093",
        buyer_name: "سوبرماركت النيل — تجريبي",
        content_line: "زيت 5 لتر ×60",
        near_deadline: true,
        remaining_hours: 0,
        deadline_at: hoursFromNow(0.02),
        supplier_step: "الأقرب انقضاءً في الأعلى دائماً — الترتيب بالمهلة لا بالتاريخ.",
      }),
      ORDER({
        id: "s2",
        buyer_name: "بقالة النيل — تجريبي",
        remaining_hours: 20,
        deadline_at: hoursFromNow(20),
        response_hours: 24,
      }),
      ORDER({
        id: "s3",
        number: 2050,
        number_label: "RQ-2050",
        kind: "quote",
        kind_label: "طلب سعر",
        buyer_name: "مخزن الأمل — تجريبي",
        content_line: "دقيق 50كغ ×30",
        status: "quoted",
        status_label: "عرض سعر من المورد",
        list_status_label: "عرض سعر من المورد",
        supplier_step: "عرضك بانتظار قرار المشتري. لا يتجدّد تلقائياً عند انقضائه.",
        updated_at: "2026-09-12T10:00:00Z",
      }),
    ];
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/market\/orders\/incoming$/, async (route) => {
      if (!released) await held;
      return route.fulfill(json(200, INCOMING(rows)));
    });
    await login(page, "/market/orders/incoming", /\/market\/orders\/incoming$/);
    await expectFrame(page, info, {
      screenId: "ORD-04",
      state: "loading",
      texts: fromFrame("ORD-04", "loading", [
        "جلب الطلبات الواردة",
        "مع عدد المهل التي تنتهي اليوم، والترتيب بالمهلة لا بتاريخ الورود.",
        "المهلة هي العمل",
        "الطلب بلا رد ضررٌ على الطرفين: المشتري ينتظر والمورد يخسر. القائمة تُرتَّب بما يحرق.",
      ]),
    });
    released = true;
    release();
    await expect(page.getByText("الطلبات الواردة —")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-04",
      state: "ready",
      texts: fromFrame("ORD-04", "ready", [
        "طلبات المورد — المهلة تنقضي، وعدم الرد حالة لا فراغ",
        "شاشة المورد الواردة: كل طلب بمهلة رد ظاهرة. انقضاء المهلة يُوسم «لم يُرد عليه» صراحةً عند الطرفين، ولا يُقرأ قبولاً ولا رفضاً.",
        "الطلب والمشتري",
        "المحتوى",
        "المهلة",
        "الحالة والإجراء",
        "بقالة النيل — تجريبي",
        "متبقٍّ",
        "أعِدّ عرض سعر (ORD-06) أو اعتذر بسبب.",
        "بانتظار ردّك",
        "سوبرماركت النيل — تجريبي",
        "زيت 5 لتر ×60",
        "تنقضي اليوم",
        "الأقرب انقضاءً في الأعلى دائماً — الترتيب بالمهلة لا بالتاريخ.",
        "مهلة قاربت",
        "مخزن الأمل — تجريبي",
        "طلب سعر — دقيق 50كغ ×30",
        "رُدّ عليه 12/09",
        "رُدّ عليه",
      ]),
    });
    const root = page.locator('[data-screen="ORD-04"]');
    await expect(root).toContainText("الطلبات الواردة — 3");
    await expect(root).toContainText("متبقٍّ 20 من 24 ساعة");
    await expect(root).toContainText("لم يُرد عليه — 0");
    await page.getByRole("button", { name: /مهلة قاربت — 1/ }).click();
    await expect(root).not.toContainText("بقالة النيل — تجريبي");
    await expect(root).toContainText("سوبرماركت النيل — تجريبي");
  });

  test("expired: مهلة منقضية بلا رد — «لم يُرد عليه» لا «مرفوض»، في أرشيف مستقلّ", async ({
    page,
  }, info) => {
    const rows = [
      ORDER({
        id: "s2",
        buyer_name: "بقالة النيل — تجريبي",
        remaining_hours: 20,
        deadline_at: hoursFromNow(20),
      }),
      ORDER({
        id: "s4",
        number: 2001,
        number_label: "RQ-2001",
        buyer_name: "بقالة الصفا — تجريبي",
        content_line: "معلّبات متنوّعة ×22",
        no_reply: true,
        list_status_label: "لم يُرد عليه",
        deadline_at: daysAgo(3),
        supplier_step: "لا يُقرأ رفضاً. في أرشيف «لم يُرد عليه»، وللمشتري إعادة الإرسال.",
      }),
    ];
    await page.route(/\/api\/market\/orders\/incoming$/, (route) =>
      route.fulfill(json(200, INCOMING(rows))),
    );
    await login(page, "/market/orders/incoming", /\/market\/orders\/incoming$/);
    await expectFrame(page, info, {
      screenId: "ORD-04",
      state: "expired",
      texts: fromFrame("ORD-04", "expired", [
        "مهلة منقضية",
        "انقضت مهلته بلا رد. لا نحوّله إلى «مرفوض» — الرفض قرار، وعدم الرد ليس قراراً. المشتري يرى «لم يُرد عليه» مع خيار إعادة الإرسال أو التوجّه لمورد آخر، والمورد يرى الطلب في أرشيف مستقلّ لا في المهملات.",
        "بقالة الصفا — تجريبي",
        "معلّبات متنوّعة ×22",
        "انقضت",
        "قبل 3 أيام",
        "لا يُقرأ رفضاً. في أرشيف «لم يُرد عليه»، وللمشتري إعادة الإرسال.",
        "لم يُرد عليه",
      ]),
    });
    const root = page.locator('[data-screen="ORD-04"]');
    await expect(root).toContainText("لم يُرد عليه — 1");
    await expect(root).not.toContainText("مرفوض —");
  });

  test("empty: لا طلبات بيع بعد — أنت مشترٍ ولم تصبح بائعاً بعد", async ({ page }, info) => {
    await page.route(/\/api\/market\/orders\/incoming$/, (route) =>
      route.fulfill(json(200, INCOMING([]))),
    );
    await login(page, "/market/orders/incoming", /\/market\/orders\/incoming$/);
    await expectFrame(page, info, {
      screenId: "ORD-04",
      state: "empty",
      texts: fromFrame("ORD-04", "empty", [
        "لا طلبات بيع بعد",
        "قائمة البيع تعرض ما يصلك من مشترين. تبقى فارغة حتى تُفعّل دور البائع وتنشر أول عرض —",
        "MP-08",
        "الفراغ هنا ليس عطلاً: أنت مشترٍ ولم تصبح بائعاً بعد.",
      ]),
    });
  });
});
