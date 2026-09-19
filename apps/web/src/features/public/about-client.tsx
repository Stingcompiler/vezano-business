"use client";

import { Button, formatMinor, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./public.css";
import { PublicNav } from "@/features/public/public-nav";
import { api } from "@/lib/api";
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

/** PUB-01 — تعريف Sting والباقات ومدخل السوق (12-D7 · 21-D16 ready · 37-D29 offline). */
export function AboutClient() {
  const router = useRouter();
  const online = useOnline();
  const [plans, setPlans] = useState<Plans | null>(null);
  const [installed, setInstalled] = useState(false);

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

  return (
    <Frame title="Sting" footer={null}>
      <div className="sys pub" data-screen="PUB-01" data-state={state}>
        <PublicNav current="about" />
        {state === "offline" ? (
          <Notice
            kind="offline"
            title="لا اتصال — لكن تطبيقك يعمل"
            action={
              installed ? (
                <Button pos onClick={() => router.push("/lock")}>
                  افتح التطبيق
                </Button>
              ) : undefined
            }
          >
            <p className="acc-lead">
              <strong>زائر بلا اتصال</strong> · يحدث لمن ثبّت التطبيق ثم فتح صفحة التعريف. المحتوى
              التسويقي غير مخزّن ولا داعي لتخزينه.
            </p>
            <p className="acc-choice__note">من فتح صفحة تعريف وهو عميلٌ أصلاً يُوجَّه لا يُترك.</p>
          </Notice>
        ) : null}

        <div className="cat-table pos-card">
          <div className="acc-card__body pub-hero">
            <h2>دفتر محلك يعمل وإن انقطعت الشبكة، ويبقى ملكك وإن توقف اشتراكك</h2>
            <p className="acc-lead">
              نظام بيع ومخزون وذمم للمتاجر الصغيرة، بالعربية ومن اليمين إلى اليسار، وسوق يصلك بموردي
              منطقتك.
            </p>
            <div className="acc-actions">
              <Button pos onClick={() => router.push("/welcome")}>
                ابدأ — الترحيب والدخول
              </Button>
              <Button onClick={() => router.push("/setup-device")}>تجهيز الجهاز</Button>
            </div>
          </div>
        </div>

        <div className="pub-cols">
          <div className="cat-table pos-card">
            <div className="cat-head">
              <h3 className="cat-head__title">ما نعده به — كل سطر قابل للإثبات</h3>
            </div>
            <div className="acc-card__body">
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
          </div>
          <div className="cat-table pos-card">
            <div className="cat-head">
              <h3 className="cat-head__title">ما لا نعده به — مكتوب قبل التسجيل لا بعده</h3>
            </div>
            <div className="acc-card__body">
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

        <div className="cat-table pos-card">
          <div className="cat-head">
            <h3 className="cat-head__title">الباقات</h3>
            <span className="cat-head__hint">
              الأسعار كاملة على هذه الصفحة: الباقات وما يحجبه الانتهاء وما لا يُحجب أبداً. لا «تواصل
              معنا للسعر» ولا تجربة تنتهي بخصم مفاجئ.
            </span>
          </div>
          <div className="acc-card__body">
            {plans ? (
              <>
                <table className="pub-plans">
                  <thead>
                    <tr>
                      <th scope="col">الباقة</th>
                      <th scope="col">شهرياً</th>
                      <th scope="col">ما تشمله</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.plans.map((p) => (
                      <tr key={p.code}>
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td>
                          {p.trial ? (
                            "مجاناً"
                          ) : (
                            <span className="sting-mono">{formatMinor(p.price_minor)}</span>
                          )}
                        </td>
                        <td>{p.blurb}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="acc-lead">
                  <strong>ما يحجبه الانتهاء</strong> · {plans.on_expiry.hidden.join("، ")} — بعد
                  مهلة <span className="sting-mono">{plans.on_expiry.grace_days}</span> يوماً.
                </p>
                <p className="acc-lead">
                  <strong>ما لا يُحجب أبداً</strong> · {plans.on_expiry.never_hidden.join("، ")}.
                </p>
              </>
            ) : (
              <p className="acc-choice__note">
                {online ? "تُجلب الباقات من الخادم…" : "الباقات تحتاج اتصالاً — لا سعر من الذاكرة."}
              </p>
            )}
          </div>
        </div>

        <div className="cat-table pos-card">
          <div className="cat-head">
            <h3 className="cat-head__title">مدخل السوق</h3>
            <span className="cat-head__hint">
              سوق يصلك بموردي منطقتك — يُفتح في المرحلة M3. الشارة تحقق هوية لا تزكية بضاعة.
            </span>
          </div>
          <div className="acc-card__body acc-actions">
            <Button onClick={() => router.push("/legal")}>الشروط وسياسة الخصوصية</Button>
            <Button onClick={() => router.push("/status")}>حالة الخدمة</Button>
          </div>
        </div>
      </div>
    </Frame>
  );
}
