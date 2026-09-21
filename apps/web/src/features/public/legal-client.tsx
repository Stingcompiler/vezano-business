"use client";

import { Button, Frame, Notice, PhaseLocked, Status } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./public.css";
import { PublicHeader } from "@/features/public/public-header";
import { api } from "@/lib/api";

type State = "ready" | "loading" | "phase_locked";

interface Section {
  id: string;
  title: string;
  status: "decided" | "pending";
  summary: string;
  /** مسودة نصّ السودان (core/legal_text.py) — الاعتماد موقوف على G-11 */
  body?: string[];
}

interface LegalPayload {
  sections: Section[];
  preamble?: string[];
  updated?: string;
  market_open?: boolean;
}

const MARKET_LOCK =
  "شروط السوق تُكتب مع فتحه في المرحلة M3، ونصّها القانوني موقوف على G-11 — مراجعة قانونية.";

/** الفهرس قبل وصول الخادم — العناوين نفسها التي يعيدها `/api/public/legal`. */
const FALLBACK_INDEX = [
  { id: "data", title: "ملكية البيانات والتصدير" },
  { id: "offline", title: "العمل بلا اتصال" },
  { id: "market", title: "حدود مسؤولية المنصة في السوق" },
  { id: "support", title: "وصول الدعم إلى بيانات المستأجر" },
  { id: "retention", title: "الاحتفاظ بالبيانات بعد الإلغاء" },
  { id: "consent", title: "قناة التنبيهات وموافقة الزبون" },
];

/** PUB-02 — الخصوصية وشروط السوق والمساعدة (12-D7 ready/phase_locked · 37-D29 loading). */
export function LegalClient() {
  const router = useRouter();
  const params = useSearchParams();
  const section = params.get("section") ?? "";
  const [sections, setSections] = useState<Section[] | null>(null);
  const [preamble, setPreamble] = useState<string[]>([]);
  const [updated, setUpdated] = useState("");
  // M3 مفتوحة في هذه البيئة؟ بند شروط السوق يصير «بانتظار النص» بدل قفل المرحلة (0005 §٩٦)
  const [marketOpen, setMarketOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api()
      .GET("/api/public/legal")
      .then(({ data, response }) => {
        const body = data as unknown as LegalPayload | undefined;
        if (!cancelled && response.ok && body) {
          setSections(body.sections);
          setPreamble(body.preamble ?? []);
          setUpdated(body.updated ?? "");
          setMarketOpen(Boolean(body.market_open));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const state: State =
    section === "market" && !marketOpen ? "phase_locked" : sections ? "ready" : "loading";
  const index = sections?.length ? sections : FALLBACK_INDEX;
  const drafted = Boolean(sections?.some((s) => s.body?.length));
  const marketBody = sections?.find((s) => s.id === "market")?.body ?? [];

  /** شارة البند: محسوم / مسودة بانتظار المراجعة القانونية / بانتظار النص (لا نصّ بعد) */
  const badge = (s: Section) =>
    s.status === "decided" ? (
      <Status state="success" label="محسوم منتجياً" />
    ) : s.body?.length ? (
      <Status state="pending_sync" label="مسودة — بانتظار المراجعة القانونية" />
    ) : (
      <Status state="phase_locked" label="بانتظار النص" />
    );

  const paragraphs = (ps: readonly string[] | undefined, cls: string) =>
    ps?.length ? (
      <div className={cls}>
        {ps.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </div>
    ) : null;

  const marketNote = (
    <>
      <p className="acc-choice__note">
        لا ضمان جودة موردي السوق: الشارة تحقق هوية لا تزكية بضاعة. لسنا طرفاً في الدفع بينك وبين
        موردك ولا ضامنين لأي طلب.
      </p>
    </>
  );

  const body = (
    <>
      {section === "market" && marketOpen ? (
        <div className="pb-card pb-card--pad">
          <Notice kind="warning" title="حدود مسؤولية المنصة في السوق — بانتظار النص (G-11)">
            <p className="acc-lead">
              السوق مفتوح، والهيكل جاهز: مسؤوليات المنصة، مسؤوليات التاجر، معنى شارة التحقُّق، وما
              لا نضمنه. النص النهائي يبقى موقوفاً على G-11 لأنه يحدّ مسؤولية قانونية أمام المشتري.
            </p>
            {marketNote}
          </Notice>
          {paragraphs(marketBody, "pb-doc")}
          <div className="acc-actions">
            <Button onClick={() => router.push("/legal")}>عودة إلى الفهرس</Button>
          </div>
        </div>
      ) : null}

      {preamble.length ? (
        <div className="pb-card">
          <div className="pb-card__head">
            <h3 className="pb-card__title">تمهيد وأحكام عامة</h3>
            <p className="pb-card__hint">
              مسودة مقترحة لجمهورية السودان — ما بين [معقوفين] بيانات يملؤها المالك، والاعتماد موقوف
              على <span className="sting-mono">G-11</span>
              {updated ? (
                <>
                  {" "}
                  · آخر تحديث <span className="sting-mono">{updated}</span>
                </>
              ) : null}
            </p>
          </div>
          {paragraphs(preamble, "pb-doc pb-doc--pad")}
        </div>
      ) : null}

      <div className="pb-card">
        <div className="pb-card__head">
          <h3 className="pb-card__title">
            {drafted
              ? "البنود — مسودة بانتظار المراجعة القانونية"
              : "الهيكل المصمَّم — بانتظار النص"}
          </h3>
          <p className="pb-card__hint">
            ما هو محسوم تصميمياً ولا ينتظر المراجعة: التصدير متاح دائماً، والبيانات ملك المنشأة،
            والانتهاء لا يحجب الدفتر. هذه وعود المنتج لا صياغات قانونية.
          </p>
        </div>
        {sections ? (
          <ol className={drafted ? "pb-sections pb-sections--doc" : "pb-sections"}>
            {sections.map((s, i) => (
              <li key={s.id} id={s.id} className="pb-section" data-status={s.status}>
                <div className="pb-section__top">
                  <span className="pb-section__n sting-mono">{String(i + 1).padStart(2, "0")}</span>
                  {badge(s)}
                </div>
                <strong className="pb-section__title">{s.title}</strong>
                {s.summary ? <p className="pb-section__text">{s.summary}</p> : null}
                {paragraphs(s.body, "pb-doc")}
                {s.id === "market" ? (
                  <div className="pb-section__actions">
                    <Button
                      variant="secondary"
                      onClick={() => router.push("/legal?section=market")}
                    >
                      شروط السوق
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className="pb-sections pb-sections--skeleton" aria-hidden="true">
            <div className="pub-skeleton" />
            <div className="pub-skeleton" />
            <div className="pub-skeleton" />
          </div>
        )}
      </div>
    </>
  );

  return (
    <Frame title="فيزانو" footer={null} back={false} chrome={<PublicHeader cta="login" />}>
      <div className="sys pub pb" data-screen="PUB-02" data-state={state}>
        <section className="pb-hero">
          <span className="pb-eyebrow">
            موقوف على <span className="sting-mono">G-11</span> — مراجعة قانونية
          </span>
          <h2 className="pb-hero__title">الشروط وسياسة الخصوصية</h2>
          <p className="pb-hero__sub">
            النص الذي يلتزم به المستخدم أمام القانون لا يكتبه مصمم. الهيكل والعناوين والمواضع
            مصمَّمة، والنص نفسه ينتظر مراجعة مختص.
          </p>
        </section>

        <div className="pb-layout">
          <aside className="pb-side">
            <div className="pb-card pb-card--pad pb-index-card">
              <p className="pb-kicker">
                <strong>الفهرس قبل النصّ</strong>
              </p>
              <p className="pb-card__hint">
                من يفتح الشروط يقصد بنداً بعينه غالباً — سياسة الاسترجاع مثلاً — لا يقرأ من أوّلها.
              </p>
              <nav className="pub-index" aria-label="فهرس الوثيقة">
                {index.map((s, i) => (
                  <Button
                    key={s.id}
                    variant="quiet"
                    onClick={() =>
                      s.id === "market"
                        ? router.push("/legal?section=market")
                        : document.getElementById(s.id)?.scrollIntoView({ block: "start" })
                    }
                  >
                    <span className="pub-index__n sting-mono">{i + 1}</span>
                    <span className="pub-index__label">{s.title}</span>
                  </Button>
                ))}
              </nav>
            </div>
          </aside>

          <div className="pb-main">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الوثيقة">
                <p className="acc-lead">
                  وثائق طويلة تُحمَّل بأقسامها. الفهرس يظهر أولاً فيبدأ القارئ التنقّل قبل اكتمال
                  النصّ.
                </p>
              </Notice>
            ) : null}

            {state === "phase_locked" ? (
              <PhaseLocked kind="M3" title="شروط السوق" explanation={MARKET_LOCK}>
                <Notice kind="locked" title="حدود مسؤولية المنصة في السوق">
                  <p className="acc-lead">
                    التخطيط والبنية جاهزان: مسؤوليات المنصة، مسؤوليات التاجر، معنى شارة التحقُّق،
                    وما لا نضمنه. النص النهائي يبقى موقوفاً على G-11 لأنه يحدّ مسؤولية قانونية أمام
                    المشتري.
                  </p>
                  {marketNote}
                </Notice>
                {paragraphs(marketBody, "pb-doc")}
                <div className="acc-actions">
                  <Button onClick={() => router.push("/legal")}>عودة إلى الفهرس</Button>
                </div>
              </PhaseLocked>
            ) : (
              body
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
