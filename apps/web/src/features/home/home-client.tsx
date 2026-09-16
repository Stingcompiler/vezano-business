"use client";

import {
  Button,
  formatMinor,
  Frame,
  Notice,
  PhaseLocked,
  SelectField,
  Status,
} from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useOnline } from "@/lib/online";

import { agoParts, hhmm } from "./format";
import { countLocalPending, readHomeCache, writeHomeCache } from "./home-cache";
import type { Attention, Decision, HomeSummary, Kpi } from "./types";

type OwnerState = "loading" | "ready" | "empty" | "stale" | "offline" | "pending_sync";
type EmployeeState = "ready" | "empty" | "permission_denied" | "offline" | "stale";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "صباح الخير" : "مساء الخير";
}

function KpiCard({ k, pending }: { k: Kpi; pending: boolean }) {
  const ago = agoParts(k.as_of);
  return (
    <Link href={k.href} className="home-kpi">
      <div className="home-kpi__label">{k.label}</div>
      <div className="home-kpi__value sting-mono">
        {k.value.kind === "money" ? formatMinor(k.value.amount_minor, k.value.exponent) : k.value.n}
      </div>
      <div className="home-kpi__scope">{k.scope}</div>
      <div className="home-kpi__scope">
        محدّث قبل <span className="sting-mono">{ago.n}</span>{" "}
        {ago.unit === "minute" ? "دقيقة" : ago.unit === "hour" ? "ساعة" : "يوم"}
      </div>
      {k.note ? (
        <span className={`acc-tag home-kpi__note home-kpi__note--${k.note_kind}`}>{k.note}</span>
      ) : null}
      {pending && k.includes_pending ? (
        <span className="acc-tag home-kpi__note home-kpi__note--info">يشمل معلّقاً</span>
      ) : null}
    </Link>
  );
}

function DecisionRow({ d }: { d: Decision }) {
  return (
    <div className="home-row">
      <span className={`home-dot home-dot--${d.severity}`} aria-hidden="true" />
      <div className="home-row__body">
        <div className="home-row__title">{d.title}</div>
        <div className="acc-choice__note">{d.detail}</div>
      </div>
      <Link href={d.href} className="c-btn c-btn--quiet">
        {d.action}
      </Link>
    </div>
  );
}

function AttentionRow({ a }: { a: Attention }) {
  return (
    <div className="home-row">
      <div className="home-row__body">
        <div className="home-row__title">
          {a.title_count !== undefined ? (
            <>
              <span className="sting-mono">{a.title_count}</span>{" "}
            </>
          ) : null}
          {a.title}
          {a.minutes !== undefined ? (
            <>
              {" "}
              <span className="sting-mono">{a.minutes}</span> دقيقة
            </>
          ) : null}
        </div>
        <div className="acc-choice__note">{a.detail}</div>
      </div>
      <Link href={a.href} className="c-btn c-btn--secondary">
        {a.action}
      </Link>
    </div>
  );
}

/**
 * HOME-01 رئيسية المالك (37-D29 ready/loading/empty/offline/pending_sync · 06-D2 stale) و
 * HOME-02 رئيسية الموظف (06-D2 ready · 37-D29 empty/permission_denied/offline/stale).
 * «يحتاج قرارك» فوق الأرقام؛ كل رقم يفتح على مصدره ويحمل وقته (R-01)؛ المحجوب لا يُعرض.
 */
export function HomeClient() {
  const router = useRouter();
  const online = useOnline();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(0);
  const [period, setPeriod] = useState("today");
  const [branch, setBranch] = useState("");

  const load = useCallback(async () => {
    setFailed(false);
    const cache = await readHomeCache();
    if (!navigator.onLine) {
      if (cache) {
        setSummary(cache.summary);
        setSavedAt(cache.savedAt);
      }
      return;
    }
    try {
      const { data, response } = await api().GET("/api/home", {
        params: { query: { period, branch_id: branch } },
      });
      if (response.ok && data) {
        const s = data as unknown as HomeSummary;
        setSummary(s);
        setSavedAt(null);
        await writeHomeCache(s);
        return;
      }
      throw new Error("home_failed");
    } catch {
      if (cache) {
        setSummary(cache.summary);
        setSavedAt(cache.savedAt);
      }
      setFailed(true);
    }
  }, [branch, period]);

  useEffect(() => {
    void load();
    void countLocalPending().then(setPending);
  }, [load, online]);

  if (!summary) {
    return (
      <Frame title="Sting" nav={<AppNav currentId="home" />} footer={null}>
        <div className="home" data-screen="HOME-01" data-state="loading">
          <p className="acc-card__sub" role="status">
            جارٍ الجمع
          </p>
          <div className="home-decisions" aria-hidden="true">
            <div className="acc-skeleton" />
          </div>
          <div className="home-kpis" aria-hidden="true">
            <div className="acc-skeleton" />
            <div className="acc-skeleton" />
            <div className="acc-skeleton" />
          </div>
        </div>
      </Frame>
    );
  }

  const isOwner = summary.kind === "owner";
  const hasNumbers =
    summary.kpis.length > 0 || summary.decisions.length > 0 || summary.attention.length > 0;
  const ownerState: OwnerState = !online
    ? "offline"
    : pending > 0
      ? "pending_sync"
      : failed && savedAt
        ? "stale"
        : !hasNumbers
          ? "empty"
          : "ready";
  const employeeState: EmployeeState = !online
    ? "offline"
    : summary.quick_actions.length === 0
      ? "permission_denied"
      : failed && savedAt
        ? "stale"
        : summary.tasks.length === 0 && pending === 0
          ? "empty"
          : "ready";
  const screen = isOwner ? "HOME-01" : "HOME-02";
  const state = isOwner ? ownerState : employeeState;
  const coverage = savedAt ?? summary.coverage_at;

  const bar = !online ? (
    <Status state="offline" label="بلا اتصال" />
  ) : isOwner && pending > 0 ? (
    <Status
      state="pending_sync"
      label={
        <>
          عمليات لم تُرفع — على هذا الجهاز <span className="sting-mono">{pending}</span> عمليات
          معلّقة
        </>
      }
    />
  ) : failed && savedAt ? (
    <Status state="stale" label="أرقام قديمة" />
  ) : undefined;

  return (
    <Frame title={summary.tenant_name} nav={<AppNav currentId="home" />} footer={null} notice={bar}>
      <div className="home" data-screen={screen} data-state={state}>
        {isOwner ? (
          <>
            <header className="home-head">
              <div>
                <h2 className="acc-card__title" style={{ fontSize: 18 }}>
                  {greeting()} — {summary.tenant_name}
                </h2>
                <p className="acc-card__sub" style={{ color: "var(--color-ink-muted)" }}>
                  {summary.user.display_name} — {summary.user.role_name} · كل الفروع
                </p>
              </div>
              <div className="home-head__meta">
                <span>
                  <span className="sting-mono">{summary.branches.length}</span> فروع ·{" "}
                  {summary.branches_synced ? "كلها زامنت" : "بعضها لم يزامن"}
                </span>
                <SelectField
                  label="الفترة"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  options={[
                    { value: "today", label: "اليوم" },
                    { value: "7d", label: "آخر 7 أيام" },
                    { value: "month", label: "هذا الشهر" },
                  ]}
                />
                <SelectField
                  label="الفرع"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  options={[
                    { value: "", label: "كل الفروع" },
                    ...summary.branches.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                />
              </div>
            </header>

            {state === "empty" ? (
              <Notice
                kind="empty"
                title="يومٌ لم يبدأ"
                action={<Button onClick={() => router.push("/shifts/open")}>افتح وردية</Button>}
              >
                <p className="acc-lead">لم يبدأ البيع بعد</p>
              </Notice>
            ) : (
              <>
                {summary.decisions.length > 0 ? (
                  <section className="home-decisions" aria-label="يحتاج قرارك">
                    <div className="home-decisions__head">
                      يحتاج قرارك — <span className="sting-mono">{summary.decisions_count}</span>
                    </div>
                    {summary.decisions.map((d) => (
                      <DecisionRow key={d.id} d={d} />
                    ))}
                  </section>
                ) : null}
                <div className="home-kpis">
                  {summary.kpis.map((k) => (
                    <KpiCard key={k.key} k={k} pending={pending > 0} />
                  ))}
                </div>
                <div className="home-columns">
                  {summary.attention.length > 0 ? (
                    <section className="home-attention" aria-label="يحتاج انتباهك">
                      <div className="home-decisions__head home-decisions__head--plain">
                        يحتاج انتباهك
                      </div>
                      {summary.attention.map((a) => (
                        <AttentionRow key={a.id} a={a} />
                      ))}
                    </section>
                  ) : null}
                  {summary.margin_locked ? (
                    <PhaseLocked
                      kind="conditional"
                      explanation="يتطلب سياسة تكلفة معتمدة. لن نعرض رقم ربح مبنياً على تخمين — الإيراد والمرتجعات والذمم أعلاه دقيقة ومستقلة عنه."
                    >
                      <div className="acc-item">
                        <div className="acc-item__label">الهامش وصافي الربح</div>
                        <div className="acc-links" style={{ marginBlockStart: 8 }}>
                          <Button variant="secondary">ما الذي تحتاجه سياسة التكلفة</Button>
                        </div>
                      </div>
                    </PhaseLocked>
                  ) : null}
                </div>
              </>
            )}

            <footer className="home-coverage">
              كل الأرقام حتى تغطية الخادم <span className="sting-mono">{hhmm(coverage)}</span>
              {pending > 0 ? "، وتشمل عمليات هذا الجهاز المعلقة" : ""}. أجهزة الفروع الأخرى قد تحمل
              عمليات لم تصل بعد.
            </footer>
          </>
        ) : (
          <>
            <header className="home-head">
              <div>
                <h2 className="acc-card__title" style={{ fontSize: 18 }}>
                  {greeting()}، {summary.user.display_name}
                </h2>
                <p className="acc-card__sub" style={{ color: "var(--color-ink-muted)" }}>
                  {summary.user.role_name} · {summary.user.branch_name}
                  {summary.user.device_name ? <> · {summary.user.device_name}</> : null}
                </p>
              </div>
              {summary.shift ? (
                <span className="home-shift">
                  وردية مفتوحة منذ{" "}
                  <span className="sting-mono">{hhmm(summary.shift.open_since)}</span>
                </span>
              ) : null}
            </header>

            {summary.quick_actions.length > 0 ? (
              <div className="home-actions">
                {summary.quick_actions.includes("sale") ? (
                  <Link href="/pos" className="home-action home-action--primary">
                    {state === "empty" ? "افتح نقطة البيع" : "بيع جديد"}
                  </Link>
                ) : null}
                {summary.quick_actions.includes("payment") ? (
                  <Link href="/parties/payment" className="home-action">
                    تسجيل سداد
                  </Link>
                ) : null}
                {summary.quick_actions.includes("return") ? (
                  <Link href="/pos/return" className="home-action">
                    مرتجع
                  </Link>
                ) : null}
              </div>
            ) : null}

            <div className="home-columns">
              <section className="home-attention" aria-label="مهامك اليوم">
                <div className="home-decisions__head home-decisions__head--plain">مهامك اليوم</div>
                {state === "empty" ? (
                  <div className="home-row">
                    <div className="home-row__body">
                      <div className="home-row__title">لا مهام اليوم</div>
                      <div className="acc-choice__note">الوردية مفتوحة ولا شيء ينتظره.</div>
                    </div>
                  </div>
                ) : null}
                {pending > 0 ? (
                  <div className="home-row">
                    <div className="home-row__body">
                      <span className="sting-mono">{pending}</span> عمليات معلقة تنتظر عودة الاتصال
                    </div>
                  </div>
                ) : null}
                {summary.tasks.map((t) => (
                  <div key={t.id} className="home-row">
                    <div className="home-row__body">{t.title}</div>
                    <Link href={t.href} className="c-btn c-btn--quiet">
                      افتح
                    </Link>
                  </div>
                ))}
              </section>
              {!summary.can_see_finance ? (
                <div className="acc-item acc-item--violet">
                  <span
                    className="acc-tag"
                    style={{
                      background: "var(--color-violet-800)",
                      color: "var(--color-violet-50)",
                    }}
                  >
                    خارج صلاحيتك
                  </span>
                  <div className="acc-item__note" style={{ marginBlockStart: 8 }}>
                    التقارير المالية وأرصدة كل العملاء والتكلفة والهامش لا تظهر لدور{" "}
                    {summary.user.role_name}. هذا ليس عطلاً — اطلب التوسيع من المالك إن احتجته.
                  </div>
                </div>
              ) : null}
            </div>
            {failed && savedAt ? (
              <footer className="home-coverage">
                الأرقام من آخر مطابقة <span className="sting-mono">{hhmm(savedAt)}</span>
              </footer>
            ) : null}
          </>
        )}
      </div>
    </Frame>
  );
}
