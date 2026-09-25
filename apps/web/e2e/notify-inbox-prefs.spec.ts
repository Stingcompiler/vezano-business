import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.10 — NOT-01 صندوق الوارد والتفاصيل (5) + NOT-02 تفضيلات التنبيه (4): التشغيلي فوق التسويقي
 * دائماً؛ الرابط بصلاحية يُعاد فحصه خادمياً (ACC-113)؛ المنتهي يُوسم ولا يُمحى (ACC-110)؛ ما يخصّ
 * المالك عنوانه بلا تفصيله؛ التشغيلي داخل التطبيق دائم؛ قناة بلا وجهة لا تُحفظ؛ `offline` يحفظ
 * محلياً ويُرفع؛ الحفظ يُعدّ.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const today = (h: number, m: number) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
const daysAgo = (d: number, h = 12) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(h, 0, 0, 0);
  return x.toISOString();
};

const item = (o: Record<string, unknown>) => ({
  id: "n1",
  kind: "shift_abandoned",
  category: "operational",
  category_label: "تشغيلي",
  title: "وردية الكاشير 2 مفتوحة منذ 3 أيام",
  body: "صندوق بلا عدّ. الإقفال الإداري يحتاج حضورك.",
  href: "/shifts/review",
  screen: "SHIFT-05",
  needs_action: true,
  locked: false,
  expired: false,
  resolved: false,
  read: false,
  occurred_at: today(8, 0),
  expires_at: "",
  link_token: "tok-1",
  link_expires_at: today(23, 0),
  ...o,
});

const ITEMS = [
  item({}),
  item({
    id: "n2",
    kind: "pending_upload",
    title: "9 عمليات لم تُرفع من هاتف المخزن",
    body: "قيمتها التقديرية 4,180.00. فصل الجهاز الآن يفقدها.",
    href: "/sync",
    screen: "SYS-01",
    occurred_at: today(9, 41),
    link_token: "tok-2",
  }),
  item({
    id: "n3",
    kind: "subscription_renewal",
    category: "account",
    category_label: "حسابي",
    title: "اشتراكك يُجدَّد بعد 9 أيام",
    body: "لا انقطاع متوقع. الدفع يدوي ويحتاج اعتماد المشغّل.",
    href: "/org/subscription",
    screen: "",
    needs_action: false,
    read: true,
    occurred_at: daysAgo(1),
    link_token: "tok-3",
  }),
  item({
    id: "n4",
    kind: "plan_upgrade",
    category: "marketing",
    category_label: "تسويقي",
    title: "باقة الفروع المتعددة متاحة",
    body: "تشمل مقارنة الفروع وتقرير الهامش. يمكن إيقاف هذا النوع من الإشعارات.",
    href: "/org/subscription",
    screen: "",
    needs_action: false,
    read: true,
    occurred_at: daysAgo(2),
    link_token: "tok-4",
  }),
];

const inbox = (items: unknown[] = ITEMS, o: Record<string, unknown> = {}) => ({
  items,
  needs_action: (items as { needs_action: boolean; locked: boolean }[]).filter(
    (i) => i.needs_action && !i.locked,
  ).length,
  unread: (items as { read: boolean }[]).filter((i) => !i.read).length,
  category: "",
  as_of: today(10, 0),
  ...o,
});

const prefs = (o: Record<string, unknown> = {}) => ({
  prefs: {
    operational: { in_app: true, sms: true },
    account: { in_app: true, email: false },
    marketing: { in_app: false, email: false },
  },
  destination_email: "",
  sms_balance: { remaining: 100, quota: 100 },
  counts: { in_app: 2, sms: 1, email: 0 },
  updated_at: today(9, 0),
  is_owner: true,
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

test.describe("NOT-01", () => {
  test("loading → ready: التشغيلي فوق التسويقي؛ الفتح بالرابط يُعلَّم مقروءاً؛ الرابط المنتهي يعرض الوجهة بديلاً؛ إيقاف النوع", async ({
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
    const opens: string[] = [];
    let muted = false;
    await page.route("**/api/notifications/preferences", (route) => {
      muted = true;
      return route.fulfill(json(200, prefs()));
    });
    await page.route("**/api/notifications/*/open", (route) => {
      const body = route.request().postDataJSON() as { token: string };
      opens.push(body.token);
      if (body.token === "tok-2")
        return route.fulfill(
          json(200, {
            status: "link_expired",
            title: "9 عمليات لم تُرفع من هاتف المخزن",
            href: "/sync",
            screen: "SYS-01",
          }),
        );
      return route.fulfill(
        json(200, { status: "ok", title: "", href: "/shifts/review", screen: "SHIFT-05" }),
      );
    });
    await page.route(/\/api\/notifications(\?.*)?$/, async (route) => {
      if (!released) await held;
      const items = muted ? ITEMS.filter((i) => i.category !== "marketing") : ITEMS;
      return route.fulfill(
        json(
          200,
          inbox(
            opens.includes("tok-1")
              ? items.map((i) => (i.id === "n1" ? { ...i, read: true } : i))
              : items,
          ),
        ),
      );
    });
    await login(page, "/notify/inbox");
    await expectFrame(page, info, {
      screenId: "NOT-01",
      state: "loading",
      texts: fromFrame("NOT-01", "loading", [
        "صندوق الوارد — التشغيلي فوق التسويقي دائماً",
        "جلب الوارد",
        "هياكل بعدد آخر قائمة. غير المقروء يُعلَّم بعد الوصول لا قبله.",
      ]),
    });
    release();
    await expectFrame(page, info, {
      screenId: "NOT-01",
      state: "ready",
      texts: fromFrame("NOT-01", "ready", [
        "صندوق الوارد — التشغيلي فوق التسويقي دائماً",
        "إشعار «وردية مفتوحة منذ 3 أيام» لا يقف في طابور واحد مع عرض ترقية الباقة.",
        "الوارد",
        "الرابط داخل الإشعار يحمل صلاحية: بعد انتهائها نقول «انتهت صلاحية هذا الرابط» ونعرض الوجهة بديلاً — لا صفحة خطأ عامة.",
        "تشغيلي",
        "وردية الكاشير 2 مفتوحة منذ 3 أيام",
        "صندوق بلا عدّ. الإقفال الإداري يحتاج حضورك.",
        "اليوم 08:00",
        "9 عمليات لم تُرفع من هاتف المخزن",
        "قيمتها التقديرية 4,180.00. فصل الجهاز الآن يفقدها.",
        "اليوم 09:41",
        "حسابي",
        "اشتراكك يُجدَّد بعد 9 أيام",
        "لا انقطاع متوقع. الدفع يدوي ويحتاج اعتماد المشغّل.",
        "أمس 12:00",
        "تسويقي",
        "باقة الفروع المتعددة متاحة",
        "تشمل مقارنة الفروع وتقرير الهامش. يمكن إيقاف هذا النوع من الإشعارات.",
        "قبل يومين",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="NOT-01"]');
    await expect(root).toContainText("2 تحتاج إجراءً · 2 غير مقروء");
    // الترتيب: التشغيلي قبل الحسابي قبل التسويقي
    const text = await root.innerText();
    expect(text.indexOf("وردية الكاشير 2")).toBeLessThan(text.indexOf("اشتراكك يُجدَّد"));
    expect(text.indexOf("اشتراكك يُجدَّد")).toBeLessThan(text.indexOf("باقة الفروع المتعددة"));
    // الفتح: يُعاد فحص الرابط خادمياً ويُعلَّم مقروءاً بعد الوصول
    await page.getByRole("button", { name: /وردية الكاشير 2 مفتوحة/ }).click();
    await expect(root).toContainText("افتح SHIFT-05 ←");
    await expect.poll(() => opens).toContain("tok-1");
    await page.getByRole("button", { name: "رجوع" }).click();
    await expect(root).toContainText("2 تحتاج إجراءً · 1 غير مقروء");
    // رابط انتهت صلاحيته: نقولها ونعرض الوجهة بديلاً
    await page.getByRole("button", { name: /9 عمليات لم تُرفع/ }).click();
    await expect(root).toContainText("انتهت صلاحية هذا الرابط");
    await expect(page.getByRole("button", { name: "افتح SYS-01 ←" })).toBeVisible();
    await page.getByRole("button", { name: "رجوع" }).click();
    // إيقاف هذا النوع (التسويقي) يخفيه من الوارد
    await page.getByRole("button", { name: /باقة الفروع المتعددة/ }).click();
    await page.getByRole("button", { name: "إيقاف هذا النوع" }).click();
    await expect.poll(() => muted).toBe(true);
  });

  test("empty بمرشّح وبلا مرشّح؛ expired يُوسم ويُعطَّل زرّه؛ permission_denied عنوان بلا تفصيل عبر الرابط العميق", async ({
    page,
  }, info) => {
    const expiredItem = item({
      id: "n5",
      kind: "market_offer",
      category: "marketing",
      category_label: "تسويقي",
      title: "عرض سوق — خصم الجملة",
      body: "انتهى العرض في 12 سبتمبر.",
      href: "/market",
      screen: "MP-07",
      needs_action: false,
      expired: true,
      read: true,
      occurred_at: daysAgo(5),
      expires_at: daysAgo(3),
      link_token: "tok-5",
    });
    const lockedItem = item({
      id: "n6",
      kind: "proof_reviewed",
      category: "account",
      category_label: "حسابي",
      title: "اعتُمد إثبات تحويل الاشتراك",
      body: "",
      href: "",
      screen: "",
      needs_action: false,
      locked: true,
      read: false,
      occurred_at: daysAgo(1, 9),
      link_token: "",
    });
    let mode: "filtered" | "empty" | "items" = "items";
    await page.route(/\/api\/notifications(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      if (mode === "empty") return route.fulfill(json(200, inbox([])));
      if (url.searchParams.get("category") === "operational")
        return route.fulfill(json(200, inbox([], { category: "operational" })));
      return route.fulfill(json(200, inbox([expiredItem, lockedItem])));
    });
    await page.route("**/api/notifications/*/open", (route) =>
      route.request().url().includes("/n6/")
        ? route.fulfill(
            json(403, {
              status: "permission_denied",
              title: "اعتُمد إثبات تحويل الاشتراك",
              href: "",
            }),
          )
        : route.fulfill(
            json(200, {
              status: "expired",
              title: "عرض سوق — خصم الجملة",
              href: "/market",
              screen: "MP-07",
            }),
          ),
    );
    // الرابط العميق إلى إشعار يخصّ المالك — الموظف يرى العنوان ويُحجب المحتوى
    await login(page, "/notify/inbox/n6");
    await expectFrame(page, info, {
      screenId: "NOT-01",
      state: "permission_denied",
      texts: fromFrame("NOT-01", "permission_denied", [
        "إشعار لدورٍ آخر",
        "إشعار عن اعتماد اشتراك وصل لأن الجهاز مشترك، والموظف الحالي لا يملك فتحه.",
        "العنوان بلا التفصيل",
        "يظهر العنوان ويُحجب المحتوى ومعه «يخصّ المالك». الإخفاء الكامل يجعله يظنّ أن الإشعار ضاع.",
      ]),
    });
    const root = page.locator('[data-screen="NOT-01"]');
    await expect(root).toContainText("اعتُمد إثبات تحويل الاشتراك");
    await page.getByRole("button", { name: "رجوع" }).click();
    await expect(root).toContainText("يخصّ المالك");
    // إشعار انتهت صلاحيته: يبقى مقروءاً موسوماً وزرّه معطَّل
    await page.getByRole("button", { name: /عرض سوق — خصم الجملة/ }).click();
    await expectFrame(page, info, {
      screenId: "NOT-01",
      state: "expired",
      texts: fromFrame("NOT-01", "expired", [
        "إشعار انتهت صلاحيته",
        "إشعار عن عرض سوق انتهى أو دعوة مضت. يبقى مقروءاً ولا يُخفى.",
        "لا نمسح التاريخ",
        "الإشعار المنتهي يُوسم ويُعطَّل زرّه. محوُه يجعل المستخدم يظنّ أنه لم يصله شيء ويسأل عنه.",
      ]),
    });
    await expect(page.getByRole("button", { name: "افتح MP-07 ←" })).toBeDisabled();
    await page.getByRole("button", { name: "رجوع" }).click();
    // فراغ بعد ترشيح ≠ صندوق فارغ فعلاً
    await page.getByRole("button", { name: "تشغيلي", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "NOT-01",
      state: "empty",
      texts: fromFrame("NOT-01", "empty", [
        "نفرّق",
        "الفراغ بعد ترشيح يقول «لا نتائج لهذا المرشّح» مع زرّ مسحه. الخلط بينهما يجعل المستخدم يظنّ أنه لم يصله شيء.",
      ]),
    });
    await expect(root).toContainText("لا نتائج لهذا المرشّح");
    mode = "empty";
    await page.getByRole("button", { name: "امسح المرشّح" }).click();
    await expectFrame(page, info, {
      screenId: "NOT-01",
      state: "empty",
      texts: fromFrame("NOT-01", "empty", ["لا إشعارات", "صندوقٌ فارغ فعلاً لا مرشَّحٌ لا يطابق."]),
    });
  });
});

test.describe("NOT-02", () => {
  test("ready → validation_error → success: التشغيلي دائم، البريد بلا وجهة لا يُحفظ، والحفظ يُعدّ", async ({
    page,
  }, info) => {
    let puts = 0;
    await page.route("**/api/notifications/preferences", (route) => {
      if (route.request().method() === "PUT") {
        puts += 1;
        const body = route.request().postDataJSON() as {
          prefs: Record<string, Record<string, boolean>>;
          email: string;
        };
        if (body.prefs.account?.email && !body.email)
          return route.fulfill(
            json(400, { detail: "channel_without_destination", field: "email" }),
          );
        return route.fulfill(
          json(
            200,
            prefs({
              prefs: body.prefs,
              destination_email: body.email,
              counts: { in_app: 3, sms: 1, email: 1 },
            }),
          ),
        );
      }
      return route.fulfill(json(200, prefs()));
    });
    await login(page, "/notify/preferences");
    await expectFrame(page, info, {
      screenId: "NOT-02",
      state: "ready",
      texts: fromFrame("NOT-02", "ready", [
        "تفضيلات التنبيه",
        "قناتان ونوعان. التشغيلي غير قابل للإطفاء لأنه يخصّ مالك وذمم.",
        "الرسائل النصية تُكلِّف.",
        "نعرض رصيد الرسائل المتبقي عند تفعيل أي قناة مدفوعة، ولا نرسل عبرها إلا ما اخترتَه صراحة.",
        "تنبيهات التشغيل — داخل التطبيق",
        "ورديات وذمم ومزامنة وطلبات. تخصّ مالك، فلا تُطفأ.",
        "دائم",
        "تنبيهات التشغيل — رسالة نصية",
        "للحالات الحرجة فقط: وردية مهجورة، فشل مزامنة يتجاوز يوماً.",
        "إشعارات حسابية — الاشتراك والفواتير",
        "تذكير التجديد وحالة الدفع",
        "عروض ومنتجات المنصة",
        "إطفاؤها لا يؤثر على أي شيء تشغيلي",
        "موقوف",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="NOT-02"]');
    await expect(root).toContainText("المتبقي 100 من 100 هذا الشهر.");
    await expect(
      page.getByRole("switch", { name: "تنبيهات التشغيل — رسالة نصية" }),
    ).toHaveAttribute("aria-checked", "true");
    // بريد بلا وجهة: لا نحفظ — نطلب البريد في مكانه
    await page.getByRole("switch", { name: "إشعارات حسابية بالبريد" }).click();
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "NOT-02",
      state: "validation_error",
      texts: fromFrame("NOT-02", "validation_error", [
        "قناة بلا وجهة",
        "فُعّل تنبيه البريد ولا بريد في الحساب.",
        "لا نحفظ تفضيلاً معطّلاً",
        "حفظُه يجعله يظنّ أن التنبيهات ستصل وهي لن تصل. نطلب البريد هنا في مكانه.",
      ]),
    });
    expect(puts).toBe(0);
    await page.getByLabel("البريد للتنبيهات").fill("owner@x.sd");
    await page.getByRole("switch", { name: "عروض ومنتجات المنصة" }).click();
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "NOT-02",
      state: "success",
      texts: fromFrame("NOT-02", "success", [
        "حُفظت",
        "نقول ما صار فعّالاً بالعدّ:",
        "لا رسالة مجردة",
        "«حُفظت التغييرات» لا تُطمئن من جاء يضبط ما يصله. العدد يُطمئن.",
      ]),
    });
    await expect(root).toContainText("3 تنبيهات على التطبيق · 1 بالبريد · 1 برسالة نصية.");
    expect(puts).toBe(1);
  });

  test("offline: حُفظ محلياً ويسري فوراً ويُرفع عند عودة الشبكة — الحدّ المُعلن", async ({
    page,
    context,
  }, info) => {
    let puts = 0;
    await page.route("**/api/notifications/preferences", (route) => {
      if (route.request().method() === "PUT") {
        puts += 1;
        const body = route.request().postDataJSON() as {
          prefs: Record<string, Record<string, boolean>>;
          email: string;
        };
        return route.fulfill(
          json(200, prefs({ prefs: body.prefs, counts: { in_app: 3, sms: 0, email: 0 } })),
        );
      }
      return route.fulfill(json(200, prefs()));
    });
    await login(page, "/notify/preferences");
    const root = page.locator('[data-screen="NOT-02"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByRole("switch", { name: "تنبيهات التشغيل — رسالة نصية" }).click();
    await page.getByRole("switch", { name: "عروض ومنتجات المنصة" }).click();
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "NOT-02",
      state: "offline",
      texts: fromFrame("NOT-02", "offline", [
        "حُفظ محلياً",
        "التفضيلات تُحفظ على الجهاز وتُرفع لاحقاً؛ تسري محلياً فوراً.",
        "الحدّ المُعلن",
        "التنبيهات الخادمية تتبع التفضيل القديم حتى يُرفع. نقولها لا نتركها تُكتشف.",
      ]),
    });
    expect(puts).toBe(0);
    await expect(page.getByRole("switch", { name: "عروض ومنتجات المنصة" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // عودة الشبكة: يُرفع المحفوظ محلياً
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => puts).toBe(1);
    await expect(root).toHaveAttribute("data-state", "ready");
  });
});
