import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.1 — CUS-01 صفحة محل عبر رابط أو QR (4) + CUS-02 اشتراك وإذن تنبيه (4): لا حساب ولا كلمة
 * مرور؛ ما نشره التاجر بنفسه ولا شيء سواه؛ المنتهي يُوسم لا يختفي؛ الرابط المؤقت المنتهي يحوّل
 * إلى صفحة المحل؛ الاشتراك فعل صريح ورفض إذن المتصفح يحوّل الخدمة إلى صندوق وارد.
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

const PAGE = {
  shop: {
    name: "مخزن البركة",
    address: "شارع السوق — الخرطوم بحري",
    hours: "8:00 – 22:00",
    slug: "abc12345",
  },
  announcements: [
    {
      id: "c1",
      title: "خصم نهاية الأسبوع",
      message: "خصم 10% على السكر والأرز حتى الجمعة — مخزن البركة",
      sent_at: daysAgo(1),
      valid_until: friday(),
      expired: false,
    },
    {
      id: "c2",
      title: "وصلت بضاعة جديدة",
      message: "وصل زيت دوّار الشمس بعبوة 1.5 لتر — مخزن البركة",
      sent_at: daysAgo(4),
      valid_until: "",
      expired: false,
    },
    {
      id: "c3",
      title: "عرض انتهى",
      message: "عرض الشاي — مخزن البركة",
      sent_at: daysAgo(9),
      valid_until: "2026-09-10",
      expired: true,
    },
  ],
  link_state: "",
  push_public_key: "BFAKE",
};

interface Fake {
  permission?: "default" | "granted" | "denied" | "unsupported";
  request?: "granted" | "denied";
  subscription?: { endpoint: string; p256dh: string; auth: string } | null;
}

async function fakePush(page: Page, fake: Fake) {
  await page.addInitScript((fake) => {
    const w = window as unknown as {
      __stingPushFakePending?: Fake;
      __stingPushFake?: (f: Fake) => void;
    };
    w.__stingPushFakePending = fake;
    let installed = false;
    Object.defineProperty(w, "__stingPushFake", {
      configurable: true,
      get: () => undefined,
      set: (fn: (f: Fake) => void) => {
        Object.defineProperty(w, "__stingPushFake", {
          value: fn,
          configurable: true,
          writable: true,
        });
        if (!installed) {
          installed = true;
          fn(fake);
        }
      },
    });
  }, fake);
}

test.describe("CUS-01", () => {
  test("loading → ready: الاسم والساعات والموقع وثلاثة منشورات بتواريخها والمنتهي رماديّاً", async ({
    page,
  }, info) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route(/\/api\/portal\/abc12345(\?.*)?$/, async (route) => {
      if (!released) await held;
      return route.fulfill(json(200, PAGE));
    });
    await page.goto("/portal/abc12345");
    await expectFrame(page, info, {
      screenId: "CUS-01",
      state: "loading",
      texts: fromFrame("CUS-01", "loading", [
        "جارٍ الفتح",
        "صفحةٌ خفيفة تُفتح في ثانية على شبكة بطيئة. لا خطوط ثقيلة ولا صور كبيرة قبل المحتوى.",
      ]),
    });
    released = true;
    release();
    await expectFrame(page, info, {
      screenId: "CUS-01",
      state: "ready",
      texts: fromFrame("CUS-01", "ready", [
        "مخزن البركة",
        "صفحة المحل · فُتحت برابط أو QR",
        "تابع المحل",
        "ساعات العمل والموقع",
        "ما نشره التاجر بنفسه ولا شيء سواه",
        "آخر إعلانات المحل",
        "ثلاثة منشورات بتواريخها",
        "لا أسعار ولا مخزون",
        "إلا ما اختار التاجر نشره صراحة",
        "لا تسجيل دخول ولا ملف زبون. الصفحة محتوى منشور، والزبون زائر لا مستخدم في دفتر التاجر.",
        "خصم نهاية الأسبوع",
        "من مخزن البركة · أمس · سارٍ حتى الجمعة",
        "وصلت بضاعة جديدة",
        "من مخزن البركة · قبل 4 أيام",
        "عرض انتهى",
        "انتهى",
      ]),
    });
    await expect(page.locator(".cus-item--expired")).toHaveCount(1);
    await expect(page.getByText("8:00 – 22:00")).toBeVisible();
  });

  test("empty → expired: المحل لم ينشر شيئاً فنعرض ما يعرفه عن نفسه؛ ورابط حملة منتهية يحوّل إلى صفحة المحل", async ({
    page,
  }, info) => {
    await page.route(/\/api\/portal\/abc12345(\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      const c = url.searchParams.get("c");
      return route.fulfill(
        json(200, {
          ...PAGE,
          announcements: c ? PAGE.announcements : [],
          link_state: c ? "expired" : "",
        }),
      );
    });
    await page.goto("/portal/abc12345");
    await expectFrame(page, info, {
      screenId: "CUS-01",
      state: "empty",
      texts: fromFrame("CUS-01", "empty", [
        "المحل لم ينشر شيئاً",
        "الصفحة قائمة والمحل لم يضع رسائل ولا عروضاً.",
        "لا صفحة فارغة",
        "نعرض ما يعرفه المحل عن نفسه: الاسم والعنوان وساعات العمل. ثم «تابعنا لتصلك العروض» — وهي نقطة القيمة.",
        "مخزن البركة",
        "ساعات العمل والموقع",
      ]),
    });
    await expect(page.getByRole("button", { name: "تابعنا لتصلك العروض" })).toBeVisible();
    await page.goto("/portal/abc12345?c=c3");
    await expectFrame(page, info, {
      screenId: "CUS-01",
      state: "expired",
      texts: fromFrame("CUS-01", "expired", [
        "الرابط منتهٍ",
        "رابط مؤقت لعرضٍ انتهى أو حملةٍ مضت.",
        "لا نترك بابًا مغلقاً",
        "هذا العرض انتهى — هذه صفحة المحل",
        "الزبون جاء مهتمّاً، فلا نطرده.",
        "مخزن البركة",
      ]),
    });
  });

  test("رابط محل لا وجود له = رسالة PUB-04 نفسها", async ({ page }) => {
    await page.route(/\/api\/portal\/nope(\?.*)?$/, (route) =>
      route.fulfill(json(404, { detail: "not_found" })),
    );
    await page.goto("/portal/nope");
    await expect(page).toHaveURL(/\/link-expired$/);
    await expect(page.locator('[data-screen="PUB-04"][data-state="expired"]')).toBeVisible();
  });
});

test.describe("CUS-02", () => {
  test("ready → validation_error → success: الاشتراك صريح، الرقم الناقص يُرفض بنصّه، ثم اشتركتَ بما سيصل وكيف يُلغى", async ({
    page,
  }, info) => {
    await fakePush(page, { permission: "default", request: "granted" });
    await page.route(/\/api\/portal\/abc12345(\?.*)?$/, (route) => route.fulfill(json(200, PAGE)));
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/portal/abc12345/subscribe", (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      const phone = typeof posted.phone === "string" ? posted.phone : "";
      if (phone.replace(/\D/g, "").length < 9)
        return route.fulfill(json(400, { detail: "phone_invalid", field: "phone", extra: {} }));
      return route.fulfill(
        json(201, { subscriber: { token: "t1", active: true, push_enabled: true, unread: 0 } }),
      );
    });
    await page.goto("/portal/abc12345/subscribe");
    await expectFrame(page, info, {
      screenId: "CUS-02",
      state: "ready",
      texts: fromFrame("CUS-02", "ready", [
        "تنبيهات المحل",
        "وصلتك عبر رابط المحل أو رمز QR. الاشتراك هنا فعل صريح منك، ولا ينشئ حساباً ولا يربطك بنظام المحل الداخلي.",
        "ما ستصلك",
        "عروض المحل وتغيّر ساعات العمل. لا رسائل من محال أخرى ولا من فيزانو.",
        "ما لا نطلبه",
        "لا اسم ولا عنوان ولا كلمة مرور. رقمك يُستخدم للإرسال وحده.",
        "أشترك في تنبيهات هذا المحل",
        "الإلغاء بنقرة واحدة في أي وقت، ولمحل واحد دون غيره.",
      ]),
    });
    await page.getByLabel("رقم الهاتف").fill("091");
    await page.getByRole("button", { name: "أشترك في تنبيهات هذا المحل" }).click();
    await expectFrame(page, info, {
      screenId: "CUS-02",
      state: "validation_error",
      texts: fromFrame("CUS-02", "validation_error", [
        "رقم غير صالح",
        "رقم هاتف ناقص أو بصيغة غير مفهومة.",
        "نتساهل في الصيغة",
        "نقبل بمسافات وشرطات وبصيغة دولية أو محلية ونُطبّعها نحن. رفضُ رقمٍ صحيح لأن صيغته مختلفة عناءٌ لا لزوم له.",
      ]),
    });
    await page.getByLabel("رقم الهاتف").fill("+249 91-200-0555");
    await page.getByRole("button", { name: "أشترك في تنبيهات هذا المحل" }).click();
    await expectFrame(page, info, {
      screenId: "CUS-02",
      state: "success",
      texts: fromFrame("CUS-02", "success", [
        "اشتركتَ",
        "نقول بالضبط ما سيصل وكم مرة تقريباً وكيف يُلغى — في شاشة النجاح لا في شروط مطويّة.",
        "الإلغاء من أول لحظة",
        "رابط الإلغاء في أول رسالة تصل. من يعرف أنه يستطيع الخروج يبقى أطول.",
      ]),
    });
    expect(posted).toMatchObject({
      phone: "+249 91-200-0555",
      push_permission: "granted",
      push: { endpoint: "https://push.example/fake-endpoint" },
    });
  });

  test("permission_denied: المتصفح رفض — الاشتراك يتم والخدمة صندوق وارد، ولا نطلب الإذن ثانيةً", async ({
    page,
  }, info) => {
    await fakePush(page, { permission: "denied" });
    await page.route(/\/api\/portal\/abc12345(\?.*)?$/, (route) => route.fulfill(json(200, PAGE)));
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/portal/abc12345/subscribe", (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill(
        json(201, { subscriber: { token: "t2", active: true, push_enabled: false, unread: 3 } }),
      );
    });
    await page.goto("/portal/abc12345/subscribe");
    await page.getByLabel("رقم الهاتف").fill("0912000555");
    await page.getByRole("button", { name: "أشترك في تنبيهات هذا المحل" }).click();
    await expectFrame(page, info, {
      screenId: "CUS-02",
      state: "permission_denied",
      texts: fromFrame("CUS-02", "permission_denied", [
        "إذن التنبيه مرفوض",
        "متصفحك يرفض إشعارات هذا الموقع. الرفض قرارك ومحترم، والخدمة لا تتوقف — تتحول إلى صندوق وارد تفتحه أنت.",
        "صندوق الوارد يعمل الآن",
        "رسائل غير مقروءة من المحل محفوظة هنا. لا تحتاج إذناً لقراءتها.",
        "لن نطلب الإذن مرة أخرى",
        "إعادة الطلب بعد الرفض يحجبها المتصفح نفسه. لو غيّرت رأيك، تُفعّلها من إعدادات الموقع.",
        "ما لن نفعله",
        "لا رسائل نصية بدلاً من الإشعار دون موافقة منفصلة على القناة.",
        "فتح صندوق الوارد —",
        "كيف تُفعّل الإشعارات من إعدادات المتصفح — تعليمات حسب جهازك.",
      ]),
    });
    expect(posted).toMatchObject({ push_permission: "denied" });
    await expect(page.getByRole("button", { name: /فتح صندوق الوارد — 3 جديدة/ })).toBeVisible();
  });
});
