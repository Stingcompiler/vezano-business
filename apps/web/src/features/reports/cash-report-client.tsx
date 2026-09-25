"use client";

import { Button, formatMinor, Frame, Notice, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./reports.css";
import { AppNav } from "@/features/home/app-nav";
import { dayMonth, hhmm } from "@/features/home/format";
import { Ago } from "@/features/org/ago";
import { api, apiBaseUrl, getAccessToken } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "conflict" | "stale";
type RangeKey = "today" | "yesterday" | "7d" | "30d";

interface Conflict {
  quarantine_id: string;
  device_name: string;
  counted_by_name: string;
  counted_cash_minor: string;
  expected_cash_at_close_minor: string;
  occurred_at: string;
  received_at: string;
}

interface Row {
  id: string;
  branch_name: string;
  device_name: string;
  user_name: string;
  opened_at: string;
  closed_at: string;
  count_status: string;
  expected_cash_at_close_minor: string;
  counted_cash_minor: string;
  counted_by_name: string;
  witness_name: string;
  variance_minor: string;
  reviewed: boolean;
  reviewed_by_name: string;
  conflict: Conflict | null;
}

interface Payload {
  scope: "all" | "branch";
  branch_name: string;
  can_all_branches: boolean;
  range: { key: string; start: string; end: string; label: string };
  rows: Row[];
  totals: {
    shifts: number;
    counted: number;
    not_counted: number;
    variance_minor: string;
    over_minor: string;
    short_minor: string;
    unreviewed_variances: number;
    excluded_conflicts: number;
  };
  open_shifts: {
    id: string;
    branch_name: string;
    user_name: string;
    opened_at: string;
    open_hours: number;
    abandoned: boolean;
  }[];
  completeness: {
    devices_total: number;
    devices_synced: number;
    pending_ops: number;
    not_synced: {
      device_name: string;
      branch_name: string;
      last_seen_at: string;
      pending: number;
    }[];
    complete: boolean;
  };
  branches: { id: string; name: string }[];
  computed_at: string;
  last_closed_date: string;
}

const CACHE = "rep.cash_cache";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`pos-chip${on ? " pos-chip--on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function When({ iso }: { iso: string }) {
  if (!iso) return <span>—</span>;
  const { day, month } = dayMonth(iso);
  return (
    <span>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </span>
  );
}

const signed = (minor: string) => {
  const v = BigInt(minor);
  return v > 0n ? `+${formatMinor(v)}` : formatMinor(v);
};

/**
 * REP-04 — تقرير الصندوق والورديات (36-D28 ready/loading/empty/conflict · 16-D11 stale): النقد
 * المتوقَّع مقابل المعدود عبر الورديات المغلقة وحدها — لكل وردية المتوقَّع والمعدود والفارق ومن عدّ،
 * والفوارق مجموعةٌ في الأعلى. حالته الفريدة `conflict`: وردية أُقفلت على جهازين بمبلغين — لا نجمع
 * ولا نرجّح، النسختان تُعرضان ويُحال إلى SYS-03 ويُستثنى الصفّ من المجموع ويُقال ذلك (SHIFT-05؛
 * §١٠.٣، §٧.٧). يطابق SHIFT-02/05.
 */
export function CashReportClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [range, setRange] = useState<RangeKey>("7d");
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [cached, setCached] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const fetchServer = useCallback(async () => {
    setFetching(true);
    setFailed(false);
    try {
      const query: Record<string, string> = { range };
      if (branch) query.branch_id = branch;
      const { data, response } = await api().GET("/api/reports/cash", { params: { query } });
      if (response.status === 403) {
        // لا حالة permission_denied مرسومة لـREP-04: الكاشير يعود إلى ورديته (SHIFT-02)
        router.replace("/shifts/current");
        return;
      }
      const body = data as unknown as Payload | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setData(body);
      await getStorage().transaction((tx) => tx.putMeta(CACHE, JSON.stringify(body)));
    } catch {
      setFailed(true);
    } finally {
      setFetching(false);
    }
  }, [range, branch, router]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Freports%2Fcash");
      return;
    }
    void getStorage()
      .read((tx) => tx.getMeta(CACHE))
      .then((raw) => {
        if (raw) setCached(JSON.parse(raw) as Payload);
      })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (!online) return;
    void fetchServer();
  }, [fetchServer, online]);

  const p = data ?? cached;
  const state: State = (() => {
    if ((!online || failed || (p && !p.completeness.complete)) && p) return "stale";
    if (!p || (fetching && data === null)) return "loading";
    if (p.totals.excluded_conflicts > 0) return "conflict";
    if (p.rows.length === 0) return "empty";
    return "ready";
  })();

  const exportCsv = async () => {
    if (!p) return;
    const q = new URLSearchParams({ export: "csv", range: p.range.key });
    if (branch) q.set("branch_id", branch);
    const r = await fetch(`${apiBaseUrl()}/api/reports/cash?${q.toString()}`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cash-${p.range.start}-${p.range.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const conflicts = p ? p.rows.filter((r) => r.conflict) : [];

  return (
    <Frame title="التقارير" nav={<AppNav currentId="reports-cash" />} footer={null}>
      <div className="sys rep" data-screen="REP-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تقرير الصندوق والورديات</h2>
            <span className="cat-head__hint">
              النقد المتوقَّع مقابل المعدود عبر الورديات. حالته الفريدة: تعارضٌ في تقرير.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__filters">
              <div className="pos-chips" role="group" aria-label="المدى">
                <Chip on={range === "today"} onClick={() => setRange("today")}>
                  اليوم
                </Chip>
                <Chip on={range === "yesterday"} onClick={() => setRange("yesterday")}>
                  أمس
                </Chip>
                <Chip on={range === "7d"} onClick={() => setRange("7d")}>
                  ورديات الأسبوع
                </Chip>
                <Chip on={range === "30d"} onClick={() => setRange("30d")}>
                  آخر 30 يوماً
                </Chip>
              </div>
              {p?.branches.length ? (
                <div className="pos-chips" role="group" aria-label="الفرع">
                  <Chip on={!branch} onClick={() => setBranch("")}>
                    كل الفروع
                  </Chip>
                  {p.branches.map((b) => (
                    <Chip key={b.id} on={branch === b.id} onClick={() => setBranch(b.id)}>
                      {b.name}
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>

            {state === "loading" ? (
              <Notice kind="info" title="جارٍ التجميع">
                <p className="acc-lead">
                  يُجمع من ورديات مغلقة وحدها. المفتوحة لا تدخل — وردية بلا عدّ ليس لها فارق.
                </p>
              </Notice>
            ) : null}
            {state === "stale" && p ? (
              <Notice kind="warning" title="ناقص معلوم">
                {!online || failed ? (
                  <p className="acc-lead">
                    الأرقام من آخر مطابقة — حُسب في{" "}
                    <span className="sting-mono">{hhmm(p.computed_at)}</span>. طبعه الآن يعني طبع
                    رقم ناقص تعرف مقداره.
                  </p>
                ) : null}
                {p.completeness.pending_ops > 0 ? (
                  <p className="acc-lead">
                    هذا التقرير لا يشمل{" "}
                    <span className="sting-mono">{p.completeness.pending_ops}</span> عمليات معلّقة
                    من{" "}
                    {p.completeness.not_synced
                      .filter((d) => d.pending > 0)
                      .map((d) => d.device_name)
                      .join(" و")}
                    . حُسب في <span className="sting-mono">{hhmm(p.computed_at)}</span>. طبعه الآن
                    يعني طبع رقم ناقص تعرف مقداره.
                  </p>
                ) : null}
                <p className="acc-choice__note">
                  الملف المصدَّر يحمل في ترويسته سطر الاكتمال نفسه — لا تفقده الورقة حين تخرج من
                  الشاشة.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && p ? (
              <Notice kind="empty" title="لا ورديات مغلقة">
                <p className="acc-lead">الورديات مفتوحة أو لم تبدأ بعد.</p>
                {p.open_shifts.length ? (
                  <p className="acc-lead">
                    <strong>المخرج</strong> ·{" "}
                    {p.open_shifts.map((o) => (
                      <span key={o.id}>
                        وردية {o.user_name} — {o.branch_name} مفتوحة منذ <Ago iso={o.opened_at} />
                        {o.abandoned ? " — إقفال مهجور" : ""}.{" "}
                      </span>
                    ))}
                  </p>
                ) : null}
              </Notice>
            ) : null}
            {state === "conflict" && p ? (
              <Notice kind="warning" title="وردية بعدّين مختلفين">
                <p className="acc-lead">
                  وردية أُقفلت على جهازين بمبلغين مختلفين — عُدّت مرتين والنسختان في الدفتر.
                </p>
                <p className="acc-lead">
                  <strong>لا نجمع ولا نرجّح</strong> · لا نأخذ المتوسط ولا الأحدث. تُعرض النسختان
                  باسم من عدّ ووقته، وتُحال إلى «مراجعة التعارضات».
                </p>
                <p className="acc-lead">
                  <strong>الصفّ يُستثنى من المجموع</strong> ·{" "}
                  {p.totals.excluded_conflicts === 1
                    ? "«وردية واحدة خارج المجموع — بانتظار الحسم»"
                    : `${p.totals.excluded_conflicts} ورديات خارج المجموع — بانتظار الحسم`}
                  . مجموعٌ يبتلع تعارضاً يُخفيه.
                </p>
                <ul className="acc-choice__note">
                  {conflicts.map((r) => (
                    <li key={r.id}>
                      {r.user_name} — {r.branch_name}: النسخة الأولى{" "}
                      <span className="sting-mono">{formatMinor(r.counted_cash_minor || "0")}</span>{" "}
                      عدّها {r.counted_by_name || r.user_name} على {r.device_name} في{" "}
                      <span className="sting-mono">{hhmm(r.closed_at)}</span> · النسخة الثانية{" "}
                      <span className="sting-mono">
                        {formatMinor(r.conflict!.counted_cash_minor || "0")}
                      </span>{" "}
                      عدّها {r.conflict!.counted_by_name || "—"} على{" "}
                      {r.conflict!.device_name || "جهاز آخر"} في{" "}
                      <span className="sting-mono">{hhmm(r.conflict!.occurred_at)}</span>
                    </li>
                  ))}
                </ul>
                <div className="cat-form__actions">
                  <Button onClick={() => router.push("/sync/review")}>
                    الحسم في مراجعة التعارضات
                  </Button>
                </div>
              </Notice>
            ) : null}

            {p && state !== "empty" ? (
              <>
                <section className="rep-head" aria-label="الفوارق">
                  <h3 className="cat-head__title">ورديات الأسبوع — {p.range.label}</h3>
                  <p className="acc-choice__note">
                    لكل وردية: المتوقَّع والمعدود والفارق ومن عدّ. والفوارق مجموعةٌ في الأعلى لأنها
                    سبب فتح التقرير.
                  </p>
                  <div className="home-kpis rep-kpis">
                    <div className="home-kpi">
                      <div className="home-kpi__label">صافي الفوارق</div>
                      <div className="home-kpi__value sting-mono">
                        {signed(p.totals.variance_minor)}
                      </div>
                      <div className="home-kpi__scope">
                        من <span className="sting-mono">{p.totals.counted}</span> وردية معدودة
                        {p.totals.excluded_conflicts > 0 ? (
                          <>
                            {" "}
                            · <span className="sting-mono">{p.totals.excluded_conflicts}</span> خارج
                            المجموع
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="home-kpi">
                      <div className="home-kpi__label">عجز</div>
                      <div className="home-kpi__value sting-mono">
                        {formatMinor(p.totals.short_minor)}
                      </div>
                      <div className="home-kpi__scope">
                        <span className="sting-mono">{p.totals.unreviewed_variances}</span> فرق لم
                        يُراجَع
                      </div>
                    </div>
                    <div className="home-kpi">
                      <div className="home-kpi__label">زيادة</div>
                      <div className="home-kpi__value sting-mono">
                        {formatMinor(p.totals.over_minor)}
                      </div>
                      <div className="home-kpi__scope">
                        <span className="sting-mono">{p.totals.not_counted}</span> بلا عدّ
                      </div>
                    </div>
                  </div>
                  <p className="acc-choice__note">
                    <span className="sting-mono">{p.completeness.devices_synced}</span> أجهزة من{" "}
                    <span className="sting-mono">{p.completeness.devices_total}</span> زامنت · حُسب
                    في <span className="sting-mono">{hhmm(p.computed_at)}</span>
                  </p>
                </section>

                <Table
                  caption="الورديات المغلقة"
                  columns={[
                    {
                      key: "shift",
                      header: "الوردية",
                      render: (r) => (
                        <div>
                          <div>
                            {r.user_name} — {r.branch_name}
                          </div>
                          <div className="acc-choice__note">
                            <When iso={r.closed_at} /> · {r.device_name}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "expected",
                      header: "المتوقَّع",
                      mono: true,
                      render: (r) =>
                        r.expected_cash_at_close_minor
                          ? formatMinor(r.expected_cash_at_close_minor)
                          : "—",
                    },
                    {
                      key: "counted",
                      header: "المعدود",
                      mono: true,
                      render: (r) =>
                        r.counted_cash_minor ? formatMinor(r.counted_cash_minor) : "—",
                    },
                    {
                      key: "variance",
                      header: "الفارق",
                      render: (r) =>
                        r.conflict ? (
                          <span>خارج المجموع — بانتظار الحسم</span>
                        ) : r.variance_minor ? (
                          <span
                            className={`sting-mono${r.variance_minor.startsWith("-") ? " inv-qty--neg" : ""}`}
                          >
                            {signed(r.variance_minor)}
                          </span>
                        ) : (
                          <span>بلا عدّ</span>
                        ),
                    },
                    {
                      key: "by",
                      header: "من عدّ",
                      render: (r) => (
                        <div>
                          <div>{r.counted_by_name || "—"}</div>
                          {r.witness_name ? (
                            <div className="acc-choice__note">شاهد: {r.witness_name}</div>
                          ) : null}
                          {r.reviewed ? (
                            <div className="acc-choice__note">
                              رُوجع بواسطة {r.reviewed_by_name}
                            </div>
                          ) : null}
                        </div>
                      ),
                    },
                  ]}
                  rows={p.rows}
                  rowKey={(r) => r.id}
                  onOpenRow={() => router.push("/shifts/review")}
                />
                <div className="cat-form__actions">
                  <Button onClick={() => void exportCsv()}>تصدير مع ختم الاكتمال</Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
