"use client";

import {
  Button,
  formatMinor,
  Notice,
  RadioGroupField,
  TextAreaField,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./public.css";
import "./landing.css";
import { PublicHeader } from "@/features/public/public-header";
import { api, apiBaseUrl } from "@/lib/api";
import { hasLocalSetup } from "@/lib/device-setup";
import { useOnline } from "@/lib/online";

type State = "ready" | "offline";

interface Plan {
  code: string;
  name: string;
  price_minor: string;
  max_branches: number;
  max_devices: number;
  blurb: string;
  trial: boolean;
}

interface Plans {
  plans: Plan[];
  on_expiry: { hidden: string[]; never_hidden: string[]; grace_days: number };
}

const PROMISES: [string, string][] = [
  ["البيع يعمل بلا اتصال", "فواتير وورديات وذمم على الجهاز، وترفع عند عودة الشبكة."],
  ["دفترك ملكك", "تصدير كامل في أي وقت، وحتى بعد انتهاء الاشتراك."],
  ["عربية كاملة من اليمين", "الواجهة والإيصالات والتقارير — لا ترجمة جزئية."],
  ["سعر معلن قبل التسجيل", "الباقات وما يُحجب عند الانتهاء مكتوبان على هذه الصفحة."],
];

const NON_PROMISES: string[] = [
  "لا ضمان أرباح ولا نسبة زيادة مبيعات — لا نملك دليلاً على رقم كهذا.",
  "لا ضمان جودة موردي السوق: الشارة تحقق هوية لا تزكية بضاعة.",
  "لسنا طرفاً في الدفع بينك وبين موردك ولا ضامنين لأي طلب.",
  "لا قائمة عتاد «مدعوم» قبل تجربة فعلية على جهازك — G-10 مفتوح.",
];

/** PUB-01 — تعريف فيزانو والباقات ومدخل السوق (12-D7 · 21-D16 ready · 37-D29 offline) — صفحة هبوط بأسلوب vezano.app. */
export function AboutClient() {
  const router = useRouter();
  const online = useOnline();
  const [plans, setPlans] = useState<Plans | null>(null);
  const [installed, setInstalled] = useState(false);
  const [cName, setCName] = useState("");
  const [cWhats, setCWhats] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cChannel, setCChannel] = useState("whatsapp");
  const [cMsg, setCMsg] = useState("");
  const [cBusy, setCBusy] = useState(false);
  const [cErr, setCErr] = useState<string | null>(null);
  const [cRef, setCRef] = useState<string | null>(null);
  const submitContact = async (e: FormEvent) => {
    e.preventDefault();
    if (cBusy) return;
    setCErr(null);
    if (!cName.trim()) return setCErr("اكتب اسمك.");
    if (cWhats.replace(/\D/g, "").length < 8) return setCErr("رقم الواتساب غير مكتمل.");
    if (cEmail && !cEmail.includes("@")) return setCErr("البريد غير صالح.");
    setCBusy(true);
    try {
      const r = await fetch(`${apiBaseUrl()}/api/public/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cName.trim(),
          whatsapp: cWhats.trim(),
          email: cEmail.trim(),
          channel: cChannel,
          message: cMsg.trim(),
        }),
      });
      if (r.status === 201) {
        const body = (await r.json()) as { reference: string };
        setCRef(body.reference);
        return;
      }
      setCErr(
        r.status === 429
          ? "طلبات كثيرة من هذا الجهاز — حاول بعد ساعة."
          : "تعذّر الحفظ الآن. جرّب مرة أخرى.",
      );
    } catch {
      setCErr("لا اتصال — الطلب يحتاج الشبكة.");
    } finally {
      setCBusy(false);
    }
  };
  useEffect(() => {
    void hasLocalSetup().then(setInstalled);
  }, []);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void api()
      .GET("/api/public/plans")
      .then(({ data, response }) => {
        const body = data as unknown as Plans | undefined;
        if (!cancelled && response.ok && body) setPlans(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [online]);

  const state: State = online ? "ready" : "offline";
  const go = (href: string) => () => router.push(href);

  return (
    <div className="lp sys pub" data-screen="PUB-01" data-state={state}>
      <a className="c-frame__skip" href="#lp-main">
        تخطٍّ إلى المحتوى
      </a>
      <header>
        <PublicHeader />
      </header>

      <main id="lp-main">
        {state === "offline" ? (
          <div className="lp__wrap">
            <Notice
              kind="offline"
              title="لا اتصال — لكن تطبيقك يعمل"
              action={
                installed ? (
                  <Button pos onClick={go("/lock")}>
                    افتح التطبيق
                  </Button>
                ) : undefined
              }
            >
              <p className="acc-lead">
                <strong>زائر بلا اتصال</strong> · يحدث لمن ثبّت التطبيق ثم فتح صفحة التعريف. المحتوى
                التسويقي غير مخزّن ولا داعي لتخزينه.
              </p>
              <p className="acc-choice__note">
                من فتح صفحة تعريف وهو عميلٌ أصلاً يُوجَّه لا يُترك.
              </p>
            </Notice>
          </div>
        ) : null}

        <section className="lp__wrap lp__hero">
          <span className="lp__pill">
            للمحلات الصغيرة والبقالات والموزعين المحليين
            <span className="lp__pill-more"> · عربية من اليمين إلى اليسار</span>
          </span>
          <h1>دفتر محلك يعمل وإن انقطعت الشبكة، ويبقى ملكك وإن توقف اشتراكك</h1>
          <p className="lp__lead">
            نظام بيع ومخزون وذمم للمتاجر الصغيرة، بالعربية ومن اليمين إلى اليسار، وسوق يصلك بموردي
            منطقتك.
          </p>
          <div className="lp__cta">
            <Button pos onClick={go("/welcome")}>
              ابدأ — الترحيب والدخول
            </Button>
            <Button onClick={go("/setup-device")}>تجهيز الجهاز</Button>
          </div>
          <p className="lp__note">
            تجربة <span className="sting-mono">30</span> يوماً · بلا بطاقة · بياناتك ملكك — تصدير
            كامل في أي وقت
          </p>

          <div className="lp__window" aria-hidden="true">
            <div className="lp__dots">
              <i />
              <i />
              <i />
            </div>
            <div className="lp__app">
              <aside className="lp__side">
                <strong>فيزانو · بقالة النيل</strong>
                <span data-on="">الرئيسية</span>
                <span>نقطة البيع</span>
                <span>الفواتير</span>
                <span>العملاء والذمم</span>
                <span>المخزون</span>
                <span>السوق</span>
                <span>التقارير</span>
              </aside>
              <div className="lp__screen">
                <div className="lp__card">
                  <h4>صباح الخير — بقالة النيل</h4>
                  <p>يحتاج قرارك — 3 · الفواتير محفوظة على الجهاز وتُرفع عند عودة الشبكة</p>
                </div>
                <div className="lp__stats">
                  <div className="lp__stat">
                    <small>مبيعات اليوم</small>
                    <b>184,500.00</b>
                  </div>
                  <div className="lp__stat">
                    <small>ذمم مستحقة</small>
                    <b>42,000.00</b>
                  </div>
                  <div className="lp__stat">
                    <small>أصناف تحت الحدّ</small>
                    <b>6</b>
                  </div>
                </div>
                <div className="lp__card">
                  <h4>الوردية مفتوحة · جهاز الكاشير</h4>
                  <p>محفوظ عندك 12 · مؤكَّد عند الخادم 12 · لا معلّق</p>
                </div>
              </div>
            </div>
          </div>

          <ul className="lp__checks">
            <li>
              <span className="lp__check" aria-hidden="true">
                ✓
              </span>
              البيع يعمل بلا اتصال
            </li>
            <li>
              <span className="lp__check" aria-hidden="true">
                ✓
              </span>
              عربية كاملة من اليمين
            </li>
            <li>
              <span className="lp__check" aria-hidden="true">
                ✓
              </span>
              دفترك ملكك — تصدير كامل
            </li>
            <li>
              <span className="lp__check" aria-hidden="true">
                ✓
              </span>
              سوق يصلك بموردي منطقتك
            </li>
          </ul>
        </section>

        <section id="lp-features" className="lp__section lp__section--alt">
          <div className="lp__wrap">
            <div className="lp__center">
              <h2>مبني على الطريقة التي يعمل بها صاحب المحل فعلاً</h2>
              <p className="lp__lead">
                بيع، ودفتر ذمم، ومخزون، وموردون — في تطبيق واحد يعمل على الهاتف والحاسوب، ويقول لك
                دائماً ما المحفوظ عندك وما المؤكَّد عند الخادم.
              </p>
            </div>

            <div className="lp__feature">
              <div>
                <div className="lp__kicker">نقطة البيع</div>
                <h2>كاشير لا يتوقف عن البيع</h2>
                <p className="lp__lead">
                  ابحث بالاسم أو الباركود، بِع بالوحدة أو بالكرتونة، نقداً أو آجلاً أو تحويلاً.
                  انقطع الاتصال؟ تُحفظ الفاتورة على الجهاز برقمها وتُرفع مرة واحدة عند عودة الشبكة.
                </p>
                <ul>
                  <li>
                    <span className="lp__check">✓</span> ورديات بصندوق وجرد فعلي عند الإقفال
                  </li>
                  <li>
                    <span className="lp__check">✓</span> تعليق السلة، مرتجعات، وطباعة إيصال عربي
                  </li>
                  <li>
                    <span className="lp__check">✓</span> «محفوظ عندك» و«مؤكَّد عند الخادم» معلَنان
                    دائماً
                  </li>
                </ul>
              </div>
              <div className="lp__panel">
                <div className="lp__row">
                  <span>سكر — كيس 1 كجم × 3</span>
                  <span className="sting-mono">300.00</span>
                </div>
                <div className="lp__row">
                  <span>زيت دوّار الشمس 1.5 ل × 2</span>
                  <span className="sting-mono">560.00</span>
                </div>
                <div className="lp__row">
                  <strong>الإجمالي</strong>
                  <strong className="sting-mono">860.00</strong>
                </div>
                <div className="lp__row">
                  <span>الفاتورة INV-A2-000128</span>
                  <span className="lp__tag lp__tag--warn">محفوظ عندك — بانتظار الشبكة</span>
                </div>
              </div>
            </div>

            <div className="lp__feature">
              <div>
                <div className="lp__kicker">الذمم والمخزون</div>
                <h2>اعرف من يدين لك، وما على الرفّ</h2>
                <p className="lp__lead">
                  البيع الآجل والدفعات والمرتجعات تصب في دفتر عميل واحد بكشف حساب يُشارَك برابط. وكل
                  حركة مخزون — استلام، جرد، تحويل، هالك — مسجَّلة بسببها فالرصيد دائماً قابل
                  للتتبّع.
                </p>
                <ul>
                  <li>
                    <span className="lp__check">✓</span> كشوف حساب وتنبيه بالذمم المتأخرة
                  </li>
                  <li>
                    <span className="lp__check">✓</span> جرد أعمى، وحدود أمان، واقتراح توريد بسببه
                  </li>
                  <li>
                    <span className="lp__check">✓</span> أوامر شراء ومستندات موردين بتكلفة وهامش
                  </li>
                </ul>
              </div>
              <div className="lp__panel">
                <div className="lp__row">
                  <span>أحمد الطيب — عليه</span>
                  <span className="sting-mono">1,250.00</span>
                </div>
                <div className="lp__row">
                  <span>آخر دفعة</span>
                  <span className="sting-mono">500.00</span>
                </div>
                <div className="lp__row">
                  <span>سكر — الرصيد</span>
                  <span>
                    <span className="sting-mono">14</span> كيساً · يكفي{" "}
                    <span className="sting-mono">9</span> أيام
                  </span>
                </div>
                <div className="lp__row">
                  <span>زيت دوّار الشمس</span>
                  <span className="lp__tag lp__tag--warn">تحت حدّ الأمان</span>
                </div>
              </div>
            </div>

            <div className="lp__feature">
              <div>
                <div className="lp__kicker">السوق</div>
                <h2>موردو منطقتك — بطلبٍ موثَّق لا بمكالمة</h2>
                <p className="lp__lead">
                  تصفّح عروض الموردين المنشورة في منطقتك، اطلب بالكمية والسعر المعلَنين، وتابع
                  التأكيد والشحن والاستلام في مكان واحد. ما تستلمه يدخل مخزونك ودفتر المورد بلا
                  إدخال مكرَّر.
                </p>
                <ul>
                  <li>
                    <span className="lp__check">✓</span> أسعار خاصة لقوائم موردك ودعوات بالرابط
                  </li>
                  <li>
                    <span className="lp__check">✓</span> استلام جزئي ومرتجع وخلاف — كلٌّ بسجلّه
                  </li>
                  <li>
                    <span className="lp__check">✓</span> الشارة تحقق هوية المنشأة لا تزكية بضاعة
                  </li>
                </ul>
              </div>
              <div className="lp__panel">
                <div className="lp__row">
                  <span>مخزن البركة للجملة — سكر أبيض</span>
                  <span className="lp__tag">موثَّق المستندات</span>
                </div>
                <div className="lp__row">
                  <span>كرتونة 12×1كغ</span>
                  <span className="sting-mono">118,000.00</span>
                </div>
                <div className="lp__row">
                  <span>الطلب PO-7741 · 10 كراتين</span>
                  <span className="lp__tag">شُحن 8 · استُلم 7</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="lp-promises" className="lp__section">
          <div className="lp__wrap">
            <div className="lp__center">
              <h2>وعود قليلة، كلها قابلة للإثبات</h2>
              <p className="lp__lead">
                ما نعده به مكتوب هنا — وما لا نعده به مكتوب قبل التسجيل لا بعده.
              </p>
            </div>
            <div className="lp__grid lp__grid--2">
              <div className="lp__box">
                <h3>ما نعده به — كل سطر قابل للإثبات</h3>
                <ul className="pub-list">
                  {PROMISES.map(([t, d]) => (
                    <li key={t}>
                      <span className="pub-mark">نعم</span>
                      <span>
                        <strong>{t}</strong>
                        <br />
                        {d}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">
                  <strong>نقوله</strong> · يعمل بلا إنترنت ويحفظ بيعك على الجهاز — مع شرح الفرق بين
                  «محفوظ عندك» و«مؤكَّد عند الخادم». بياناتك تبقى لك: تصدير كامل في أي وقت، وانتهاء
                  الاشتراك لا يحجبها.
                </p>
              </div>
              <div className="lp__box">
                <h3>ما لا نعده به — مكتوب قبل التسجيل لا بعده</h3>
                <ul className="pub-list">
                  {NON_PROMISES.map((t) => (
                    <li key={t}>
                      <span className="pub-mark">لا</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">
                  <strong>لا نقوله</strong> · «محاسبة كاملة» أو «متوافق مع المعايير المحاسبية» —
                  النظام دفتر تشغيلي لا نظام محاسبة. «يزيد مبيعاتك» أو نسب نجاح لا نملك قياسها عند
                  تجّار لم نرَ دفاترهم.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="lp__section lp__section--alt">
          <div className="lp__wrap">
            <div className="lp__center">
              <h2>تبدأ في ثلاث خطوات</h2>
            </div>
            <div className="lp__grid lp__grid--3">
              <div className="lp__box lp__step">
                <div className="lp__num">1</div>
                <h3>أنشئ منشأتك</h3>
                <p>
                  رقم هاتف وكلمة مرور، ثم اسم المحل وفرعه الأول. لا بطاقة ولا عقد — تجربة{" "}
                  <span className="sting-mono">30</span> يوماً كاملة المزايا.
                </p>
              </div>
              <div className="lp__box lp__step">
                <div className="lp__num">2</div>
                <h3>جهّز الجهاز</h3>
                <p>
                  ثبّت التطبيق على هاتف الكاشير أو حاسوب المحل، وسجّل الجهاز باسمه وفرعه. أضف أصنافك
                  بالباركود أو استوردها.
                </p>
              </div>
              <div className="lp__box lp__step">
                <div className="lp__num">3</div>
                <h3>بِع من اليوم الأول</h3>
                <p>
                  افتح وردية وابدأ البيع — بشبكة أو بدونها. الذمم والمخزون يتحدّثان من الفاتورة
                  نفسها، والمالك يرى كل شيء من هاتفه.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="lp-plans" className="lp__section">
          <div className="lp__wrap">
            <div className="lp__center">
              <h2>الباقات</h2>
              <p className="lp__lead">
                الأسعار كاملة على هذه الصفحة: الباقات وما يحجبه الانتهاء وما لا يُحجب أبداً. لا
                «تواصل معنا للسعر» ولا تجربة تنتهي بخصم مفاجئ.
              </p>
            </div>
            {plans ? (
              <>
                <div className="lp__grid lp__grid--3">
                  {plans.plans.map((p, i) => (
                    <div
                      key={p.code}
                      className={`lp__box lp__plan${i === 1 ? " lp__plan--hot" : ""}`}
                    >
                      {i === 1 ? <span className="lp__tag">الأكثر طلباً</span> : null}
                      <h3>{p.name}</h3>
                      {p.trial ? (
                        <div className="lp__price lp__price--free">مجاناً</div>
                      ) : (
                        <div className="lp__price">
                          {formatMinor(p.price_minor)} <small>/ شهرياً</small>
                        </div>
                      )}
                      <p className="acc-choice__note">{p.blurb}</p>
                      <p className="acc-choice__note">
                        <span className="sting-mono">{p.max_branches}</span>{" "}
                        {p.max_branches === 1 ? "فرع" : "فروع"} ·{" "}
                        <span className="sting-mono">{p.max_devices}</span>{" "}
                        {p.max_devices <= 10 ? "أجهزة" : "جهازاً"}
                      </p>
                      <Button pos={i === 1} onClick={go("/welcome")}>
                        {p.trial ? "ابدأ التجربة" : "ابدأ بهذه الباقة"}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="lp__expiry">
                  <p className="acc-lead">
                    <strong>ما يحجبه الانتهاء</strong> · {plans.on_expiry.hidden.join("، ")} — بعد
                    مهلة <span className="sting-mono">{plans.on_expiry.grace_days}</span> يوماً.
                  </p>
                  <p className="acc-lead">
                    <strong>ما لا يُحجب أبداً</strong> · {plans.on_expiry.never_hidden.join("، ")}.
                  </p>
                </div>
              </>
            ) : (
              <p className="acc-choice__note lp__center">
                {online ? "تُجلب الباقات من الخادم…" : "الباقات تحتاج اتصالاً — لا سعر من الذاكرة."}
              </p>
            )}
          </div>
        </section>

        <section id="lp-faq" className="lp__section lp__section--alt">
          <div className="lp__wrap">
            <div className="lp__center">
              <h2>أسئلة شائعة</h2>
            </div>
            <div className="lp__faq">
              <details>
                <summary>هل يعمل بدون إنترنت؟</summary>
                <p>
                  نعم. الفواتير والورديات والذمم تُحفظ على الجهاز وتُرفع عند عودة الشبكة مرة واحدة.
                  الشاشة تقول دائماً ما المحفوظ عندك وما المؤكَّد عند الخادم.
                </p>
              </details>
              <details>
                <summary>من يملك البيانات؟</summary>
                <p>
                  أنت. تصدير كامل في أي وقت، وانتهاء الاشتراك لا يحجب دفترك — ما يُحجب وما لا يُحجب
                  مكتوب في قسم الباقات أعلاه.
                </p>
              </details>
              <details>
                <summary>هل هو نظام محاسبة؟</summary>
                <p>
                  لا. هو دفتر تشغيلي: بيع ومخزون وذمم وموردون. لا نقول «محاسبة كاملة» ولا «متوافق مع
                  المعايير المحاسبية».
                </p>
              </details>
              <details>
                <summary>ما علاقة السوق بالبيع؟</summary>
                <p>
                  السوق يصلك بموردي منطقتك بطلب موثَّق. لسنا طرفاً في الدفع بينك وبين موردك ولا
                  ضامنين لأي طلب — الشارة تحقق هوية المنشأة لا تزكية بضاعة.
                </p>
              </details>
              <details>
                <summary>أي أجهزة وطابعات تعمل؟</summary>
                <p>
                  أي هاتف أو حاسوب بمتصفح حديث. أما قائمة عتاد «مدعوم» فلا نعلنها قبل تجربة فعلية
                  على جهازك — G-10 مفتوح.
                </p>
              </details>
            </div>
          </div>
        </section>

        <section id="lp-contact" className="lp__final">
          <div className="lp__wrap">
            <form className="lp__contact" onSubmit={(e) => void submitContact(e)} noValidate>
              <h2>جاهز لرؤيته على بياناتك؟</h2>
              <p className="lp__lead">
                اترك رقمك وسنرتّب معك جولة قصيرة — <span className="sting-mono">20</span> دقيقة على
                واتساب أو مكالمة — نعرض فيها فيزانو على أصناف محلك وطريقة بيعك الفعلية.
              </p>
              {cRef ? (
                <Notice kind="success" title="وصل طلبك — نتواصل معك على القناة التي اخترتها">
                  <p className="acc-lead">
                    رقم الطلب <span className="sting-mono">{cRef}</span>. لا نعد بموعد قبل أن نتصل —
                    لكننا نقرأ كل طلب.
                  </p>
                </Notice>
              ) : (
                <>
                  {cErr ? <Notice kind="error" title={cErr} /> : null}
                  <div className="lp__contact-grid">
                    <TextField
                      label="اسمك"
                      autoComplete="name"
                      value={cName}
                      onChange={(e) => setCName(e.target.value)}
                      readOnly={cBusy}
                      required
                    />
                    <TextField
                      label="رقم الواتساب"
                      kind="tel"
                      autoComplete="tel"
                      value={cWhats}
                      onChange={(e) => setCWhats(e.target.value)}
                      readOnly={cBusy}
                      required
                    />
                  </div>
                  <TextField
                    label="بريد العمل (اختياري)"
                    autoComplete="email"
                    value={cEmail}
                    onChange={(e) => setCEmail(e.target.value)}
                    readOnly={cBusy}
                  />
                  <RadioGroupField
                    label="كيف نتواصل معك؟"
                    name="contact-channel"
                    value={cChannel}
                    onChange={setCChannel}
                    options={[
                      { value: "whatsapp", label: "واتساب" },
                      { value: "call", label: "مكالمة" },
                      { value: "email", label: "بريد" },
                    ]}
                  />
                  <TextAreaField
                    label="ما الذي تودّ حلّه؟"
                    value={cMsg}
                    onChange={(e) => setCMsg(e.target.value)}
                    readOnly={cBusy}
                    rows={4}
                  />
                  <div className="lp__cta">
                    <Button type="submit" pos loading={cBusy}>
                      اطلب الجولة — مجاناً
                    </Button>
                  </div>
                  <p className="lp__note">
                    لا رسائل تسويقية. الطلب يصل إلى فريق فيزانو ويُردّ عليه بشرياً.
                  </p>
                </>
              )}
            </form>
          </div>
        </section>
      </main>

      <footer className="lp__wrap lp__footer">
        <span className="lp__brand">
          <span className="lp__mark" aria-hidden="true">
            ف
          </span>
          فيزانو
        </span>
        <a href="/legal" onClick={(e) => (e.preventDefault(), router.push("/legal"))}>
          الشروط وسياسة الخصوصية
        </a>
        <a href="/status" onClick={(e) => (e.preventDefault(), router.push("/status"))}>
          حالة الخدمة
        </a>
        <a href="/market" onClick={(e) => (e.preventDefault(), router.push("/market"))}>
          السوق
        </a>
        <a href="/welcome" onClick={(e) => (e.preventDefault(), router.push("/welcome"))}>
          دخول التطبيق
        </a>
      </footer>
    </div>
  );
}
