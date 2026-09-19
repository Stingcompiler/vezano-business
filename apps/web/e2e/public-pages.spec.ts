import { expect, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.16 — الصفحات العامة بلا جلسة: PUB-01 التعريف والباقات (ready/offline)، PUB-02 الشروط
 * (ready/loading/phase_locked)، PUB-03 حالة الخدمة (ready/stale/server_error)، PUB-04 غير موجودة /
 * رابط منتهٍ / تخصّ منشأة أخرى (empty/expired/permission_denied). لا بيانات مستأجر في أيٍّ منها.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const PLANS = {
  plans: [
    {
      code: "single",
      name: "فرع واحد",
      price_minor: "4500000",
      max_branches: 1,
      max_devices: 3,
      blurb: "3 أجهزة · مستخدمان بدور كامل · تقارير كاملة · بلا نشر في السوق",
      trial: false,
    },
    {
      code: "dual",
      name: "فرعان",
      price_minor: "8500000",
      max_branches: 2,
      max_devices: 6,
      blurb: "6 أجهزة · 5 مستخدمين · مقارنة الفروع · نشر في السوق واستقبال الطلبات",
      trial: false,
    },
    {
      code: "trial",
      name: "تجريبية",
      price_minor: "0",
      max_branches: 1,
      max_devices: 3,
      blurb: "كل ميزات باقة الفرع الواحد.",
      trial: true,
    },
  ],
  on_expiry: {
    hidden: ["السوق والطلبات", "التقارير المتقدمة"],
    never_hidden: ["الدفتر كاملاً للقراءة", "التصدير الكامل"],
    grace_days: 14,
  },
};

const LEGAL = {
  blocked_on: "G-11",
  sections: [
    {
      id: "data",
      title: "ملكية البيانات والتصدير",
      status: "decided",
      summary: "بياناتك تبقى لك: تصدير كامل في أي وقت، وانتهاء الاشتراك لا يحجبها.",
    },
    { id: "market", title: "حدود مسؤولية المنصة في السوق", status: "pending", summary: "" },
    { id: "support", title: "وصول الدعم إلى بيانات المستأجر", status: "pending", summary: "" },
    { id: "retention", title: "الاحتفاظ بالبيانات بعد الإلغاء", status: "pending", summary: "" },
    { id: "consent", title: "قناة التنبيهات وموافقة الزبون", status: "pending", summary: "" },
  ],
};

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const STATUS_OK = {
  checked_at: new Date().toISOString(),
  interval_seconds: 60,
  components: [
    { id: "pos", name: "البيع على الأجهزة", state: "ok", detail: "يعمل محلياً حتى أثناء العطل" },
    { id: "sync", name: "المزامنة", state: "ok", detail: "الرفع والمطابقة يعملان" },
    {
      id: "market",
      name: "السوق والطلبات",
      state: "not_launched",
      detail: "لم يُفتح بعد — المرحلة M3",
    },
    { id: "sms", name: "الرسائل النصية", state: "ok", detail: "الإرسال يعمل" },
  ],
  maintenance: { notice: "", from: "", until: "" },
  events: [{ at: at(9, 10), text: "تأخير في الرفع منذ 09:10 — استُعيد بعد 20 دقيقة." }],
  overall: "ok",
};

const STATUS_DOWN = {
  ...STATUS_OK,
  components: [
    {
      id: "pos",
      name: "البيع على الأجهزة المثبَّتة",
      state: "ok",
      detail: "محلي — لا يعتمد على الخادم",
    },
    { id: "sync", name: "المزامنة", state: "down", detail: "الرفع متوقف · المعلّق محفوظ عندك" },
    { id: "market", name: "السوق والطلبات", state: "down", detail: "التصفح والإرسال متوقفان" },
    {
      id: "sms",
      name: "بوابة الزبون والحملات",
      state: "affected",
      detail: "الطابور متوقف · لا رسائل ضائعة",
    },
  ],
  events: [
    { at: at(10, 5), text: "تأكيد التعطل في المزامنة والسوق. البيع المحلي غير متأثر." },
    {
      at: at(9, 50),
      text: "تقارير عن فشل المزامنة قيد التحقق. لم نؤكد بعد ولن نعلن «كل شيء سليم» قبل التحقق.",
    },
  ],
  overall: "down",
};

test.describe("PUB-01", () => {
  test("ready → offline: الوعود وما لا نعده به والأسعار كاملة؛ وبلا اتصال يُوجَّه إلى تطبيقه", async ({
    page,
    context,
  }, info) => {
    await page.route("**/api/public/plans", (route) => route.fulfill(json(200, PLANS)));
    await page.goto("/");
    await expectFrame(page, info, {
      screenId: "PUB-01",
      state: "ready",
      texts: fromFrame("PUB-01", "ready", [
        "دفتر محلك يعمل وإن انقطعت الشبكة، ويبقى ملكك وإن توقف اشتراكك",
        "نظام بيع ومخزون وذمم للمتاجر الصغيرة، بالعربية ومن اليمين إلى اليسار، وسوق يصلك بموردي منطقتك.",
        "ما نعده به — كل سطر قابل للإثبات",
        "نعم",
        "البيع يعمل بلا اتصال",
        "فواتير وورديات وذمم على الجهاز، وترفع عند عودة الشبكة.",
        "دفترك ملكك",
        "تصدير كامل في أي وقت، وحتى بعد انتهاء الاشتراك.",
        "عربية كاملة من اليمين",
        "الواجهة والإيصالات والتقارير — لا ترجمة جزئية.",
        "سعر معلن قبل التسجيل",
        "الباقات وما يُحجب عند الانتهاء مكتوبان على هذه الصفحة.",
        "ما لا نعده به — مكتوب قبل التسجيل لا بعده",
        "لا",
        "لا ضمان أرباح ولا نسبة زيادة مبيعات — لا نملك دليلاً على رقم كهذا.",
        "لا ضمان جودة موردي السوق: الشارة تحقق هوية لا تزكية بضاعة.",
        "لسنا طرفاً في الدفع بينك وبين موردك ولا ضامنين لأي طلب.",
        "لا قائمة عتاد «مدعوم» قبل تجربة فعلية على جهازك — G-10 مفتوح.",
        "الأسعار كاملة على هذه الصفحة: الباقات وما يحجبه الانتهاء وما لا يُحجب أبداً. لا «تواصل معنا للسعر» ولا تجربة تنتهي بخصم مفاجئ.",
        "الشروط وسياسة الخصوصية",
        "نقوله",
        "يعمل بلا إنترنت ويحفظ بيعك على الجهاز — مع شرح الفرق بين «محفوظ عندك» و«مؤكَّد عند الخادم».",
        "بياناتك تبقى لك: تصدير كامل في أي وقت، وانتهاء الاشتراك لا يحجبها.",
        "لا نقوله",
        "«محاسبة كاملة» أو «متوافق مع المعايير المحاسبية» — النظام دفتر تشغيلي لا نظام محاسبة.",
        "«يزيد مبيعاتك» أو نسب نجاح لا نملك قياسها عند تجّار لم نرَ دفاترهم.",
      ]),
    });
    await expect(page.getByText("45,000.00")).toBeVisible();
    await expect(page.getByText("85,000.00")).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "PUB-01",
      state: "offline",
      texts: fromFrame("PUB-01", "offline", [
        "زائر بلا اتصال",
        "يحدث لمن ثبّت التطبيق ثم فتح صفحة التعريف. المحتوى التسويقي غير مخزّن ولا داعي لتخزينه.",
        "لا اتصال — لكن تطبيقك يعمل",
        "من فتح صفحة تعريف وهو عميلٌ أصلاً يُوجَّه لا يُترك.",
      ]),
    });
    await context.setOffline(false);
  });
});

test.describe("PUB-02", () => {
  test("loading → ready → phase_locked: الفهرس قبل النصّ، البنود بحالتها، وشروط السوق مقفلة", async ({
    page,
  }, info) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let released = false;
    await page.route("**/api/public/legal", async (route) => {
      if (!released) await held;
      return route.fulfill(json(200, LEGAL));
    });
    await page.goto("/legal");
    await expectFrame(page, info, {
      screenId: "PUB-02",
      state: "loading",
      texts: fromFrame("PUB-02", "loading", [
        "جلب الوثيقة",
        "وثائق طويلة تُحمَّل بأقسامها. الفهرس يظهر أولاً فيبدأ القارئ التنقّل قبل اكتمال النصّ.",
        "الفهرس قبل النصّ",
        "من يفتح الشروط يقصد بنداً بعينه غالباً — سياسة الاسترجاع مثلاً — لا يقرأ من أوّلها.",
        "ملكية البيانات والتصدير",
        "حدود مسؤولية المنصة في السوق",
      ]),
    });
    released = true;
    release();
    await expectFrame(page, info, {
      screenId: "PUB-02",
      state: "ready",
      texts: fromFrame("PUB-02", "ready", [
        "الشروط وسياسة الخصوصية",
        "موقوف على",
        "G-11",
        "— مراجعة قانونية",
        "النص الذي يلتزم به المستخدم أمام القانون لا يكتبه مصمم. الهيكل والعناوين والمواضع مصمَّمة، والنص نفسه ينتظر مراجعة مختص.",
        "الهيكل المصمَّم — بانتظار النص",
        "ما هو محسوم تصميمياً ولا ينتظر المراجعة: التصدير متاح دائماً، والبيانات ملك المنشأة، والانتهاء لا يحجب الدفتر. هذه وعود المنتج لا صياغات قانونية.",
        "ملكية البيانات والتصدير",
        "محسوم منتجياً",
        "حدود مسؤولية المنصة في السوق",
        "بانتظار النص",
        "وصول الدعم إلى بيانات المستأجر",
        "الاحتفاظ بالبيانات بعد الإلغاء",
        "قناة التنبيهات وموافقة الزبون",
      ]),
    });
    await page.getByRole("button", { name: "شروط السوق" }).click();
    await expectFrame(page, info, {
      screenId: "PUB-02",
      state: "phase_locked",
      texts: fromFrame("PUB-02", "phase_locked", [
        "حدود مسؤولية المنصة في السوق",
        "التخطيط والبنية جاهزان: مسؤوليات المنصة، مسؤوليات التاجر، معنى شارة التحقُّق، وما لا نضمنه. النص النهائي يبقى موقوفاً على",
        "لأنه يحدّ مسؤولية قانونية أمام المشتري.",
        "لا ضمان جودة موردي السوق: الشارة تحقق هوية لا تزكية بضاعة.",
      ]),
    });
  });
});

test.describe("PUB-03", () => {
  test("ready → stale: كل الخدمات تعمل بوقت الفحص، ثم الفحص متعثّر حين لا يردّ الخادم", async ({
    page,
  }, info) => {
    let down = false;
    await page.route("**/api/public/status", (route) =>
      down ? route.abort("failed") : route.fulfill(json(200, STATUS_OK)),
    );
    await page.goto("/status");
    await expectFrame(page, info, {
      screenId: "PUB-03",
      state: "ready",
      texts: fromFrame("PUB-03", "ready", [
        "حالة خدمة Sting",
        "status.sting — استضافة مستقلة عن الخادم",
        "كل الخدمات تعمل",
        "قائمة الخدمات بحالة كلٍّ، وتاريخ الأحداث الأخيرة. على بنية مستقلة تماماً عن المنتج.",
        "البيع على الأجهزة",
        "المزامنة",
        "السوق والطلبات",
        "سجل التحديثات",
        "لا أخضر دائم",
        "نعرض تاريخ الأعطال السابقة ولو كانت قصيرة. صفحةٌ لم تُسجّل عطباً قط لا يصدّقها أحد.",
      ]),
    });
    down = true;
    await page.getByRole("button", { name: "أعد الفحص" }).click();
    await expectFrame(page, info, {
      screenId: "PUB-03",
      state: "stale",
      texts: fromFrame("PUB-03", "stale", [
        "الفحص متعثّر",
        "آخر فحص آلي قبل",
        "دقيقة والمعتاد كل دقيقة. الحالة المعروضة قد لا تكون الحالية.",
        "نعترف",
        "دقيقة — قد لا يعكس الوضع الآن». صفحةٌ تقول «كل شيء يعمل» بناءً على فحصٍ قديم تكذب في أسوأ لحظة.",
      ]),
    });
  });

  test("server_error: تعطل جزئي — ما يعمل عندك الآن رغم التعطل، والسجل لا يعلن سليماً قبل التحقق", async ({
    page,
  }, info) => {
    await page.route("**/api/public/status", (route) => route.fulfill(json(200, STATUS_DOWN)));
    await page.goto("/status");
    await expectFrame(page, info, {
      screenId: "PUB-03",
      state: "server_error",
      texts: fromFrame("PUB-03", "server_error", [
        "حالة خدمة Sting",
        "تعطل جزئي",
        "ما يعمل عندك الآن رغم التعطل:",
        "البيع وإصدار الفواتير والورديات على الأجهزة المثبَّتة. العمليات تُحفظ محلياً وتُزامَن عند العودة. المتوقف هو السوق والطلبات والتقارير الخادمية.",
        "البيع على الأجهزة المثبَّتة",
        "محلي — لا يعتمد على الخادم",
        "يعمل",
        "المزامنة",
        "الرفع متوقف · المعلّق محفوظ عندك",
        "متوقفة",
        "السوق والطلبات",
        "التصفح والإرسال متوقفان",
        "بوابة الزبون والحملات",
        "الطابور متوقف · لا رسائل ضائعة",
        "متوقفة جزئياً",
        "سبب التعطل محدَّد ويجري الإصلاح. المعلّق على الأجهزة سيُرفع تلقائياً عند العودة بلا تدخل منك.",
        "سجل التحديثات",
        "تأكيد التعطل في المزامنة والسوق. البيع المحلي غير متأثر.",
        "تقارير عن فشل المزامنة قيد التحقق. لم نؤكد بعد ولن نعلن «كل شيء سليم» قبل التحقق.",
      ]),
    });
  });
});

test.describe("PUB-04", () => {
  test("empty: الصفحة غير موجودة بثلاثة مخارج", async ({ page }, info) => {
    await page.goto("/no-such-page-xyz");
    await expectFrame(page, info, {
      screenId: "PUB-04",
      state: "empty",
      texts: fromFrame("PUB-04", "empty", [
        "الصفحة غير موجودة",
        "رابط خاطئ أو محتوى حُذف. لا رسم طريف ولا اعتذار طويل.",
        "مخارج بحسب من هو",
        "ثلاثة: الصفحة الرئيسية، دخول التطبيق، السوق. زائرٌ ضالّ أحدُ ثلاثة، ولكلٍّ بابه.",
      ]),
    });
    await expect(page.getByRole("button", { name: "الصفحة الرئيسية" })).toBeVisible();
    await expect(page.getByRole("button", { name: "دخول التطبيق" })).toBeVisible();
  });

  test("expired: نصّ واحد لثلاث حالات — لا نقول إن كان موجوداً", async ({ page }, info) => {
    await page.goto("/link-expired");
    await expectFrame(page, info, {
      screenId: "PUB-04",
      state: "expired",
      texts: fromFrame("PUB-04", "expired", [
        "الرابط لم يعد صالحاً",
        "هذا الرابط منتهٍ أو غير متاح لك. لا نقول إن كان موجوداً أصلاً، ولا لمن يخص، ولا ما نوعه — وهذا مقصود: لو غيّرنا النص حسب وجود المستند لصار هذا الاختلاف نفسه تسريباً يُستعمل للتنصت على ما لدى غيرك.",
        "نص واحد لثلاث حالات:",
        "رابط منتهٍ، رابط لمنشأة أخرى، رابط لا وجود له. الثلاثة تعطي هذه الصفحة بالحرف نفسه وبزمن استجابة متقارب.",
        "عودة إلى الصفحة الرئيسية",
        "طلب رابط جديد من مُرسِله",
      ]),
    });
  });

  test("permission_denied: موجودة ولا تملك فتحها — تخصّ منشأة أخرى بلا اسم ولا محتوى", async ({
    page,
  }, info) => {
    await page.goto("/forbidden");
    await expectFrame(page, info, {
      screenId: "PUB-04",
      state: "permission_denied",
      texts: fromFrame("PUB-04", "permission_denied", [
        "موجودة ولا تملك فتحها",
        "صفحة منشأة أخرى أو مستند لا يخصّه. لا نقول «غير موجودة» — كذبةٌ، ولا نصفها — إفشاء.",
        "«هذه الصفحة تخصّ منشأة أخرى» بلا اسم ولا محتوى، مع «ادخل بحسابك» — فقد يكون مخوّلاً بحسابٍ آخر.",
      ]),
    });
    await expect(page.getByRole("button", { name: "ادخل بحسابك" })).toBeVisible();
  });
});
