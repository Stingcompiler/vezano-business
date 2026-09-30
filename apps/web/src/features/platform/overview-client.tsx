"use client";

import { Button, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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

  const tileButton = (t: Tile, variant: "row" | "stat") => (
    <button
      key={t.key}
      type="button"
      className={`plt-tile plt-tile--${variant}`}
      data-tone={t.tone}
      data-zero={t.value === 0 || undefined}
      onClick={() => router.push(t.href)}
    >
      <span className="plt-tile__label">{t.label}</span>
      <span className="plt-tile__value sting-mono">{t.value}</span>
      <span className="plt-tile__note">{t.note}</span>
    </button>
  );

  /** قائمة ما ينتظر: الأصفار باهتة في آخرها، وما يحتاجك أولاً بلونه. */
  const rows = (title: string, tiles: Tile[], allClear: string) => {
    const busy = tiles.filter((t) => t.value > 0);
    const idle = tiles.filter((t) => t.value === 0);
    return (
      <section className="plt-panel">
        <div className="plt-panel__head">
          <h3 className="cat-head__title">{title}</h3>
          {busy.length === 0 ? <Status state="success" label={allClear} /> : null}
        </div>
        <div className="plt-rows">{[...busy, ...idle].map((t) => tileButton(t, "row"))}</div>
      </section>
    );
  };

  /** توزيع المستأجرين بحالاتهم — شريط واحد بنسبه (يُخفى بلا مستأجرين). */
  const distribution = (d: Payload) => {
    const parts = d.subscriptions.filter((t) =>
      ["active", "trial", "late", "suspended"].includes(t.key),
    );
    const total = parts.reduce((a, t) => a + t.value, 0);
    if (total === 0) return null;
    return (
      <div className="plt-dist" aria-hidden="true">
        {parts
          .filter((t) => t.value > 0)
          .map((t) => (
            <span
              key={t.key}
              className="plt-dist__part"
              data-key={t.key}
              style={{ flexGrow: t.value }}
              title={`${t.label} ${t.value}`}
            />
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
                  <div>
                    <strong className="plt-overview__total">
                      <span className="sting-mono">{data.tenants_total}</span> مستأجراً
                    </strong>
                    <div className="cus-sub">
                      قِيس <span className="sting-mono">{hhmm(data.measured_at)}</span>
                    </div>
                  </div>
                  <div className="acc-actions plt-overview__tools">
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
                </div>
                {data.tenants_total === 0 ? gettingStarted() : null}
                {/* 0005 §١٣٥: ما ينتظر قراراً أولاً، ثم حال المستأجرين، ثم صحة النظام — بأسماء
                    مجموعات القائمة نفسها. الشاشات الواسعة: عمودان والصحة جانباً (§١٤٠) */}
                <div className="plt-overview__grid">
                  <div className="plt-overview__main">
                    {rows("ما ينتظر قراراً", data.queues, "لا شيء ينتظر قرارك")}
                    <section className="plt-panel">
                      <div className="plt-panel__head">
                        <h3 className="cat-head__title">المستأجرون والاشتراكات</h3>
                      </div>
                      {distribution(data)}
                      <div className="plt-stats">
                        {data.subscriptions.map((t) => tileButton(t, "stat"))}
                      </div>
                    </section>
                  </div>
                  <aside className="plt-overview__side">
                    {rows("صحة النظام", data.technical, "كل المؤشرات سليمة")}
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
