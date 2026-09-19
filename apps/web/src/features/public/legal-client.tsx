"use client";

import { Button, Frame, Notice, PhaseLocked, Status } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./public.css";
import { PublicNav } from "@/features/public/public-nav";
import { api } from "@/lib/api";

type State = "ready" | "loading" | "phase_locked";

interface Section {
  id: string;
  title: string;
  status: "decided" | "pending";
  summary: string;
}

const MARKET_LOCK =
  "شروط السوق تُكتب مع فتحه في المرحلة M3، ونصّها القانوني موقوف على G-11 — مراجعة قانونية.";

/** PUB-02 — الخصوصية وشروط السوق والمساعدة (12-D7 ready/phase_locked · 37-D29 loading). */
export function LegalClient() {
  const router = useRouter();
  const params = useSearchParams();
  const section = params.get("section") ?? "";
  const [sections, setSections] = useState<Section[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .GET("/api/public/legal")
      .then(({ data, response }) => {
        const body = data as unknown as { sections: Section[] } | undefined;
        if (!cancelled && response.ok && body) setSections(body.sections);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const state: State = section === "market" ? "phase_locked" : sections ? "ready" : "loading";
  const index = sections ?? [];

  const body = (
    <>
      <div className="cat-table pos-card">
        <div className="cat-head">
          <h3 className="cat-head__title">الهيكل المصمَّم — بانتظار النص</h3>
          <span className="cat-head__hint">
            ما هو محسوم تصميمياً ولا ينتظر المراجعة: التصدير متاح دائماً، والبيانات ملك المنشأة،
            والانتهاء لا يحجب الدفتر. هذه وعود المنتج لا صياغات قانونية.
          </span>
        </div>
        <div className="acc-card__body">
          {sections ? (
            <ul className="pub-list">
              {sections.map((s) => (
                <li key={s.id} id={s.id}>
                  <Status
                    state={s.status === "decided" ? "success" : "phase_locked"}
                    label={s.status === "decided" ? "محسوم منتجياً" : "بانتظار النص"}
                  />
                  <span>
                    <strong>{s.title}</strong>
                    {s.summary ? (
                      <>
                        <br />
                        {s.summary}
                      </>
                    ) : null}
                    {s.id === "market" ? (
                      <div className="acc-actions">
                        <Button onClick={() => router.push("/legal?section=market")}>
                          شروط السوق
                        </Button>
                      </div>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <div className="pub-skeleton" />
              <div className="pub-skeleton" />
              <div className="pub-skeleton" />
            </>
          )}
        </div>
      </div>
    </>
  );

  return (
    <Frame title="Sting" footer={null}>
      <div className="sys pub" data-screen="PUB-02" data-state={state}>
        <PublicNav current="legal" />
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الشروط وسياسة الخصوصية</h2>
            <span className="cat-head__hint">
              موقوف على G-11 — مراجعة قانونية. النص الذي يلتزم به المستخدم أمام القانون لا يكتبه
              مصمم. الهيكل والعناوين والمواضع مصمَّمة، والنص نفسه ينتظر مراجعة مختص.
            </span>
          </div>
          <div className="acc-card__body">
            <p className="acc-choice__note">
              <strong>الفهرس قبل النصّ</strong> · من يفتح الشروط يقصد بنداً بعينه غالباً — سياسة
              الاسترجاع مثلاً — لا يقرأ من أوّلها.
            </p>
            <nav className="pub-index" aria-label="فهرس الوثيقة">
              {(index.length
                ? index
                : [
                    { id: "data", title: "ملكية البيانات والتصدير" },
                    { id: "offline", title: "العمل بلا اتصال" },
                    { id: "market", title: "حدود مسؤولية المنصة في السوق" },
                    { id: "support", title: "وصول الدعم إلى بيانات المستأجر" },
                    { id: "retention", title: "الاحتفاظ بالبيانات بعد الإلغاء" },
                    { id: "consent", title: "قناة التنبيهات وموافقة الزبون" },
                  ]
              ).map((s) => (
                <Button
                  key={s.id}
                  variant="quiet"
                  onClick={() =>
                    s.id === "market"
                      ? router.push("/legal?section=market")
                      : document.getElementById(s.id)?.scrollIntoView()
                  }
                >
                  {s.title}
                </Button>
              ))}
            </nav>
          </div>
        </div>

        {state === "loading" ? (
          <Notice kind="info" title="جلب الوثيقة">
            <p className="acc-lead">
              وثائق طويلة تُحمَّل بأقسامها. الفهرس يظهر أولاً فيبدأ القارئ التنقّل قبل اكتمال النصّ.
            </p>
          </Notice>
        ) : null}

        {state === "phase_locked" ? (
          <PhaseLocked kind="M3" title="شروط السوق" explanation={MARKET_LOCK}>
            <Notice kind="locked" title="حدود مسؤولية المنصة في السوق">
              <p className="acc-lead">
                التخطيط والبنية جاهزان: مسؤوليات المنصة، مسؤوليات التاجر، معنى شارة التحقُّق، وما لا
                نضمنه. النص النهائي يبقى موقوفاً على G-11 لأنه يحدّ مسؤولية قانونية أمام المشتري.
              </p>
              <p className="acc-choice__note">
                لا ضمان جودة موردي السوق: الشارة تحقق هوية لا تزكية بضاعة. لسنا طرفاً في الدفع بينك
                وبين موردك ولا ضامنين لأي طلب.
              </p>
            </Notice>
            <div className="acc-actions">
              <Button onClick={() => router.push("/legal")}>عودة إلى الفهرس</Button>
            </div>
          </PhaseLocked>
        ) : (
          body
        )}
      </div>
    </Frame>
  );
}
