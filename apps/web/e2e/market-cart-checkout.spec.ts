import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.10 — ORD-01 سلة ومسودة طلب (5 مرسومة) + ORD-02 مراجعة وإرسال (6): كل مورد اتفاقٌ منفصل ولا
 * مجموع كلّي (ACC-126)؛ المسودة لا تُثبّت سعراً والسعر المتغيّر يُقبل سطراً سطراً (ACC-123)؛ الحدّ
 * الأدنى بالفارق؛ بلا اتصال لا رقم طلب؛ الإرسال فعلٌ واحد بمعرّف واحد وإعادة المحاولة تعيد الطلب
 * نفسه (ACC-124)؛ لا تحويل عملة (ACC-140)؛ «أُرسل» ليست «قُبل».
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const line = (o: Record<string, unknown> = {}) => ({
  offer_id: "o1",
  seller_tenant_id: "t2",
  seller_name: "مخزن البركة — تجريبي",
  public_name: "سكر أبيض",
  pack_label: "كرتونة 12×1كغ",
  unit_name: "كرتونة",
  price_minor: "118000",
  currency: "SDG",
  confirmed_at: "2026-09-18T10:00:00Z",
  valid_until: "2026-09-25",
  qty: 6,
  min_order_qty: 5,
  fees_label: "توصيل داخل المنطقة مشمول",
  ...o,
});

const CART = [
  line(),
  line({
    offer_id: "o2",
    public_name: "زيت قلي",
    pack_label: "كرتونة 12×1لتر",
    price_minor: "248500",
    qty: 4,
    min_order_qty: 1,
  }),
  line({
    offer_id: "o3",
    seller_tenant_id: "t3",
    seller_name: "متجر الأمان — تجريبي",
    public_name: "أرز",
    pack_label: "كيس 25كغ",
    unit_name: "كيس",
    price_minor: "154000",
    qty: 3,
    min_order_qty: 10,
    fees_label: "رسوم النقل تُحدَّد عند الطلب — غير محسومة",
  }),
];

const verified = (l: ReturnType<typeof line>, o: Record<string, unknown> = {}) => ({
  offer_id: l.offer_id,
  seller_tenant_id: l.seller_tenant_id,
  seller_name: l.seller_name,
  public_name: l.public_name,
  pack_label: l.pack_label,
  unit_name: l.unit_name,
  qty: l.qty,
  draft_price_minor: l.price_minor,
  current_price_minor: l.price_minor,
  changed: false,
  expired: false,
  status: "confirmed",
  confirmed_at: l.confirmed_at,
  valid_until: l.valid_until,
  min_order_qty: l.min_order_qty,
  short: Math.max(0, l.min_order_qty - l.qty),
  fees_decided: true,
  fees_label: l.fees_label,
  currency: "SDG",
  supplier_suspended: false,
  ...o,
});

const RESP = [
  { who: "المورد", items: ["صحة الوصف والسعر والوحدة، والتسليم في المهلة المعلنة"] },
  {
    who: "أنت",
    items: [
      "صحة العنوان وجهة الاستلام، ومن يحق له التوقيع بالاستلام",
      "فحص الكميات عند الاستلام — الفحص اللاحق يصعب إثباته",
    ],
  },
  { who: "فيزانو", items: ["نقل الطلب وحفظ نسخ الاتفاق والأدلة. لا ضمان جودة ولا طرف في الدفع"] },
];

const ORDER = (o: Record<string, unknown> = {}) => ({
  id: "po1",
  op_id: "op",
  number: 2041,
  number_label: "PO-2041",
  kind: "order",
  kind_label: "طلب",
  status: "sent",
  status_label: "بانتظار رد المورد",
  version: 1,
  supplier_tenant_id: "t2",
  supplier_name: "مخزن البركة — تجريبي",
  currency: "SDG",
  lines: [],
  lines_count: 2,
  total_minor: "1702000",
  delivery_to: "الفرع الرئيسي",
  fees_label: "توصيل داخل المنطقة مشمول",
  response_hours: 72,
  deadline_at: "2026-09-22T10:00:00Z",
  sent_at: "2026-09-19T10:00:00Z",
  ...o,
});

async function seedCart(page: Page, lines: unknown[]) {
  await page.addInitScript((ls) => {
    localStorage.setItem("market.cart", JSON.stringify({ at: new Date().toISOString(), data: ls }));
  }, lines);
}

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

test.describe("ORD-01", () => {
  test("validation_error → ready: قسم تحت حدّه الأدنى بالفارق، ثم مستوفى — ولا مجموع كلّي", async ({
    page,
  }, info) => {
    await seedCart(page, CART);
    await page.route(/\/api\/market\/orders\/verify$/, (route) => {
      const body = route.request().postDataJSON() as { lines: { offer_id: string; qty: number }[] };
      const byId = new Map(body.lines.map((l) => [l.offer_id, l.qty]));
      return route.fulfill(
        json(200, {
          lines: CART.map((l) => verified({ ...l, qty: byId.get(l.offer_id) ?? l.qty })),
          responsibilities: RESP,
          response_hours: 72,
        }),
      );
    });
    await login(page, "/market/cart", /\/market\/cart$/);
    await expect(page.getByText("وحدة أو حدٌّ أدنى غير مستوفى")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-01",
      state: "validation_error",
      texts: fromFrame("ORD-01", "validation_error", [
        "وحدة أو حدٌّ أدنى غير مستوفى",
        "لا مقارنة بالوحدة المختلفة",
        "كرتونة 12 عند مورد و24 عند آخر لا تُقارَن بالسعر (ACC-122). نعرض السعر للوحدة الأساسية ونسمّي الفرق.",
        "الحدّ الأدنى يُعرض بالفارق",
        "«ناقص 340 للوصول إلى الحدّ» لا «الطلب مرفوض» — المشتري يحتاج المسافة لا الرفض.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-01"]');
    await expect(root).toContainText("ناقص 7 للوصول إلى الحدّ");
    await expect(root).not.toContainText("إجمالي السلة:");
    await expect(root).toContainText("لا مجموع كلّي");
    await expect(root).toContainText("طلبان لا طلب");
    await expect(page.getByRole("button", { name: /راجع وأرسل — متجر الأمان/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByLabel("الكمية — أرز").fill("10");
    await page.getByLabel("الكمية — أرز").blur();
    await expectFrame(page, info, {
      screenId: "ORD-01",
      state: "ready",
      texts: fromFrame("ORD-01", "ready", [
        "سلة بموردين",
        "السلة مقسومة بالمورد: لكل قسم حدّه الأدنى ورسومه وشروط تنفيذه، ولكل قسم زرّ إرسال مستقل.",
        "طلبان لا طلب",
        "الإرسال يُنشئ طلباً لكل مورد (ACC-126). طلبٌ واحد لموردين يعني مسؤوليةً مشتركة لا تقبلها منشأتان مستقلتان.",
        "لا مجموع كلّي",
        "لا نعرض «إجمالي السلة» عبر الموردين: رقمٌ لا يُدفع لأحد، ورسومُ كل مورد تُحسب على قسمه.",
      ]),
    });
    await expect(root).toContainText("مخزن البركة — تجريبي");
    await expect(root).toContainText("حد أدنى 5 كراتين · توصيل داخل المنطقة مشمول");
    await expect(root).toContainText("متجر الأمان — تجريبي");
    const saved = await page.evaluate(() => localStorage.getItem("market.cart") ?? "");
    expect(saved.includes('"qty":10')).toBe(true);
  });

  test("stale: السعر تغيّر بعد المسودة — السعران والفرق وقبول سطراً سطراً، ولا تأكيد محلي", async ({
    page,
  }, info) => {
    await seedCart(page, [CART[0]]);
    await page.route(/\/api\/market\/orders\/verify$/, (route) =>
      route.fulfill(
        json(200, {
          lines: [verified(CART[0]!, { current_price_minor: "124000", changed: true })],
          responsibilities: RESP,
          response_hours: 72,
        }),
      ),
    );
    await login(page, "/market/cart", /\/market\/cart$/);
    await expectFrame(page, info, {
      screenId: "ORD-01",
      state: "stale",
      texts: fromFrame("ORD-01", "stale", [
        "السعر تغيّر بعد المسودة",
        "لا تأكيد محلي",
        "المسودة لا تُثبّت سعراً (ACC-123). السعر يُثبت بقبول المورد لا بحفظ المشتري.",
        "الموافقة صريحة",
        "يُعرض السعران القديم والجديد والفرق، ويُطلب قبولٌ سطراً سطراً. الترقية الصامتة للسعر سرقةٌ بالسهو.",
      ]),
    });
    const root = page.locator('[data-screen="ORD-01"]');
    await expect(root).toContainText("1,180.00");
    await expect(root).toContainText("الجديد 1,240.00 · الفرق 60.00");
    await expect(page.getByRole("button", { name: /راجع وأرسل/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByRole("button", { name: "اقبل السعر الجديد" }).click();
    await expect(root).toContainText("1,240.00");
    const saved = await page.evaluate(() => localStorage.getItem("market.cart") ?? "");
    expect(saved.includes('"price_minor":"124000"')).toBe(true);
  });

  test("offline → empty: بلا اتصال تُحفظ المسودة ولا رقم طلب، ثم سلة فارغة بمسارها", async ({
    page,
    context,
  }, info) => {
    await seedCart(page, CART);
    await page.route(/\/api\/market\/orders\/verify$/, (route) =>
      route.fulfill(
        json(200, {
          lines: CART.map((l) => verified(l)),
          responsibilities: RESP,
          response_hours: 72,
        }),
      ),
    );
    await login(page, "/market/cart", /\/market\/cart$/);
    await expect(page.locator('[data-screen="ORD-01"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ORD-01",
      state: "offline",
      texts: fromFrame("ORD-01", "offline", [
        "سلة ومسودة طلب بلا اتصال — لا تأكيد محلي",
        "ACC-123: المسودة تُحفظ محلياً، والإرسال يحتاج شبكة، وتغيّر السعر يحتاج موافقتك بعد الاتصال.",
        "بلا اتصال",
        "ما يعمل الآن بلا اتصال:",
        "تعديل الكميات، حفظ المسودة، مقارنة ما هو محمَّل.",
        "ما لا يعمل:",
        "إرسال الطلب، التحقق من السعر الحالي، الاطلاع على توفر جديد. لن نعطيك رقم طلب محلياً لأن الرقم يعني أن المورد استلم، وهو لم يستلم.",
        "حفظ المسودة على الجهاز",
        "إرسال — يحتاج اتصالاً",
        "مخزن البركة — تجريبي",
        "سكر أبيض",
        "كرتونة 12×1كغ",
        "زيت قلي",
        "كرتونة 12×1لتر",
        "متجر الأمان — تجريبي",
        "أرز",
        "كيس 25كغ",
        "سعر محمَّل",
      ]),
    });
    const root = page.locator('[data-screen="ORD-01"]');
    await expect(root).toContainText("السلة — موردان · آخر تحديث");
    await page.getByRole("button", { name: "حفظ المسودة على الجهاز" }).click();
    await expect(root).toContainText("حُفظت المسودة");
    await expect(page.getByRole("button", { name: "إرسال — يحتاج اتصالاً" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    for (const name of ["سكر أبيض", "زيت قلي", "أرز"]) {
      await page
        .getByRole("row", { name: new RegExp(name) })
        .getByRole("button", { name: "أزل" })
        .click();
    }
    await expectFrame(page, info, {
      screenId: "ORD-01",
      state: "empty",
      texts: fromFrame("ORD-01", "empty", [
        "سلة فارغة",
        "حالةٌ سويّة — الشراء من السوق ليس عملاً يومياً.",
        "المسار",
        "«ابحث في السوق» (MP-04) أو «موردون تتابعهم» (MP-06). ولا اقتراح إعادة توريد: ذاك GROW-01 وهو مؤجَّل إلى M4.",
      ]),
    });
  });
});

test.describe("ORD-02", () => {
  test("ready → saving → success: المسؤوليات قبل الإرسال، فعلٌ واحد بمعرّف واحد، و«أُرسل» ليست «قُبل»", async ({
    page,
  }, info) => {
    await seedCart(page, CART);
    await page.route(/\/api\/market\/orders\/verify$/, (route) =>
      route.fulfill(
        json(200, {
          lines: CART.map((l) => verified(l)),
          responsibilities: RESP,
          response_hours: 72,
        }),
      ),
    );
    const posted: Record<string, unknown>[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/\/api\/market\/orders$/, async (route) => {
      if (route.request().method() !== "POST") return route.fulfill(json(200, { orders: [] }));
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posted.push(body);
      await held;
      return route.fulfill(json(201, { order: ORDER({ op_id: body.op_id }), created: true }));
    });
    await login(page, "/market/checkout?supplier=t2", /\/market\/checkout\?supplier=t2$/);
    await expect(page.getByText("المسؤوليات في هذا الطلب")).toBeVisible();
    await expectFrame(page, info, {
      screenId: "ORD-02",
      state: "ready",
      texts: fromFrame("ORD-02", "ready", [
        "مراجعة الطلب قبل الإرسال — من يتحمل ماذا",
        "الشاشة الوحيدة التي تُقرأ قبل التزام مالي، فكل رقم فيها بمصدره وكل مسؤولية باسم صاحبها.",
        "مراجعة طلب إلى مخزن البركة — تجريبي",
        "المسؤوليات في هذا الطلب",
        "سكر أبيض — 6 كراتين",
        "1,180.00 للكرتونة",
        "زيت قلي — 4 كراتين",
        "2,485.00 للكرتونة",
        "رسوم التوصيل",
        "من شروط الخدمة المعلنة",
        "المورد",
        "صحة الوصف والسعر والوحدة، والتسليم في المهلة المعلنة",
        "أنت",
        "صحة العنوان وجهة الاستلام، ومن يحق له التوقيع بالاستلام",
        "فحص الكميات عند الاستلام — الفحص اللاحق يصعب إثباته",
        "نقل الطلب وحفظ نسخ الاتفاق والأدلة. لا ضمان جودة ولا طرف في الدفع",
        "طلب أو طلب سعر",
        "المسؤوليات معروضة",
      ]),
    });
    const root = page.locator('[data-screen="ORD-02"]');
    await expect(root).toContainText("بندان · التسليم إلى الفرع الرئيسي");
    await expect(root).toContainText("سعر مؤكد خادمياً حتى 25/09");
    await expect(root).not.toContainText("أرز");
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-02",
      state: "saving",
      texts: fromFrame("ORD-02", "saving", [
        "جارٍ الإرسال",
        "الإرسال فعلٌ واحد بمعرّف واحد. الزرّ يُقفل ولا يُنشئ ضغطٌ ثانٍ طلباً ثانياً.",
      ]),
    });
    await page
      .getByRole("button", { name: "أرسل الطلب" })
      .click({ force: true })
      .catch(() => undefined);
    release();
    await expectFrame(page, info, {
      screenId: "ORD-02",
      state: "success",
      texts: fromFrame("ORD-02", "success", [
        "أُرسل الطلب",
        "أُرسل ليست قُبل",
        "لا التزام مالي ولا حجز مخزون الآن. نقول «بانتظار رد المورد» لا «تم الطلب» — الثانية تُفهم تأكيداً.",
      ]),
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.kind).toBe("order");
    expect((posted[0]?.lines as unknown[]).length).toBe(2);
    await expect(root).toContainText(
      "PO-2041 إلى مخزن البركة — تجريبي · بانتظار رد المورد · مهلة الرد 72 ساعة",
    );
    await expect(root).not.toContainText("تم الطلب.");
    const saved = await page.evaluate(() => localStorage.getItem("market.cart") ?? "");
    expect(saved.includes('"offer_id":"o1"')).toBe(false);
    expect(saved.includes('"offer_id":"o3"')).toBe(true);
  });

  test("expired: بند انتهى تأكيده أثناء المراجعة — إرسال البندين المؤكدين وحدهما أو تأكيد جديد", async ({
    page,
  }, info) => {
    const rice = line({
      offer_id: "o3",
      public_name: "أرز",
      pack_label: "كيس 25كغ",
      unit_name: "كيس",
      price_minor: "154000",
      qty: 3,
      min_order_qty: 1,
      valid_until: "2026-09-09",
    });
    const cart = [CART[0]!, CART[1]!, rice];
    await seedCart(page, cart);
    await page.route(/\/api\/market\/orders\/verify$/, (route) =>
      route.fulfill(
        json(200, {
          lines: [
            verified(CART[0]!),
            verified(CART[1]!),
            verified(rice, { expired: true, status: "expired" }),
          ],
          responsibilities: RESP,
          response_hours: 72,
        }),
      ),
    );
    const posted: Record<string, unknown>[] = [];
    await page.route(/\/api\/market\/orders$/, (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posted.push(body);
      return route.fulfill(json(201, { order: ORDER({ op_id: body.op_id }), created: true }));
    });
    await login(page, "/market/checkout?supplier=t2", /\/market\/checkout\?supplier=t2$/);
    await expectFrame(page, info, {
      screenId: "ORD-02",
      state: "expired",
      texts: fromFrame("ORD-02", "expired", [
        "منتهي الصلاحية",
        "مراجعة طلب إلى مخزن البركة — تجريبي",
        "3 بنود · التسليم إلى الفرع الرئيسي",
        "بند واحد انتهى تأكيده أثناء مراجعتك.",
        "إرسال البندين المؤكدين",
        "طلب تأكيد جديد للأرز",
        "أرز — 3 أكياس",
        "آخر سعر معروف 1,540.00",
        "غير قابل للإرسال",
      ]),
    });
    const root = page.locator('[data-screen="ORD-02"]');
    await expect(root).toContainText("انتهى تأكيده 09/09 — غير قابل للإرسال");
    await expect(root).toContainText("أرز سعره لم يعد مؤكداً. الإرسال متاح للبنود المؤكدة وحدها");
    await page.getByRole("button", { name: "إرسال البندين المؤكدين" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    expect((posted[0]?.lines as { offer_id: string }[]).map((l) => l.offer_id)).toEqual([
      "o1",
      "o2",
    ]);
  });

  test("validation_error: عملة العرض تخالف عملة حسابك — لا تحويل ضمني ولا إرسال (ACC-140)", async ({
    page,
  }, info) => {
    await seedCart(page, [CART[0]!]);
    await page.route(/\/api\/market\/orders\/verify$/, (route) =>
      route.fulfill(
        json(200, {
          lines: [verified(CART[0]!, { currency: "EGP" })],
          responsibilities: RESP,
          response_hours: 72,
        }),
      ),
    );
    await login(page, "/market/checkout?supplier=t2", /\/market\/checkout\?supplier=t2$/);
    await expectFrame(page, info, {
      screenId: "ORD-02",
      state: "validation_error",
      texts: fromFrame("ORD-02", "validation_error", [
        "عملة العرض تخالف عملة حسابك",
        "العرض بعملة أخرى وحساب المنشأة بعملة واحدة غير قابلة للتبديل.",
        "لا تحويل ضمني",
        "نمنع التأكيد ولا نحوّل بسعر صرف مفترض (ACC-140). سعر الصرف التزامٌ مالي لا تقديرٌ في واجهة.",
      ]),
    });
    await expect(page.getByRole("button", { name: "أرسل الطلب" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("server_error: الشبكة قُطعت أثناء الإرسال — إعادة المحاولة بالمعرّف نفسه، والاستعلام يجد الطلب", async ({
    page,
  }, info) => {
    await seedCart(page, [CART[0]!, CART[1]!]);
    await page.route(/\/api\/market\/orders\/verify$/, (route) =>
      route.fulfill(
        json(200, {
          lines: [verified(CART[0]!), verified(CART[1]!)],
          responsibilities: RESP,
          response_hours: 72,
        }),
      ),
    );
    const ops: string[] = [];
    let mode: "abort" | "ok" = "abort";
    await page.route(/\/api\/market\/orders(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "GET") {
        const op = url.searchParams.get("op_id") ?? "";
        return route.fulfill(json(200, { orders: ops.includes(op) ? [ORDER({ op_id: op })] : [] }));
      }
      const body = route.request().postDataJSON() as { op_id: string };
      ops.push(body.op_id);
      if (mode === "abort") return route.abort("internetdisconnected");
      return route.fulfill(json(200, { order: ORDER({ op_id: body.op_id }), created: false }));
    });
    await login(page, "/market/checkout?supplier=t2", /\/market\/checkout\?supplier=t2$/);
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await expectFrame(page, info, {
      screenId: "ORD-02",
      state: "server_error",
      texts: fromFrame("ORD-02", "server_error", [
        "فشل الإرسال",
        "الشبكة قُطعت أثناء الإرسال، ولا نعرف هل وصل الطلب.",
        "المعرّف محفوظ",
        "إعادة المحاولة تُرسل الطلب نفسه بمعرّفه لا طلباً جديداً (ACC-124). ومسار «استعلم عن الحالة» معروض (ORD-14).",
      ]),
    });
    await page.getByRole("button", { name: "أعد المحاولة بالمعرّف نفسه" }).click();
    await expect(page.locator('[data-screen="ORD-02"]')).toHaveAttribute(
      "data-state",
      "server_error",
    );
    expect(ops).toHaveLength(2);
    expect(ops[0]).toBe(ops[1]);
    mode = "ok";
    await page.getByRole("button", { name: "استعلم عن الحالة" }).click();
    await expect(page.locator('[data-screen="ORD-02"]')).toHaveAttribute("data-state", "success");
  });
});
