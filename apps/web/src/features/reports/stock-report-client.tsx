"use client";

import { readPendingStockMovements } from "@sting/sync-core";
import { Button, formatQty, Frame, Notice, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/inventory/inventory.css";
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

type State = "ready" | "loading" | "empty" | "stale" | "pending_sync";
type RangeKey = "today" | "yesterday" | "7d" | "30d" | "custom";

interface Row {
  item_id: string;
  name: string;
  unit: { code: string; name: string; decimal_places: 0 | 1 | 2 | 3 };
  opening_milli: string;
  in_milli: string;
  out_milli: string;
  closing_milli: string;
  moved_in_range: number;
  tag: "negative" | "empty" | "ok";
  doc: string;
  explain: string;
  last_movement_at: string;
}

interface Payload {
  scope: "all" | "branch";
  branch: { id: string; name: string } | null;
  range: { key: string; start: string; end: string; label: string };
  rows: Row[];
  moved_rows: number;
  negatives: number;
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
  last_movement_date: string;
}

interface LocalPending {
  count: number;
  byItem: Map<string, bigint>;
}

const CACHE = "rep.stock_cache";

/** حركات هذا الجهاز التي لم تُرفع في المدى والفرع: تُشمل موسومةً — إخفاؤها يخالف الرفّ. */
async function localPendingIn(branchId: string, start: string, end: string): Promise<LocalPending> {
  const byItem = new Map<string, bigint>();
  let count = 0;
  try {
    for (const m of await readPendingStockMovements(getStorage())) {
      if (m.branchId !== branchId) continue;
      const d = m.occurredAt.slice(0, 10);
      if (d < start || d > end) continue;
      count += 1;
      byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0n) + m.deltaMilli);
    }
  } catch {
    /* بلا تخزين محلي — لا معلّق */
  }
  return { count, byItem };
}

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

function DayCell({ iso }: { iso: string }) {
  const { day, month } = dayMonth(iso);
  return (
    <span>
      <span className="sting-mono">{day}</span> {month}
    </span>
  );
}

const labelOf = (k: RangeKey, custom: { start: string; end: string } | null) =>
  k === "today"
    ? "اليوم"
    : k === "yesterday"
      ? "أمس"
      : k === "7d"
        ? "آخر 7 أيام"
        : k === "30d"
          ? "آخر 30 يوماً"
          : custom
            ? custom.start === custom.end
              ? custom.start
              : `${custom.start} – ${custom.end}`
            : "مدى مخصَّص";

/**
 * REP-03 — تقرير المخزون والحركات (19-D14 ready · 36-D28 loading/empty/stale/pending_sync): ما في
 * المخزن وكيف وصل إليه — كل كمية لها مستند؛ بوحدة البيع ولا «إجمالي قطع» (R-08)؛ السالب لا يُخفى
 * ولا يُصفَّر ويظهر بلونه ومعه المستند الذي أنشأه (ACC-17)؛ الوقت مع كل رصيد؛ حركات هذا الجهاز
 * التي لم تُرفع تُشمل موسومة. يطابق INV-01.
 */
export function StockReportClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [range, setRange] = useState<RangeKey>("30d");
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [cached, setCached] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [local, setLocal] = useState<LocalPending>({ count: 0, byItem: new Map() });
  const [syncing, setSyncing] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const fetchServer = useCallback(async () => {
    setFetching(true);
    setFailed(false);
    try {
      const query: Record<string, string> = { range };
      if (range === "custom" && custom) {
        query.start = custom.start;
        query.end = custom.end;
      }
      if (branch) query.branch_id = branch;
      const { data, response } = await api().GET("/api/reports/stock", { params: { query } });
      if (response.status === 403) {
        // لا حالة permission_denied مرسومة لـREP-03: الكاشير يعود إلى أرصدة نطاقه (INV-01)
        router.replace("/inventory");
        return;
      }
      const body = data as unknown as Payload | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setData(body);
      if (body.branch)
        setLocal(await localPendingIn(body.branch.id, body.range.start, body.range.end));
      await getStorage().transaction((tx) => tx.putMeta(CACHE, JSON.stringify(body)));
    } catch {
      setFailed(true);
    } finally {
      setFetching(false);
    }
  }, [range, custom, branch, router]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Freports%2Fstock");
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
    if ((!online || failed) && p) return "stale";
    if (!p || (fetching && data === null)) return "loading";
    if (local.count > 0 || !p.completeness.complete) return "pending_sync";
    if (p.moved_rows === 0) return "empty";
    return "ready";
  })();

  const exportCsv = async () => {
    if (!p) return;
    const q = new URLSearchParams({ export: "csv", range: p.range.key });
    if (p.range.key === "custom") {
      q.set("start", p.range.start);
      q.set("end", p.range.end);
    }
    if (branch) q.set("branch_id", branch);
    const r = await fetch(`${apiBaseUrl()}/api/reports/stock?${q.toString()}`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-${p.range.start}-${p.range.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const syncThenRecompute = async () => {
    setSyncing(true);
    try {
      await pushPending(10, { manual: true });
    } catch {
      /* SYS-01 يبلّغ — نعيد الحساب بما وصل */
    } finally {
      setSyncing(false);
      await fetchServer();
    }
  };

  const rows = (p?.rows ?? []).map((r) => {
    const pend = local.byItem.get(r.item_id) ?? 0n;
    return { ...r, pendMilli: pend, shownMilli: BigInt(r.closing_milli) + pend };
  });

  return (
    <Frame title="التقارير" nav={<AppNav currentId="reports-stock" />} footer={null}>
      <div className="sys rep" data-screen="REP-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تقرير المخزون والحركات</h2>
            <span className="cat-head__hint">
              ما في المخزن وكيف وصل إليه. حركة المخزن والتصدير — كل كمية لها مستند. السالب لا يُخفى
              ولا يُصفَّر. يظهر بلونه ومعه المستند الذي أنشأه.
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
                  آخر 7 أيام
                </Chip>
                <Chip on={range === "30d"} onClick={() => setRange("30d")}>
                  آخر 30 يوماً
                </Chip>
                {range === "custom" && custom ? (
                  <Chip on onClick={() => undefined}>
                    {labelOf("custom", custom)}
                  </Chip>
                ) : null}
              </div>
              {p?.branches.length ? (
                <div className="pos-chips" role="group" aria-label="الفرع">
                  {p.branches.map((b) => (
                    <Chip
                      key={b.id}
                      on={(branch || p.branch?.id) === b.id}
                      onClick={() => setBranch(b.id)}
                    >
                      {b.name}
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>

            {state === "loading" ? (
              <Notice kind="info" title="جارٍ الجمع">
                <p className="acc-lead">
                  الأرصدة من مواقع متعددة. نعرض المواقع وهي تَرِد واحداً واحداً لا شريطاً مبهماً —{" "}
                  {labelOf(range, custom)}
                  {p?.branch ? ` · ${p.branch.name}` : ""}.
                </p>
              </Notice>
            ) : null}
            {state === "stale" && p ? (
              <Notice kind="warning" title="أرصدة من آخر مطابقة">
                <p className="acc-lead">
                  الأرصدة قديمة <Ago iso={p.computed_at} /> وقد بيع منها. حُسبت في{" "}
                  <span className="sting-mono">{hhmm(p.computed_at)}</span>.
                </p>
                <p className="acc-lead">
                  <strong>الوقت مع كل رصيد</strong> · لا في رأس الصفحة وحده. من يطبع صفحةً واحدة من
                  التقرير يأخذ معه الطابع الزمني.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && p ? (
              <Notice
                kind="empty"
                title="لا حركة في المدى"
                action={
                  p.last_movement_date ? (
                    <Button
                      onClick={() => {
                        setCustom({ start: p.last_movement_date, end: p.range.end });
                        setRange("custom");
                      }}
                    >
                      وسّع المدى
                    </Button>
                  ) : undefined
                }
              >
                <p className="acc-lead">
                  المدى المختار ({p.range.label}) بلا حركة. الفراغ سببه المرشّح لا المخزون.
                </p>
                {p.last_movement_date ? (
                  <p className="acc-lead">
                    <strong>نقول السبب</strong> · لا حركة في {p.range.label} — آخر حركة{" "}
                    <DayCell iso={p.last_movement_date} />.
                  </p>
                ) : null}
              </Notice>
            ) : null}
            {state === "pending_sync" && p ? (
              <Notice
                kind="warning"
                title="حركات لم تُرفع"
                action={
                  <>
                    <Button onClick={() => void exportCsv()}>تصدير مع ختم الاكتمال</Button>
                    <Button pos onClick={() => void syncThenRecompute()} loading={syncing}>
                      مزامنة ثم إعادة الحساب
                    </Button>
                  </>
                }
              >
                {local.count > 0 ? (
                  <p className="acc-lead">
                    على هذا الجهاز <span className="sting-mono">{local.count}</span> حركات مخزون
                    معلّقة، والتقرير يشملها موسومةً.
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
                    . حُسب في <span className="sting-mono">{hhmm(p.computed_at)}</span>.
                  </p>
                ) : null}
                <p className="acc-choice__note">
                  <strong>نشملها ونسمها</strong> · إخفاؤها يجعل الرقم مخالفاً لما على الرفّ. وعرضها
                  بلا وسم يجعله يبدو مؤكَّداً. الحلّ الثالث: تُعرض بوسم.
                </p>
              </Notice>
            ) : null}

            {p ? (
              <>
                <section className="rep-head" aria-label="اكتمال البيانات">
                  <h3 className="cat-head__title">
                    حركة الأصناف — {p.range.label}
                    {p.branch ? ` · ${p.branch.name}` : ""}
                  </h3>
                  <p className="acc-choice__note">
                    <span className="sting-mono">{p.completeness.devices_synced}</span> أجهزة من{" "}
                    <span className="sting-mono">{p.completeness.devices_total}</span> زامنت · حُسب
                    في <span className="sting-mono">{hhmm(p.computed_at)}</span>
                    {p.negatives > 0 ? (
                      <>
                        {" "}
                        · <strong>صنف برصيد سالب</strong>:{" "}
                        <span className="sting-mono">{p.negatives}</span>
                      </>
                    ) : null}
                  </p>
                </section>

                <Table
                  caption="حركة الأصناف"
                  columns={[
                    {
                      key: "item",
                      header: "الصنف والوحدة",
                      render: (r) => (
                        <div>
                          <div>{r.name}</div>
                          <div className="acc-choice__note">{r.unit.name}</div>
                        </div>
                      ),
                    },
                    {
                      key: "opening",
                      header: "أول المدة",
                      mono: true,
                      render: (r) => formatQty(r.opening_milli, r.unit.decimal_places),
                    },
                    {
                      key: "in",
                      header: "وارد",
                      mono: true,
                      render: (r) => formatQty(r.in_milli, r.unit.decimal_places),
                    },
                    {
                      key: "out",
                      header: "صادر",
                      mono: true,
                      render: (r) => formatQty(r.out_milli, r.unit.decimal_places),
                    },
                    {
                      key: "closing",
                      header: "الرصيد",
                      render: (r) => (
                        <div className="pty-due">
                          <span
                            className={`sting-mono inv-qty${r.shownMilli < 0n ? " inv-qty--neg" : ""}`}
                          >
                            {formatQty(r.shownMilli, r.unit.decimal_places)}
                          </span>
                          {r.pendMilli !== 0n ? (
                            <span className="acc-choice__note">
                              خادمي{" "}
                              <span className="sting-mono">
                                {formatQty(r.closing_milli, r.unit.decimal_places)}
                              </span>{" "}
                              + معلّق هذا الجهاز{" "}
                              <span className="sting-mono">
                                {formatQty(r.pendMilli, r.unit.decimal_places)}
                              </span>
                            </span>
                          ) : null}
                          {r.last_movement_at ? (
                            <span className="acc-choice__note">
                              <span className="sting-mono">{hhmm(r.last_movement_at)}</span>{" "}
                              <DayCell iso={r.last_movement_at} />
                            </span>
                          ) : null}
                        </div>
                      ),
                    },
                    {
                      key: "doc",
                      header: "المستند المفسِّر",
                      render: (r) => (
                        <div>
                          {r.shownMilli < 0n ? (
                            <div>
                              <strong>رصيد سالب</strong> · «{r.name}» عند{" "}
                              <span className="sting-mono inv-qty inv-qty--neg">
                                {formatQty(r.shownMilli, r.unit.decimal_places)}
                              </span>
                              : بِيع أكثر مما دخل مسجَّلاً. السبب غالباً إدخال شراء لم يُسجَّل بعد.
                              لا نصفّره ولا نمنع البيع بأثر رجعي — نعرضه حتى يُصحَّح بمستند.
                            </div>
                          ) : null}
                          <div className="acc-choice__note">
                            {r.tag === "empty" && r.last_movement_at ? (
                              <>
                                نفد — آخر صرف <DayCell iso={r.last_movement_at} />
                              </>
                            ) : r.explain && r.shownMilli < 0n ? (
                              `${r.explain} — راجع ${r.doc}`
                            ) : (
                              r.doc
                            )}
                          </div>
                        </div>
                      ),
                    },
                  ]}
                  rows={rows}
                  rowKey={(r) => r.item_id}
                  onOpenRow={(r) => router.push(`/inventory/items/${r.item_id}`)}
                />
                <div className="cat-form__actions">
                  <Button onClick={() => void exportCsv()}>صدِّر CSV</Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
