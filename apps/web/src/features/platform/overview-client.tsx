"use client";

import { Button, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./platform.css";
import { hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "permission_denied";
type Tone = "ok" | "info" | "warn" | "danger";

interface Tile {
  key: string;
  label: string;
  value: number;
  note: string;
  href: string;
  tone: Tone;
}
interface Payload {
  measured_at: string;
  tenants_total: number;
  attention: number;
  subscriptions: Tile[];
  queues: Tile[];
  technical: Tile[];
  rule: string;
}

/** PLT-00 — النظرة العامة: عدّادات ما ينتظر فعلاً، كل بطاقة تفتح شاشتها؛ أرقام من السجل بختم وقتها. */
export function OverviewClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data: d, response } = await platformApi().GET("/api/platform/overview");
    if (response.status === 403 || response.status === 401) {
      setDenied(true);
      return;
    }
    const b = d as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const state: State = denied ? "permission_denied" : data ? "ready" : "loading";

  /** صفّ في قائمة (ما ينتظر/الصحة): أيقونة، اسم وملاحظة، ورقم في حبّة — الصفر رمادي. */
  const row = (t: Tile) => (
    <button
      key={t.key}
      type="button"
      className="plt-tile plt-row"
      data-tone={t.tone}
      data-zero={t.value === 0 || undefined}
      onClick={() => router.push(t.href)}
    >
      <span className="plt-row__icon" aria-hidden="true">
        <Icon name={t.key} />
      </span>
      <span className="plt-row__text">
        <span className="plt-tile__label">{t.label}</span>
        <span className="plt-tile__note">{t.note}</span>
      </span>
      <span className="plt-tile__value plt-pill sting-mono">{t.value}</span>
      <span className="plt-row__chev" aria-hidden="true">
        ‹
      </span>
    </button>
  );

  /** بطاقة قائمة: الأعلى ما يحتاجك، والأصفار باهتة في آخرها. */
  const list = (title: string, tiles: Tile[], allClear: string) => {
    const busy = tiles.filter((t) => t.value > 0);
    const idle = tiles.filter((t) => t.value === 0);
    return (
      <section className="plt-panel">
        <div className="plt-panel__head">
          <h3 className="cat-head__title">{title}</h3>
          {busy.length === 0 ? <Status state="success" label={allClear} /> : null}
        </div>
        <div className="plt-list">{[...busy, ...idle].map(row)}</div>
      </section>
    );
  };

  /** المستأجرون: شريط توزيع سميك ومفتاح ألوان بأرقامه (كل عنصر يفتح قائمته بمرشّحها). */
  const tenants = (d: Payload) => {
    const parts = d.subscriptions.filter((t) =>
      ["active", "trial", "late", "suspended"].includes(t.key),
    );
    const total = parts.reduce((a, t) => a + t.value, 0);
    return (
      <section className="plt-panel">
        <div className="plt-panel__head">
          <h3 className="cat-head__title">المستأجرون والاشتراكات</h3>
        </div>
        {total > 0 ? (
          <div className="plt-dist" aria-hidden="true">
            {parts
              .filter((t) => t.value > 0)
              .map((t) => (
                <span
                  key={t.key}
                  className="plt-dist__part"
                  data-key={t.key}
                  style={{ flexGrow: t.value }}
                />
              ))}
          </div>
        ) : null}
        <div className="plt-legend">
          {d.subscriptions.map((t) => (
            <button
              key={t.key}
              type="button"
              className="plt-tile plt-legend__item"
              data-key={t.key}
              data-tone={t.tone}
              data-zero={t.value === 0 || undefined}
              onClick={() => router.push(t.href)}
            >
              <span className="plt-legend__top">
                <span className="plt-legend__dot" aria-hidden="true" />
                <span className="plt-tile__label">{t.label}</span>
              </span>
              <span className="plt-tile__value sting-mono">{t.value}</span>
              <span className="plt-tile__note">{t.note}</span>
            </button>
          ))}
        </div>
      </section>
    );
  };

  /** بطاقات الملخّص أعلى الصفحة. */
  const kpis = (d: Payload) => {
    const v = (key: string) => d.subscriptions.find((t) => t.key === key)?.value ?? 0;
    const items: { key: string; label: string; value: number; note: ReactNode; tone: Tone }[] = [
      {
        key: "tenants",
        label: "مستأجراً",
        value: d.tenants_total,
        note: (
          <>
            قِيس <span className="sting-mono">{hhmm(d.measured_at)}</span>
          </>
        ),
        tone: "info",
      },
      { key: "active", label: "نشط", value: v("active"), note: "اشتراك سارٍ", tone: "ok" },
      {
        key: "trial",
        label: "تجريبي",
        value: v("trial"),
        note: "في الفترة التجريبية",
        tone: "info",
      },
      {
        key: "attention",
        label: "يحتاج انتباهاً",
        value: d.attention,
        note: d.attention ? "في القوائم أدناه" : "لا شيء ينتظر",
        tone: d.attention ? "warn" : "ok",
      },
    ];
    return (
      <div className="plt-kpis">
        {items.map((k) => (
          <div key={k.key} className="plt-kpi" data-tone={k.tone}>
            <span className="plt-kpi__icon" aria-hidden="true">
              <Icon name={k.key} />
            </span>
            <span className="plt-kpi__label">{k.label}</span>
            <strong className="plt-kpi__value sting-mono">{k.value}</strong>
            <span className="plt-kpi__note">{k.note}</span>
          </div>
        ))}
      </div>
    );
  };

  /** بلا منشآت بعد: خطوات أول يوم بدل صفوف الأصفار. */
  const gettingStarted = () => {
    const registerUrl =
      typeof window === "undefined" ? "/register" : `${window.location.origin}/register`;
    const steps: { title: string; note: string; href: string }[] = [
      {
        title: "راجع الباقات والأسعار",
        note: "ما يراه التاجر قبل التسجيل — السعر والحدود لكل باقة.",
        href: "/platform/plans",
      },
      {
        title: "تابع طلبات الجولة",
        note: "من يطلب جولة من صفحة الهبوط يظهر هنا لتتواصل معه.",
        href: "/platform/demo-requests",
      },
      {
        title: "أضف زميلاً مشغّلاً",
        note: "مدير منصة أو «الدعم» — كلمة مؤقتة تُغيَّر عند أول دخول.",
        href: "/platform/operators",
      },
      {
        title: "راقب صحة الخدمة",
        note: "المزامنة والخادم والنسخ الليلية.",
        href: "/platform/health",
      },
    ];
    return (
      <section className="plt-start">
        <div className="plt-start__intro">
          <h3 className="plt-start__title">لا منشآت مسجَّلة بعد</h3>
          <p className="plt-start__lead">
            الخدمة تعمل وجاهزة. أول منشأة تسجّل من رابط التسجيل، وتظهر هنا عدّاداتها فور تسجيلها.
          </p>
          <div className="plt-start__link">
            <span className="sting-mono">{registerUrl}</span>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(registerUrl).then(() => setCopied(true));
              }}
            >
              {copied ? "نُسخ" : "انسخ رابط التسجيل"}
            </Button>
          </div>
        </div>
        <ol className="plt-start__steps">
          {steps.map((st) => (
            <li key={st.href}>
              <button type="button" onClick={() => router.push(st.href)}>
                <strong>{st.title}</strong>
                <span>{st.note}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    );
  };

  return (
    <PlatformFrame current="overview">
      <div className="sys plt-frame" data-screen="PLT-00" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">النظرة العامة — ما ينتظر فعلاً</h2>
            <span className="cat-head__hint">
              عدّادات من السجل بختم وقتها؛ كل بطاقة تفتح شاشتها. لا مبيعات ولا أسماء زبائن هنا.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب العدّادات">
                <p className="acc-lead">الاستحقاق والطوابير وصحة المزامنة — من السجل لا من كاش.</p>
              </Notice>
            ) : null}
            {denied ? (
              <Notice kind="warning" title="مساحة المشغّل فقط">
                <p className="acc-lead">
                  النظرة العامة تُقرأ بصفة مشغّل — لا دفاتر فيها ولا باب خلفي.
                </p>
              </Notice>
            ) : null}
            {data ? (
              <>
                <div className="plt-overview__head">
                  <Status
                    state={data.attention ? "stale" : "success"}
                    label={
                      data.attention ? (
                        <>
                          يحتاج انتباهاً · <span className="sting-mono">{data.attention}</span>
                        </>
                      ) : (
                        "لا شيء ينتظر"
                      )
                    }
                  />
                  <Button
                    variant="secondary"
                    loading={refreshing}
                    onClick={() => {
                      setRefreshing(true);
                      void load().finally(() => setRefreshing(false));
                    }}
                  >
                    حدّث
                  </Button>
                </div>
                {data.tenants_total === 0 ? gettingStarted() : null}
                {kpis(data)}
                {/* 0005 §١٣٥/§١٤١: ما ينتظر قراراً أولاً، ثم المستأجرون، والصحة جانباً على الواسعة */}
                <div className="plt-overview__grid">
                  <div className="plt-overview__main">
                    {list("ما ينتظر قراراً", data.queues, "لا شيء ينتظر قرارك")}
                    {tenants(data)}
                  </div>
                  <aside className="plt-overview__side">
                    {list("صحة النظام", data.technical, "كل المؤشرات سليمة")}
                  </aside>
                </div>
                <p className="acc-choice__note">{data.rule}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}

/** أيقونات خطّية صغيرة للبطاقات والصفوف — بلا مكتبة (0005 §١٤١). */
const ICONS: Record<string, string> = {
  tenants: "M3 21V8l9-5 9 5v13M9 21v-6h6v6",
  active: "M20 6 9 17l-5-5",
  trial: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  attention:
    "M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0",
  proofs: "M4 4h12l4 4v12H4zM8 12h8M8 16h5",
  verifications: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4",
  reports: "M5 21V4h11l-1.5 4L16 12H5",
  disputes: "M4 5h11v8H8l-4 3zM15 9h5v8l-3-2h-6v-2",
  demo: "M4 6h16v10H8l-4 4zM8 10h8M8 13h5",
  sync_stuck: "M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M18 4v5h-5M6 20v-5h5",
  health: "M3 12h4l3-7 4 14 3-7h4",
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d={ICONS[name] ?? "M12 12h.01"} />
    </svg>
  );
}
