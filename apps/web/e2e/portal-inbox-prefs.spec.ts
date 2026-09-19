import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.2 — CUS-03 رسائل المحل وتفاصيلها (5) + CUS-04 التفضيلات وإلغاء الاشتراك (3) + CUS-05 إذن مرفوض
 * أو اشتراك منتهٍ (3): كل رسالة باسم مرسلها، المنتهي موسوم لا يُمحى، رسالة لمشترك آخر بلا محتوى؛
 * الإلغاء لمحل واحد دون غيره مع تراجع 7 أيام، وإيقاف كل القنوات يسأل عن القصد.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const daysAgo = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  x.setHours(10, 0, 0, 0);
  return x.toISOString();
};
const friday = () => {
  const x = new Date();
  const diff = (5 - x.getDay() + 7) % 7 || 7;
  x.setDate(x.getDate() + (diff > 6 ? 0 : diff));
  return x.toISOString().slice(0, 10);
};

const me = (o: Record<string, unknown> = {}) => ({
  token: "t1",
  phone: "0912000555",
  active: true,
  consent_at: daysAgo(10),
  opt_out_at: "",
  push_permission: "granted",
  push_enabled: true,
  unread: 2,
  undo_until: "",
  shop_name: "مخزن البركة",
  slug: "abc12345",
  channels: { push: true, sms: false, inbox: true },
  undo_expired: false,
  ...o,
});

const MSGS = [
  {
    id: "m1",
    title: "خصم نهاية الأسبوع",
    message: "خصم 10% على السكر والأرز حتى الجمعة — مخزن البركة",
    shop_name: "مخزن البركة",
    sent_at: daysAgo(1),
    valid_until: friday(),
    expired: false,
    read_at: "",
  },
  {
    id: "m2",
    title: "وصلت بضاعة جديدة",
    message: "وصل زيت دوّار الشمس — مخزن البركة",
    shop_name: "مخزن البركة",
    sent_at: daysAgo(4),
    valid_until: "",
    expired: false,
    read_at: "",
  },
  {
    id: "m3",
    title: "عرض انتهى",
    message: "خصم الشاي انتهى أمس — مخزن البركة",
    shop_name: "مخزن البركة",
    sent_at: daysAgo(9),
    valid_until: "2026-09-10",
    expired: true,
    read_at: daysAgo(8),
  },
];

async function seedTokens(page: Page, shops: Record<string, string>) {
  await page.addInitScript((shops) => {
    for (const [slug, t] of Object.entries(shops)) localStorage.setItem(`portal.${slug}.token`, t);
    localStorage.setItem("portal.shops", JSON.stringify(Object.keys(shops)));
  }, shops);
}

test.describe("CUS-03", () => {
  test("loading → ready → expired: ثلاث رسائل واحدة انتهت، فتح رسالة يعلّمها مقروءة، والمنتهية تبقى موسومة", async ({
    page,
  }, info) => {
    await seedTokens(page, { abc12345: "t1" });
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/portal\/abc12345\/messages\?/, async (route) => {
      if (!released) await held;
      return route.fulfill(json(200, { subscriber: me(), messages: MSGS }));
    });
    const read: string[] = [];
    await page.route(/\/api\/portal\/abc12345\/messages\/[^/]+\/read/, (route) => {
      read.push(route.request().url());
      return route.fulfill(json(200, { ok: true }));
    });
    await page.goto("/portal/abc12345/inbox");
    await expectFrame(page, info, {
      screenId: "CUS-03",
      state: "loading",
      texts: fromFrame("CUS-03", "loading", [
        "جلب الرسائل",
        "خفيفة كسابقتها. الزبون على بيانات الجوال غالباً.",
      ]),
    });
    released = true;
    release();
    await expectFrame(page, info, {
      screenId: "CUS-03",
      state: "ready",
      texts: fromFrame("CUS-03", "ready", [
        "رسائل المحل",
        "ثلاث رسائل · واحدة انتهت",
        "خصم نهاية الأسبوع",
        "من مخزن البركة · أمس · سارٍ حتى الجمعة",
        "وصلت بضاعة جديدة",
        "من مخزن البركة · قبل 4 أيام",
        "عرض انتهى",
        "انتهى",
        "كل رسالة تحمل اسم مرسلها. لا رسالة من محل لم يتابعه، ولا رسالة من المنصة تتنكّر باسم المحل.",
      ]),
    });
    await page.getByRole("button", { name: "خصم نهاية الأسبوع" }).click();
    await expect(page.getByText("خصم 10% على السكر والأرز حتى الجمعة — مخزن البركة")).toBeVisible();
    expect(read.some((u) => u.includes("/messages/m1/read"))).toBe(true);
    await page.getByRole("button", { name: "عرض انتهى" }).click();
    await expectFrame(page, info, {
      screenId: "CUS-03",
      state: "expired",
      texts: fromFrame("CUS-03", "expired", [
        "عرض انتهى",
        "رسالة عن خصم انتهى",
        "تبقى مقروءةً موسومة «انتهى».",
        "لا نمحو",
        "الزبون قد يأتي بالورقة أو بالرسالة. وجودها موسومةً يجعل الحوار في المحل ممكناً.",
      ]),
    });
  });

  test("empty → permission_denied: لا رسائل بعد انتظارٌ لا عطب؛ ورابط رسالة لمشترك آخر بلا محتوى ولا اسم", async ({
    page,
  }, info) => {
    await seedTokens(page, { abc12345: "t1" });
    await page.route(/\/api\/portal\/abc12345\/messages\?/, (route) =>
      route.fulfill(json(200, { subscriber: me({ unread: 0 }), messages: [] })),
    );
    await page.goto("/portal/abc12345/inbox");
    await expectFrame(page, info, {
      screenId: "CUS-03",
      state: "empty",
      texts: fromFrame("CUS-03", "empty", [
        "لا رسائل بعد",
        "اشترك للتوّ ولم يُرسل المحل شيئاً.",
        "لا نعتذر",
        "«لم يرسل المحل رسائل بعد — ستصلك هنا» وكفى. الفراغ هنا انتظارٌ لا عطب.",
      ]),
    });
    await page.route(/\/api\/portal\/abc12345\/messages\/other\/read/, (route) =>
      route.fulfill(json(403, { detail: "permission_denied" })),
    );
    await page.goto("/portal/abc12345/inbox?m=other");
    await expectFrame(page, info, {
      screenId: "CUS-03",
      state: "permission_denied",
      texts: fromFrame("CUS-03", "permission_denied", [
        "رسالة لمشترك آخر",
        "رابط رسالة فُتح بجهاز ليس صاحب الاشتراك.",
        "لا نُظهر المحتوى",
        "ولا اسم المشترك. الرسالة قد تحمل عرضاً خاصاً به.",
      ]),
    });
    await expect(page.getByText("خصم 10%")).toHaveCount(0);
  });
});

test.describe("CUS-04", () => {
  test("ready → validation_error → success: محلان بقناتيهما، إيقاف كل القنوات يسأل عن القصد، والإلغاء لمحل واحد مع تراجع", async ({
    page,
  }, info) => {
    await seedTokens(page, { abc12345: "t1", bakery01: "t2" });
    const shops: Record<string, ReturnType<typeof me>> = {
      abc12345: me({ shop_name: "بقالة النيل — تجريبي", slug: "abc12345" }),
      bakery01: me({
        token: "t2",
        shop_name: "مخبز الصباح — تجريبي",
        slug: "bakery01",
        push_permission: "denied",
        push_enabled: false,
      }),
    };
    await page.route(/\/api\/portal\/([a-z0-9]+)\/me\?/, (route) => {
      const slug = /\/portal\/([a-z0-9]+)\/me/.exec(route.request().url())![1]!;
      const m = route.request().method();
      if (m === "PUT") {
        const body = route.request().postDataJSON() as {
          channels: (typeof shops)[string]["channels"];
        };
        shops[slug] = { ...shops[slug]!, channels: body.channels };
      }
      if (m === "DELETE") {
        shops[slug] = {
          ...shops[slug]!,
          active: false,
          opt_out_at: new Date().toISOString(),
          undo_until: daysAgo(-7),
        };
      }
      return route.fulfill(json(200, { subscriber: shops[slug] }));
    });
    await page.route(/\/api\/portal\/([a-z0-9]+)\/resubscribe/, (route) => {
      const slug = /\/portal\/([a-z0-9]+)\/resubscribe/.exec(route.request().url())![1]!;
      shops[slug] = { ...shops[slug]!, active: true, opt_out_at: "" };
      return route.fulfill(json(200, { subscriber: shops[slug] }));
    });
    await page.goto("/portal/prefs");
    await expectFrame(page, info, {
      screenId: "CUS-04",
      state: "ready",
      texts: fromFrame("CUS-04", "ready", [
        "التفضيلات وإلغاء الاشتراك",
        "أنت مشترك في محلين. الإلغاء يخص ما تختاره وحده — لا زر واحد يُسكت كل شيء دون أن تعرف ماذا أسكت.",
        "بقالة النيل — تجريبي",
        "مشترك · إشعار المتصفح مفعّل",
        "مخبز الصباح — تجريبي",
        "مشترك · صندوق وارد فقط",
        "إلغاء الكل",
        "يعرض قائمة المحال المتأثرة ويطلب تأكيداً ثانياً. لا إلغاء عرضي بنقرة.",
        "إلغاء اشتراك هذا المحل",
        "الإلغاء لا يمحو رسائلك السابقة من صندوق الوارد.",
      ]),
    });
    // إيقاف كل القنوات لمخبز الصباح: إشعار المتصفح ثم صندوق الوارد
    const bakery = page.locator(".acc-choice", { hasText: "مخبز الصباح" });
    await bakery.getByRole("switch", { name: "إشعار المتصفح" }).click();
    await bakery.getByRole("switch", { name: "صندوق الوارد في الصفحة" }).click();
    await expectFrame(page, info, {
      screenId: "CUS-04",
      state: "validation_error",
      texts: fromFrame("CUS-04", "validation_error", [
        "ألغى كل القنوات وبقي مشتركاً",
        "أوقف كل قناة والاشتراك قائم — حالةٌ بلا معنى: مشتركٌ لا يصله شيء.",
        "نسأل عن القصد",
        "«أوقفتَ كل القنوات — هل تريد إلغاء الاشتراك؟» والإلغاء بضغطة. لا نُبقيه في سجلّ لا ينفعه ولا ينفع المحل.",
      ]),
    });
    await page.getByRole("button", { name: "إلغاء الاشتراك", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "CUS-04",
      state: "success",
      texts: fromFrame("CUS-04", "success", [
        "تم إلغاء المتابعة",
        "تراجع عن الإلغاء",
        "الإلغاء لا يطال ما لم تقصده",
        "التراجع متاح 7 أيام",
        "بعدها تحتاج الرابط أو QR من جديد",
        "لا يُحذف سجل رسائلك",
        "يبقى معك للقراءة ولا تصلك رسائل جديدة",
        "الإلغاء يميّز بين محل واحد وكل المحلات وبين قناة وأخرى — لا زر واحد يلغي كل شيء بالخطأ.",
      ]),
    });
    await expect(page.getByText("من مخبز الصباح — تجريبي وحده")).toBeVisible();
    await expect(page.getByText("محلٌّ آخر ما زال مُتابَعاً")).toBeVisible();
    await page.getByRole("button", { name: "تراجع عن الإلغاء" }).first().click();
    await expect(page.locator('[data-screen="CUS-04"]')).toHaveAttribute("data-state", "ready");
    await expect(page.getByText("أنت مشترك في محلين")).toBeVisible();
  });
});

test.describe("CUS-05", () => {
  test("ready → permission_denied → expired: الحالة ومخرجها، الإذن المرفوض صندوق وارد، والمنتهي يعود لصفحة المحل", async ({
    page,
  }, info) => {
    await seedTokens(page, { abc12345: "t1" });
    let variant: "ok" | "denied" | "expired" = "ok";
    await page.route(/\/api\/portal\/abc12345\/me\?/, (route) =>
      route.fulfill(
        json(200, {
          subscriber:
            variant === "ok"
              ? me()
              : variant === "denied"
                ? me({ push_permission: "denied", push_enabled: false, unread: 3 })
                : me({ active: false, opt_out_at: daysAgo(9), undo_expired: true }),
        }),
      ),
    );
    await page.goto("/portal/abc12345/status");
    await expectFrame(page, info, {
      screenId: "CUS-05",
      state: "ready",
      texts: fromFrame("CUS-05", "ready", [
        "شرح الحالة ومخرجها",
        "شاشةٌ تُشرح فيها الحالة وتُعرض بدائلها: إذن مرفوض فالرسائل تصل بالبريد، أو اشتراك انتهى فالتجديد بضغطة.",
        "البديل لا الاعتذار",
        "لكل منع طريقٌ ثانٍ. صفحةٌ تقول «لا تستطيع» ثم تصمت أسوأ من عدمها.",
      ]),
    });
    variant = "denied";
    await page.goto("/portal/abc12345/status");
    await expectFrame(page, info, {
      screenId: "CUS-05",
      state: "permission_denied",
      texts: fromFrame("CUS-05", "permission_denied", [
        "إذن التنبيه مرفوض",
        "متصفحك يرفض إشعارات هذا الموقع. الرفض قرارك ومحترم، والخدمة لا تتوقف — تتحول إلى صندوق وارد تفتحه أنت.",
        "صندوق الوارد يعمل الآن",
        "لن نطلب الإذن مرة أخرى",
        "ما لن نفعله",
      ]),
    });
    variant = "expired";
    await page.goto("/portal/abc12345/status");
    await expectFrame(page, info, {
      screenId: "CUS-05",
      state: "expired",
      texts: fromFrame("CUS-05", "expired", [
        "انتهت صلاحية الرابط",
        "اذهب لصفحة المحل",
        "نقول متى انتهى",
        "لا «حدث خطأ» غامضة",
        "ونعرض الوجهة البديلة",
        "صفحة المحل نفسها تعمل",
        "ولا نكشف ما لا يخصّك",
        "رابط محل آخر يعطي الرسالة نفسها",
        "الانتهاء حالة متوقَّعة لا عطل. الشاشة تعطي مخرجاً بدل أن تترك الزبون في طريق مسدود.",
      ]),
    });
  });
});
