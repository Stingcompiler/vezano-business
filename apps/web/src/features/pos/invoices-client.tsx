"use client";

import { type LocalSale, readSales } from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { hhmm } from "@/features/home/format";
import { readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

import { PosNav } from "./pos-nav";

type State =
  "ready" | "loading" | "empty" | "offline" | "stale" | "pending_sync" | "permission_denied";

type Range = "today" | "week";
type SyncFilter = "all" | "pending";

/** صف كما يعيده `GET /api/sales` (فواتير الأجهزة الأخرى تلحق موسومة). */
export interface ServerSale {
  readonly id: string;
  readonly invoice_number: string;
  readonly branch_id: string;
  readonly device_id: string;
  readonly device_name: string;
  readonly user_name: string;
  readonly party_id: string;
  readonly party_name: string;
  readonly total_minor: string;
  readonly cash_minor: string;
  readonly credit_minor: string;
  readonly bank_minor: string;
  readonly business_date: string;
  readonly occurred_at: string;
  readonly received_at: string;
  readonly date_suspect: boolean;
  readonly sync_state: "synced" | "reversed";
}

interface ListData {
  readonly scope: "all" | "branch" | "device";
  readonly can_all_branches: boolean;
  readonly can_totals: boolean;
  readonly can_decide: boolean;
  readonly branch_name: string;
  readonly as_of: string;
  readonly range: Range;
  readonly rows: readonly ServerSale[];
  readonly totals: { readonly count: number; readonly total_minor: string } | null;
  readonly last_sale_at: string;
}

const LIST_CACHE = "sales.list_cache";

export type RowSync = "local" | "pending" | "synced" | "reversed";

/** صف الشاشة: محلي (بحالة عمليته) أو خادمي — القوائم تعرض pending_sync والنماذج saved_local. */
export interface Row {
  readonly id: string;
  readonly number: string;
  readonly occurredAt: string;
  readonly partyName: string;
  readonly totalMinor: string;
  readonly cashMinor: string;
  readonly creditMinor: string;
  readonly sync: RowSync;
  readonly dateSuspect: boolean;
  readonly deviceName: string;
  readonly source: "local" | "server";
}

const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** «10:34 اليوم» / «09:12 أمس» / «10 سبتمبر» — الكلمة خارج mono والرقم داخله. */
export function DayLabel({ iso, now }: { iso: string; now: Date }) {
  const d = new Date(iso);
  const diff = Math.round((dayOf(now) - dayOf(d)) / 86_400_000);
  if (diff === 0) return <>اليوم</>;
  if (diff === 1) return <>أمس</>;
  return (
    <>
      <span className="sting-mono">{String(d.getDate()).padStart(2, "0")}</span>{" "}
      {MONTHS[d.getMonth()]}
    </>
  );
}

/** جودة التاريخ محلياً (ACC-77): ساعة الجهاز في يوم غير يوم أعمال الوردية. */
export function localDateSuspect(s: LocalSale): boolean {
  const d = new Date(s.occurred_at);
  const bd = new Date(`${s.business_date}T00:00:00`);
  return Math.abs(dayOf(d) - dayOf(bd)) > 86_400_000;
}

export const SYNC_LABEL: Record<RowSync, string> = {
  local: "محفوظ محلياً",
  pending: "معلّق المزامنة",
  synced: "مؤكد خادمياً",
  reversed: "مؤكد خادمياً",
};

/** عمود «المزامنة» — لكل فاتورة وضعها: محلي، في الطابور، مؤكَّد؛ الملغاة بمستند عكسي تُسمّى. */
export function SyncCell({ sync }: { sync: RowSync }) {
  return (
    <div className="shift-status">
      <Status
        state={sync === "local" ? "saved_local" : sync === "pending" ? "pending_sync" : "synced"}
        label={SYNC_LABEL[sync]}
      />
      {sync === "reversed" ? <div className="acc-choice__note">مستند إلغاء مستقلاً</div> : null}
    </div>
  );
}

async function localRows(): Promise<Row[]> {
  const storage = getStorage();
  const sales = await readSales(storage);
  const out: Row[] = [];
  for (const s of sales) {
    const op = await storage.read((tx) => tx.getOperation(s.operation_id));
    const st = op?.state ?? "local";
    out.push({
      id: s.id,
      number: s.invoice_number,
      occurredAt: s.occurred_at,
      partyName: s.party_name,
      totalMinor: s.total_minor,
      cashMinor: s.cash_minor,
      creditMinor: s.credit_minor,
      sync: st === "synced" ? "synced" : st === "pending" ? "pending" : "local",
      dateSuspect: localDateSuspect(s),
      deviceName: "",
      source: "local",
    });
  }
  return out;
}

const serverRow = (s: ServerSale): Row => ({
  id: s.id,
  number: s.invoice_number,
  occurredAt: s.occurred_at,
  partyName: s.party_name,
  totalMinor: s.total_minor,
  cashMinor: s.cash_minor,
  creditMinor: s.credit_minor,
  sync: s.sync_state,
  dateSuspect: s.date_suspect,
  deviceName: s.device_name,
  source: "server",
});

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

/**
 * POS-09 — قائمة الفواتير (03-D2 ready · 42-D34 loading/empty/offline/stale/pending_sync/
 * permission_denied): المحلي فوراً وفواتير الأجهزة الأخرى تلحق موسومة؛ عمود وضع المزامنة لكل
 * فاتورة؛ الصف ذو التاريخ المشكوك فيه معلَّم والأصل لم يُعدَّل (ACC-77)؛ الكاشير يرى نطاقه
 * والمجاميع تقارير.
 */
export function InvoicesClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [range, setRange] = useState<Range>("today");
  const [allBranches, setAllBranches] = useState(false);
  const [syncFilter, setSyncFilter] = useState<SyncFilter>("all");
  const [local, setLocal] = useState<readonly Row[] | null>(null);
  const [data, setData] = useState<ListData | null>(null);
  const [cached, setCached] = useState<ListData | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [denied, setDenied] = useState(false);
  const [branchName, setBranchName] = useState("");
  const appRef = useRef(app);
  appRef.current = app;
  const now = new Date();

  const fetchServer = useCallback(
    async (r: Range, all: boolean) => {
      if (!online) return;
      setFetching(true);
      setFailed(false);
      try {
        const { data, response } = await api().GET("/api/sales", {
          params: { query: { range: r, branch: all ? "all" : "mine" } },
        });
        // العقد لا يصف الجسم (responses: None) — الشكل من الخادم مباشرةً
        const body: ListData | undefined = data;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        await getStorage().transaction((tx) => tx.putMeta(LIST_CACHE, JSON.stringify(body)));
      } catch {
        setFailed(true);
      } finally {
        setFetching(false);
      }
    },
    [online],
  );

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpos%2Finvoices");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [rows, ctx, raw] = await Promise.all([
        localRows(),
        readShiftContext(storage, app),
        storage.read((tx) => tx.getMeta(LIST_CACHE)),
      ]);
      setLocal(rows);
      setBranchName(ctx?.branchName ?? "");
      if (raw) setCached(JSON.parse(raw) as ListData);
    })();
  }, [router]);

  useEffect(() => {
    void fetchServer(range, allBranches);
  }, [fetchServer, range, allBranches]);

  const server = data ?? cached;
  const localIds = new Set((local ?? []).map((r) => r.id));
  const sinceMs = dayOf(now) - (range === "week" ? 6 : 0) * 86_400_000;
  let rows: Row[] = [
    ...(local ?? []).filter((r) => new Date(r.occurredAt).getTime() >= sinceMs),
    ...(server?.rows ?? []).filter((s) => !localIds.has(s.id)).map(serverRow),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  if (syncFilter === "pending")
    rows = rows.filter((r) => r.sync === "local" || r.sync === "pending");
  const isCashier = server ? server.scope === "device" : false;
  const canAll = server?.can_all_branches ?? false;
  const canTotals = server?.can_totals ?? false;

  const state: State = denied
    ? "permission_denied"
    : !online
      ? "offline"
      : failed && (cached !== null || (local ?? []).length > 0)
        ? "stale"
        : local === null || (fetching && data === null)
          ? "loading"
          : rows.some((r) => r.sync === "local" || r.sync === "pending")
            ? "pending_sync"
            : rows.length === 0
              ? "empty"
              : "ready";

  const liveRows = rows.filter((r) => r.sync !== "reversed");
  const total = liveRows.reduce((acc, r) => acc + BigInt(r.totalMinor), 0n);
  const lastSaleAt = server?.last_sale_at || (local ?? [])[0]?.occurredAt || "";

  const columns = [
    {
      key: "no",
      header: "الرقم والوقت",
      render: (r: Row) => (
        <div>
          <Button variant="quiet" className="shift-row__open" onClick={() => open(r)}>
            <span className="sting-mono">{r.number}</span>
          </Button>
          <div className={`acc-choice__note${r.dateSuspect ? " pos-inv__suspect" : ""}`}>
            {r.dateSuspect ? (
              <>
                ⚠ <span className="sting-mono">{hhmm(r.occurredAt)}</span> — تاريخ مشكوك فيه
              </>
            ) : (
              <>
                <span className="sting-mono">{hhmm(r.occurredAt)}</span>{" "}
                <DayLabel iso={r.occurredAt} now={now} />
              </>
            )}
          </div>
        </div>
      ),
    },
    { key: "party", header: "العميل", render: (r: Row) => r.partyName || "نقدي" },
    { key: "total", header: "الإجمالي", mono: true, render: (r: Row) => formatMinor(r.totalMinor) },
    { key: "cash", header: "نقداً", mono: true, render: (r: Row) => formatMinor(r.cashMinor) },
    { key: "credit", header: "آجل", mono: true, render: (r: Row) => formatMinor(r.creditMinor) },
    { key: "sync", header: "المزامنة", render: (r: Row) => <SyncCell sync={r.sync} /> },
    {
      key: "open",
      header: "فتح",
      render: (r: Row) => (
        <Button variant="secondary" onClick={() => open(r)}>
          فتح
        </Button>
      ),
    },
  ];

  const open = (r: Row) => router.push(`/pos/invoices/${r.id}`);

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="invoices" canSeeReports={canTotals} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">قائمة الفواتير وتفاصيلها</h2>
            <span className="cat-head__hint">
              بحث وتاريخ وفرع ووضع مزامنة لكل صف، مع تمييز التاريخ المشكوك فيه.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__filters">
              <div className="pos-chips" role="group" aria-label="المدى">
                <Chip on={range === "today"} onClick={() => setRange("today")}>
                  اليوم
                </Chip>
                <Chip on={range === "week"} onClick={() => setRange("week")}>
                  هذا الأسبوع
                </Chip>
              </div>
              <div className="pos-chips" role="group" aria-label="الفرع">
                <Chip
                  on={!allBranches && !denied}
                  onClick={() => {
                    setDenied(false);
                    setAllBranches(false);
                  }}
                >
                  {branchName || server?.branch_name || "الفرع الرئيسي"}
                </Chip>
                <Chip
                  on={allBranches || denied}
                  restricted={!canAll}
                  onClick={() => {
                    if (canAll) setAllBranches(true);
                    else setDenied(true);
                  }}
                >
                  كل الفروع
                </Chip>
              </div>
              <div className="pos-chips" role="group" aria-label="المزامنة">
                <Chip on={syncFilter === "all"} onClick={() => setSyncFilter("all")}>
                  كل حالات المزامنة
                </Chip>
                <Chip on={syncFilter === "pending"} onClick={() => setSyncFilter("pending")}>
                  معلّق فقط
                </Chip>
              </div>
            </div>

            {state === "permission_denied" ? (
              <Notice kind="locked" title="الكاشير يرى نطاقه">
                <p className="acc-lead">فواتير جهازه وورديته، لا كل الفرع ولا مجاميع اليوم.</p>
                <p className="acc-lead">
                  <strong>المجاميع تقارير</strong> · مجموع مبيعات الفرع بابه «تقرير المبيعات»
                  بصلاحيته. قائمة المراجعة اللحظية غير تقرير الأداء.
                </p>
              </Notice>
            ) : null}
            {state === "offline" ? (
              <Notice kind="offline" title="فواتير الجهاز وما زامنه">
                <p className="acc-lead">
                  القائمة كاملة لما يعرفه الجهاز، وفواتير الفروع الأخرى غائبة معلَنة.
                </p>
              </Notice>
            ) : null}
            {state === "stale" ? (
              <Notice kind="warning" title="فرع آخر يبيع الآن">
                <p className="acc-lead">
                  المجاميع من آخر مطابقة
                  {cached ? (
                    <>
                      {" "}
                      · حتى <span className="sting-mono">{hhmm(cached.as_of)}</span>
                    </>
                  ) : null}
                  .
                </p>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="المحلي فوراً">
                <p className="acc-lead">
                  فواتير الجهاز تظهر بلا انتظار، وفواتير الأجهزة الأخرى تلحق موسومة.
                </p>
              </Notice>
            ) : null}
            {state === "pending_sync" ? (
              <Notice kind="info" title="عمود وضع المزامنة">
                <p className="acc-lead">لكل فاتورة وضعها: محلي، في الطابور، مؤكَّد.</p>
                <p className="acc-lead">
                  <strong>قاعدة المفردات</strong> · القوائم تعرض pending_sync والنماذج تعرض
                  saved_local — خلطهما يوهم أن الفعل خرج من الجهاز وهو لم يخرج.
                </p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا فواتير">
                {lastSaleAt ? (
                  <p className="acc-lead">
                    لا فواتير في هذا المدى — آخرها <DayLabel iso={lastSaleAt} now={now} />
                  </p>
                ) : (
                  <p className="acc-lead">لم يُسجَّل بيع بعد.</p>
                )}
              </Notice>
            ) : null}

            {isCashier && state !== "permission_denied" ? (
              <p className="acc-choice__note">الكاشير يرى نطاقه — فواتير جهازه وورديته.</p>
            ) : null}
            {server?.can_decide ? (
              // POS-12 تُفتح من تنبيه لا من تصفّح — حتى يُبنى تنبيه الرئيسية، رابط هادئ من هنا
              <Button variant="quiet" onClick={() => router.push("/pos/duplicates")}>
                مراجعة تكرار تجاري أو تصحيح
              </Button>
            ) : null}

            <Table
              caption="الفواتير"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={state === "loading" && rows.length === 0 ? 3 : undefined}
              onOpenRow={open}
            />

            <div className="pos-inv__foot">
              {canTotals ? (
                <>
                  <span>
                    <span className="sting-mono">{liveRows.length}</span> فواتير · إجمالي{" "}
                    {range === "today" ? "اليوم" : "الأسبوع"}{" "}
                    <span className="sting-mono">{formatMinor(total.toString())}</span>
                    {server ? (
                      <>
                        {" "}
                        · حتى <span className="sting-mono">{hhmm(server.as_of)}</span>
                      </>
                    ) : null}
                  </span>
                  {rows.some((r) => r.dateSuspect) ? (
                    <span className="acc-choice__note">
                      الصف ذو التاريخ المشكوك فيه معلَّم — ساعة الجهاز كانت خاطئة، والأصل لم يُعدَّل
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="acc-choice__note">
                  المجاميع تقارير — بابها «تقرير المبيعات» بصلاحيته.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
