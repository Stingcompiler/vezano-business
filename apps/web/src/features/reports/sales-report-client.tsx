"use client";

import { readSales } from "@sting/sync-core";
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
import { pushPending } from "@/lib/sync";

type State = "ready" | "loading" | "empty" | "stale" | "pending_sync" | "permission_denied";
type RangeKey = "today" | "yesterday" | "7d" | "30d" | "custom";
type Method = "all" | "cash" | "credit" | "bank";

interface Payload {
  scope: "all" | "branch";
  branch_name: string;
  can_all_branches: boolean;
  range: { key: string; start: string; end: string; label: string };
  method: Method;
  totals: {
    revenue_minor: string;
    returns_minor: string;
    net_minor: string;
    invoices: number;
    returns_count: number;
    cash_minor: string;
    credit_minor: string;
    bank_minor: string;
    average_minor: string;
  };
  by_branch: {
    id: string;
    name: string;
    revenue_minor: string;
    returns_minor: string;
    invoices: number;
    last_sync_at: string;
    pending: number;
    complete: boolean;
  }[];
  by_day: {
    date: string;
    invoices: number;
    cash_minor: string;
    credit_minor: string;
    bank_minor: string;
    revenue_minor: string;
    returns_minor: string;
    net_minor: string;
  }[];
  completeness: {
    devices_total: number;
    devices_synced: number;
    pending_ops: number;
    not_synced: {
      device_name: string;
      branch_id: string;
      branch_name: string;
      last_seen_at: string;
      pending: number;
    }[];
    complete: boolean;
  };
  branches: { id: string; name: string }[];
  computed_at: string;
  last_sale_date: string;
  cost_columns: "phase_locked";
}

interface LocalPending {
  count: number;
  totalMinor: bigint;
}

const CACHE = "rep.sales_cache";

/** معلّق هذا الجهاز في المدى: يُضاف إلى الأرقام موسوماً — الخادم لا يراه بعد. */
async function localPendingIn(start: string, end: string): Promise<LocalPending> {
  try {
    const storage = getStorage();
    const sales = await readSales(storage);
    let count = 0;
    let total = 0n;
    for (const s of sales) {
      const d = s.business_date.slice(0, 10);
      if (d < start || d > end) continue;
      const op = await storage.read((tx) => tx.getOperation(s.operation_id));
      const st = op?.state ?? "local";
      if (st !== "local" && st !== "pending") continue;
      count += 1;
      total += BigInt(s.total_minor);
    }
    return { count, totalMinor: total };
  } catch {
    return { count: 0, totalMinor: 0n };
  }
}

function Chip({
  on,
  onClick,
  children,
  restricted,
}: {
  on: boolean;
  onClick: () => void;
  children: string;
  restricted?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pos-chip${on ? " pos-chip--on" : ""}${restricted ? " pos-chip--restricted" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DayCell({ iso }: { iso: string }) {
  const { day, month } = dayMonth(iso);
  return (
    <span>
      <span className="sting-mono">{day}</span> {month}
    </span>
  );
}

/**
 * REP-01 — تقرير المبيعات — الرقم ومعه وقته (36-D28 ready/loading/empty/stale/permission_denied ·
 * 16-D11 pending_sync · 47-D38 الديسكتوب): «مبيعات اليوم» رقمٌ مع بيانِ ما دخل فيه وما لم يدخل
 * بعد — سطر الاكتمال في رأس التقرير لا حاشية؛ معلّق هذا الجهاز يُضاف موسوماً؛ لا عمود تكلفة ولا
 * هامش (G-03 — `phase_locked` حتى تُعتمد)؛ مدير الفرع يرى فرعه ولا يرى المقارنة (§٧.٦، §١٤.١؛
 * ACC-79). الأرقام تطابق HOME-01 لنفس المدى.
 */
export function SalesReportClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [range, setRange] = useState<RangeKey>("today");
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [branch, setBranch] = useState<string>("");
  const [allBranches, setAllBranches] = useState(true);
  const [method, setMethod] = useState<Method>("all");
  const [data, setData] = useState<Payload | null>(null);
  const [cached, setCached] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [denied, setDenied] = useState<"role" | "compare" | null>(null);
  const [roleName, setRoleName] = useState("");
  const [local, setLocal] = useState<LocalPending>({ count: 0, totalMinor: 0n });
  const [syncing, setSyncing] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const fetchServer = useCallback(async () => {
    setFetching(true);
    setFailed(false);
    try {
      const query: Record<string, string> = { range, method };
      if (range === "custom" && custom) {
        query.start = custom.start;
        query.end = custom.end;
      }
      if (branch && allBranches === false) query.branch_id = branch;
      const { data, error, response } = await api().GET("/api/reports/sales", {
        params: { query },
      });
      if (response.status === 403) {
        const e = error as unknown as { role_name?: string } | undefined;
        setRoleName(e?.role_name ?? "");
        setDenied("role");
        return;
      }
      const body = data as unknown as Payload | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setData(body);
      setLocal(await localPendingIn(body.range.start, body.range.end));
      await getStorage().transaction((tx) => tx.putMeta(CACHE, JSON.stringify(body)));
    } catch {
      setFailed(true);
    } finally {
      setFetching(false);
    }
  }, [range, custom, branch, allBranches, method]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Freports");
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
  const otherPending = p ? p.completeness.pending_ops : 0;
  const incomplete = p ? !p.completeness.complete : false;

  const state: State = denied
    ? "permission_denied"
    : (!online || failed) && p
      ? "stale"
      : !p || (fetching && data === null)
        ? "loading"
        : incomplete || local.count > 0
          ? "pending_sync"
          : p.totals.invoices === 0
            ? "empty"
            : "ready";

  const exportCsv = async () => {
    if (!p) return;
    const q = new URLSearchParams({ export: "csv", range: p.range.key, method });
    if (p.range.key === "custom") {
      q.set("start", p.range.start);
      q.set("end", p.range.end);
    }
    if (branch && !allBranches) q.set("branch_id", branch);
    const r = await fetch(`${apiBaseUrl()}/api/reports/sales?${q.toString()}`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-${p.range.start}-${p.range.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const syncThenRecompute = async () => {
    setSyncing(true);
    try {
      await pushPending(10, { manual: true });
    } catch {
      /* المزامنة تُبلغ في SYS-01 — هنا نعيد الحساب بما وصل */
    } finally {
      setSyncing(false);
      await fetchServer();
    }
  };

  const revenue = p ? BigInt(p.totals.revenue_minor) + local.totalMinor : 0n;
  const invoices = p ? p.totals.invoices + local.count : 0;
  const branchesSynced = p ? p.by_branch.filter((b) => b.complete).length : 0;
  const branchChips = p?.branches ?? [];
  const canCompare = p?.can_all_branches ?? false;

  return (
    <Frame title="التقارير" nav={<AppNav currentId="reports" />} footer={null}>
      <div className="sys rep" data-screen="REP-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تقرير المبيعات — الرقم ومعه وقته</h2>
            <span className="cat-head__hint">
              في نظامٍ تعمل أجهزته بلا اتصال، «مبيعات اليوم» ليست رقماً واحداً بل رقمٌ مع بيانِ ما
              دخل فيه وما لم يدخل بعد.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__filters">
              <div className="pos-chips" role="group" aria-label="الفترة">
                <Chip on={range === "today"} onClick={() => setRange("today")}>
                  اليوم
                </Chip>
                <Chip on={range === "yesterday"} onClick={() => setRange("yesterday")}>
                  أمس
                </Chip>
                <Chip on={range === "7d"} onClick={() => setRange("7d")}>
                  آخر 7 أيام
                </Chip>
                <Chip on={range === "30d"} onClick={() => setRange("30d")}>
                  آخر 30 يوماً
                </Chip>
                {range === "custom" && custom ? (
                  <Chip on onClick={() => undefined}>
                    {custom.start === custom.end ? custom.start : `${custom.start} – ${custom.end}`}
                  </Chip>
                ) : null}
              </div>
              <div className="pos-chips" role="group" aria-label="الفرع">
                <Chip
                  on={allBranches && denied !== "compare"}
                  restricted={!canCompare}
                  onClick={() => {
                    if (canCompare) {
                      setDenied(null);
                      setAllBranches(true);
                      setBranch("");
                    } else setDenied("compare");
                  }}
                >
                  كل الفروع
                </Chip>
                {canCompare
                  ? branchChips.map((b) => (
                      <Chip
                        key={b.id}
                        on={!allBranches && branch === b.id}
                        onClick={() => {
                          setDenied(null);
                          setAllBranches(false);
                          setBranch(b.id);
                        }}
                      >
                        {b.name}
                      </Chip>
                    ))
                  : p?.branch_name
                    ? [
                        <Chip key="mine" on={denied !== "compare"} onClick={() => setDenied(null)}>
                          {p.branch_name}
                        </Chip>,
                      ]
                    : null}
              </div>
              <div className="pos-chips" role="group" aria-label="وسيلة الدفع">
                <Chip on={method === "all"} onClick={() => setMethod("all")}>
                  كل وسائل الدفع
                </Chip>
                <Chip on={method === "cash"} onClick={() => setMethod("cash")}>
                  نقد
                </Chip>
                <Chip on={method === "credit"} onClick={() => setMethod("credit")}>
                  آجل
                </Chip>
                <Chip on={method === "bank"} onClick={() => setMethod("bank")}>
                  تحويل
                </Chip>
              </div>
            </div>

            {state === "permission_denied" ? (
              <Notice kind="locked" title="مدير الفرع يرى فرعه">
                <p className="acc-lead">
                  يرى أرقام فرعه كاملةً ولا يرى الفروع الأخرى ولا المقارنة بينها.
                </p>
                <p className="acc-lead">
                  <strong>لا نُخفي وجودها</strong> ·{" "}
                  {denied === "role"
                    ? `التقرير للمالك ومدير الفرع — ${roleName || "هذا الدور"} يرى نطاقه في قائمة الفواتير.`
                    : `«تُعرض أرقام ${p?.branch_name || "فرعك"} — المقارنة بين الفروع للمالك». معرفةُ أن ثمّة أكثر ليست إفشاءً.`}
                </p>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="جارٍ الحساب">
                <p className="acc-lead">
                  مع اسم المدى وعدد الفروع. التقرير يُحسب لا يُقرأ جاهزاً —{" "}
                  {range === "today"
                    ? "اليوم"
                    : range === "yesterday"
                      ? "أمس"
                      : range === "7d"
                        ? "آخر 7 أيام"
                        : range === "30d"
                          ? "آخر 30 يوماً"
                          : "مدى مخصَّص"}
                  {branchChips.length ? (
                    <>
                      {" "}
                      · <span className="sting-mono">{branchChips.length}</span> فروع
                    </>
                  ) : null}
                  .
                </p>
                <p className="acc-lead">
                  <strong>المرشّحات فعّالة</strong> · تغييرها أثناء الحساب يعيد الطلب لا ينتظره.
                </p>
              </Notice>
            ) : null}
            {state === "stale" && p ? (
              <Notice kind="warning" title="أرقام من آخر مطابقة">
                <p className="acc-lead">
                  لا اتصال الآن، والتقرير من بيانات الجهاز المحلية. حُسب في{" "}
                  <span className="sting-mono">{hhmm(p.computed_at)}</span>.
                </p>
                <p className="acc-lead">
                  <strong>لا نمنع القراءة</strong> · نُظهره بوقته ووسمه. منعُ تقرير لأن الشبكة ساقطة
                  يُعطّل عملاً لأجل دقّةٍ قد لا تلزم.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && p ? (
              <Notice
                kind="empty"
                title="لا مبيعات في المدى"
                action={
                  p.last_sale_date ? (
                    <Button
                      onClick={() => {
                        setCustom({ start: p.last_sale_date, end: p.last_sale_date });
                        setRange("custom");
                      }}
                    >
                      نقترح المدى الأقرب
                    </Button>
                  ) : undefined
                }
              >
                <p className="acc-lead">
                  المدى المختار بلا فواتير. السبب المرشّح غالباً لا انعدام البيع.
                </p>
                {p.last_sale_date ? (
                  <p className="acc-lead">
                    لا مبيعات في {p.range.label} — آخر بيع <DayCell iso={p.last_sale_date} />.
                  </p>
                ) : null}
              </Notice>
            ) : null}
            {state === "pending_sync" && p ? (
              <Notice
                kind="warning"
                title="ناقص معلوم"
                action={
                  <>
                    <Button onClick={() => void exportCsv()}>تصدير مع ختم الاكتمال</Button>
                    <Button pos onClick={() => void syncThenRecompute()} loading={syncing}>
                      مزامنة ثم إعادة الحساب
                    </Button>
                  </>
                }
              >
                {otherPending > 0 ? (
                  <p className="acc-lead">
                    هذا التقرير لا يشمل <span className="sting-mono">{otherPending}</span> عمليات
                    معلّقة من{" "}
                    {p.completeness.not_synced
                      .filter((d) => d.pending > 0)
                      .map((d) => d.device_name)
                      .join(" و")}
                    . حُسب في <span className="sting-mono">{hhmm(p.computed_at)}</span>. طبعه الآن
                    يعني طبع رقم ناقص تعرف مقداره.
                  </p>
                ) : null}
                {local.count > 0 ? (
                  <p className="acc-lead">
                    يشمل <span className="sting-mono">{local.count}</span> عمليات معلّقة من هذا
                    الجهاز بقيمة <span className="sting-mono">{formatMinor(local.totalMinor)}</span>{" "}
                    — موسومة «معلّق هذا الجهاز» حتى تُرفع.
                  </p>
                ) : null}
                <p className="acc-choice__note">
                  الملف المصدَّر يحمل في ترويسته سطر الاكتمال نفسه — لا تفقده الورقة حين تخرج من
                  الشاشة.
                </p>
              </Notice>
            ) : null}

            {p && state !== "permission_denied" ? (
              <>
                <section className="rep-head" aria-label="اكتمال البيانات">
                  <h3 className="cat-head__title">اكتمال البيانات</h3>
                  <p className="acc-lead">
                    <span className="sting-mono">{p.completeness.devices_synced}</span> أجهزة من{" "}
                    <span className="sting-mono">{p.completeness.devices_total}</span> زامنت.
                    {p.completeness.not_synced.map((d) => (
                      <span key={d.device_name}>
                        {" "}
                        جهاز {d.branch_name} ({d.device_name}) لم يُزامن{" "}
                        {d.last_seen_at ? (
                          <>
                            منذ <Ago iso={d.last_seen_at} />
                          </>
                        ) : (
                          "بعد"
                        )}
                        {d.pending > 0 ? (
                          <>
                            {" "}
                            · <span className="sting-mono">{d.pending}</span> معلّقة
                          </>
                        ) : null}{" "}
                        — أرقام هذا التقرير تنقصها مبيعاته.
                      </span>
                    ))}
                  </p>
                  <p className="acc-choice__note">
                    المبيعات — {p.range.label} · حُسب في{" "}
                    <span className="sting-mono">{hhmm(p.computed_at)}</span>
                    {p.scope === "branch" && p.branch_name ? ` · ${p.branch_name}` : ""}
                  </p>
                </section>

                <div className="home-kpis rep-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">الإيراد</div>
                    <div className="home-kpi__value sting-mono">{formatMinor(revenue)}</div>
                    <div className="home-kpi__scope">
                      من <span className="sting-mono">{branchesSynced}</span> فروع زامنت
                      {local.count > 0 ? " · يشمل معلّق هذا الجهاز" : ""}
                    </div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">المرتجعات</div>
                    <div className="home-kpi__value sting-mono">
                      {formatMinor(p.totals.returns_minor)}
                    </div>
                    <div className="home-kpi__scope">
                      <span className="sting-mono">{p.totals.returns_count}</span> مرتجعات
                    </div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">عدد الفواتير</div>
                    <div className="home-kpi__value sting-mono">{invoices}</div>
                    <div className="home-kpi__scope">
                      متوسط{" "}
                      <span className="sting-mono">
                        {formatMinor(
                          invoices
                            ? (revenue * 2n + BigInt(invoices)) / (2n * BigInt(invoices))
                            : 0n,
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <Table
                  caption="المبيعات حسب الفرع"
                  columns={[
                    { key: "name", header: "الفرع", render: (b) => b.name },
                    {
                      key: "revenue",
                      header: "الإيراد",
                      mono: true,
                      render: (b) => formatMinor(b.revenue_minor),
                    },
                    {
                      key: "returns",
                      header: "المرتجعات",
                      mono: true,
                      render: (b) => formatMinor(b.returns_minor),
                    },
                    {
                      key: "sync",
                      header: "آخر مزامنة",
                      render: (b) =>
                        b.complete ? (
                          <span>
                            مكتمل · <Ago iso={b.last_sync_at} />
                          </span>
                        ) : (
                          <span>
                            ناقص <span className="sting-mono">{b.pending}</span> عمليات ·{" "}
                            <Ago iso={b.last_sync_at} />
                          </span>
                        ),
                    },
                  ]}
                  rows={p.by_branch}
                  rowKey={(b) => b.id}
                />

                {p.by_day.length ? (
                  <Table
                    caption="المبيعات حسب اليوم"
                    columns={[
                      { key: "date", header: "اليوم", render: (d) => <DayCell iso={d.date} /> },
                      {
                        key: "n",
                        header: "فواتير",
                        mono: true,
                        render: (d) => String(d.invoices),
                      },
                      {
                        key: "cash",
                        header: "نقد",
                        mono: true,
                        render: (d) => formatMinor(d.cash_minor),
                      },
                      {
                        key: "credit",
                        header: "آجل",
                        mono: true,
                        render: (d) => formatMinor(d.credit_minor),
                      },
                      {
                        key: "returns",
                        header: "مرتجعات",
                        mono: true,
                        render: (d) => formatMinor(d.returns_minor),
                      },
                      {
                        key: "net",
                        header: "الصافي",
                        mono: true,
                        render: (d) => formatMinor(d.net_minor),
                      },
                    ]}
                    rows={p.by_day}
                    rowKey={(d) => d.date}
                  />
                ) : null}

                <div className="cat-form__actions">
                  <Button onClick={() => void exportCsv()}>صدِّر CSV</Button>
                </div>
                <p className="acc-choice__note">
                  <strong>لا عمود تكلفة ولا هامش هنا — قرار</strong> G-03: الإيراد والمرتجعات ووسائل
                  الدفع أساسية، والتكلفة تحتاج سياسة معتمدة وتظهر في REP-05 بحالة phase_locked حتى
                  تُعتمد.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
