"use client";

import {
  type LocalItem,
  pendingByItem,
  readLocalBalances,
  readLocalItems,
  readPendingStockMovements,
  readStockCache,
  storeStockCache,
} from "@sting/sync-core";
import {
  Button,
  formatQty,
  Frame,
  Notice,
  SelectField,
  Status,
  Table,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import "@/features/inventory/inventory.css";
import { hhmm } from "@/features/home/format";
import { DayLabel } from "@/features/pos/invoices-client";
import { PosNav } from "@/features/pos/pos-nav";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "stale" | "offline" | "pending_sync" | "partial";
type Filter = "all" | "negative" | "low";
type Dp = 0 | 1 | 2 | 3;

interface UnitInfo {
  readonly code: string;
  readonly name: string;
  readonly decimal_places: Dp;
}

interface ServerRow {
  readonly item_id: string;
  readonly name: string;
  readonly qty_milli: string;
  readonly sale_unit: UnitInfo;
  readonly purchase_unit: (UnitInfo & { readonly factor_milli: string }) | null;
  readonly alert_threshold_milli: string;
  readonly tag: "negative" | "low" | "ok";
  readonly quarantine_milli: string;
  readonly in_transit_milli?: string;
  readonly last_movement_at: string;
  readonly price_missing: boolean;
}

interface Balances {
  readonly branch_id: string;
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly as_of: string;
  readonly rows: readonly ServerRow[];
}

/** صف الشاشة: خادمي + معلّق هذا الجهاز (للفرع الحالي) — يُعرضان مركَّبين لا مجموعاً وحده. */
export interface Row {
  readonly id: string;
  readonly name: string;
  readonly serverMilli: bigint;
  readonly pendingMilli: bigint;
  readonly pendingCount: number;
  readonly qtyMilli: bigint;
  readonly saleUnit: UnitInfo;
  readonly purchase: (UnitInfo & { readonly factor_milli: string }) | null;
  readonly thresholdMilli: bigint | null;
  readonly priceMissing: boolean;
  readonly lastAt: string;
  readonly asOf: string;
  readonly tag: "negative" | "low" | "missing" | "ok";
  /** في الحجر — يخرج من المتاح للبيع ويبقى في المخزون الفعلي (ACC-10) */
  readonly quarantineMilli: bigint;
  /** في الطريق إلى فرع آخر — لا يُحسب في رصيد الفرعين (§١٠.٢) */
  readonly inTransitMilli: bigint;
}

/** «0.83» بالكرتونة: الرصيد ÷ معامل وحدة الشراء بمنزلتين — قراءة مساعدة لا مجموع (R-08). */
export function inPurchaseUnit(qtyMilli: bigint, factorMilli: bigint): string {
  if (factorMilli <= 0n) return "—";
  const scaled = (qtyMilli * 100n) / factorMilli;
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  return `${neg ? "−" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

function tagOf(qty: bigint, threshold: bigint | null, priceMissing: boolean): Row["tag"] {
  if (qty < 0n) return "negative";
  if (threshold !== null && qty < threshold) return "low";
  if (priceMissing) return "missing";
  return "ok";
}

/**
 * INV-01 — أرصدة المخزون (05-D2 pending_sync · 40-D32 ready/loading/empty/stale/offline · 14-D9
 * partial): لكل صنف رصيده بوحدة البيع ووحدة الشراء بمعاملها المعلن قراءةً مساعدة — لا مجموع كمّي
 * عبر وحدات مختلفة (R-08)؛ السالب يُعرض بلونه لا يُصفَّر ولا يمنع البيع (ACC-17)؛ حد التنبيه
 * اقتراح لا أمر؛ المعلّق من هذا الجهاز داخل في الأرصدة وموسوم؛ لكل رصيد تغطية زمنية.
 */
export function StockClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [branchId, setBranchId] = useState<string>("");
  const [data, setData] = useState<Balances | null>(null);
  const [cached, setCached] = useState<Balances | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [localRows, setLocalRows] = useState<Row[] | null>(null);
  const [pending, setPending] = useState<Map<string, { deltaMilli: bigint; count: number }>>(
    new Map(),
  );
  // المواقع الأخرى (للمالك): تَرِد واحداً واحداً؛ الفشل في أحدها = جزئي
  const [others, setOthers] = useState<Map<string, Balances | "failed" | "pending">>(new Map());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finventory");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const c = await readShiftContext(storage, app);
      setCtx(c);
      if (c?.branchId) {
        setBranchId((b) => b || c.branchId);
        return;
      }
      // مالك على الويب بلا جهاز مسجَّل: الخادم يختار أول فرع نشط ونعرضه بدل شاشة بلا فرع
      try {
        const { data, response } = await api().GET("/api/inventory/balances", {
          params: { query: {} },
        });
        const body = data as unknown as Balances | undefined;
        if (response.ok && body?.branch_id) setBranchId((b) => b || body.branch_id);
      } catch {
        // بلا اتصال: تبقى الشاشة بلا فرع حتى يُسجَّل الجهاز
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    setFetching(true);
    setFailed(false);
    setData(null);
    setOthers(new Map());
    void (async () => {
      const storage = getStorage();
      const [cache, moves, balances, items] = await Promise.all([
        readStockCache<Balances>(storage, branchId),
        readPendingStockMovements(storage),
        readLocalBalances(storage),
        readLocalItems(storage),
      ]);
      if (!alive) return;
      setCached(cache);
      setPending(pendingByItem(moves, branchId));
      setLocalRows(localRowsOf(items, balances));
      if (!navigator.onLine) {
        setFetching(false);
        return;
      }
      try {
        const { data, response } = await api().GET("/api/inventory/balances", {
          params: { query: { branch_id: branchId } },
        });
        if (!alive) return;
        const body = data as unknown as Balances | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        await storeStockCache(storage, branchId, body);
        // المواقع الأخرى للمالك — واحداً واحداً، والمجموع لا يُعرض قبل اكتمالها
        const rest = body.branches.filter((b) => b.id !== branchId);
        setOthers(new Map(rest.map((b) => [b.id, "pending" as const])));
        for (const b of rest) {
          try {
            const r = await api().GET("/api/inventory/balances", {
              params: { query: { branch_id: b.id } },
            });
            const rb = r.data as unknown as Balances | undefined;
            if (!alive) return;
            setOthers((m) => new Map(m).set(b.id, r.response.ok && rb ? rb : "failed"));
          } catch {
            if (!alive) return;
            setOthers((m) => new Map(m).set(b.id, "failed"));
          }
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setFetching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [branchId, online]);

  const server = data ?? cached;
  const isDeviceBranch = ctx?.branchId === branchId;
  const source: Row[] | null =
    server && (online || !isDeviceBranch)
      ? server.rows.map((r) => toRow(r, server.as_of, pending.get(r.item_id)))
      : isDeviceBranch
        ? localRows
        : null;
  const rowsAll = source ?? [];
  const needle = q.trim();
  const rows = rowsAll
    .filter((r) => (needle ? r.name.includes(needle) : true))
    .filter((r) =>
      filter === "negative" ? r.qtyMilli < 0n : filter === "low" ? r.tag === "low" : true,
    );
  const pendingCount = rowsAll.reduce((a, r) => a + r.pendingCount, 0);
  const attention = rowsAll.filter((r) => r.tag !== "ok").length;
  const othersArr = [...others.values()];
  const othersPending = othersArr.some((v) => v === "pending");
  const othersFailed = othersArr.some((v) => v === "failed");
  const totalsReady = server !== null && !othersPending && !othersFailed;

  const state: State = !online
    ? "offline"
    : source === null || (fetching && data === null && cached === null)
      ? "loading"
      : failed
        ? "stale"
        : othersPending
          ? "loading"
          : othersFailed
            ? "partial"
            : rowsAll.length === 0
              ? "empty"
              : pendingCount > 0
                ? "pending_sync"
                : "ready";

  const totalAcross = (itemId: string): bigint | null => {
    if (!totalsReady || !server) return null;
    let sum = 0n;
    for (const r of server.rows) if (r.item_id === itemId) sum += BigInt(r.qty_milli);
    for (const v of othersArr) {
      if (v === "pending" || v === "failed") return null;
      for (const r of v.rows) if (r.item_id === itemId) sum += BigInt(r.qty_milli);
    }
    return sum;
  };
  const multi = (server?.branches.length ?? 0) > 1;

  const columns = [
    {
      key: "name",
      header: "الصنف",
      render: (r: Row) => (
        <div>
          <Button variant="quiet" className="shift-row__open" onClick={() => open(r)}>
            {r.name}
          </Button>
          {r.purchase ? (
            <div className="acc-choice__note">
              المعامل: <span className="sting-mono">1</span> {r.purchase.name} ={" "}
              <span className="sting-mono">
                {formatQty(r.purchase.factor_milli, r.saleUnit.decimal_places)}
              </span>{" "}
              {r.saleUnit.name}
            </div>
          ) : (
            <div className="acc-choice__note">وحدة واحدة — لا تحويل</div>
          )}
        </div>
      ),
    },
    {
      key: "purchase",
      header: "وحدة الشراء",
      render: (r: Row) => (r.purchase ? r.purchase.name : "—"),
    },
    { key: "unit", header: "الوحدة", render: (r: Row) => r.saleUnit.name },
    {
      key: "qty",
      header: "الرصيد",
      render: (r: Row) => (
        <div className="pty-due">
          <span className={`sting-mono inv-qty${r.qtyMilli < 0n ? " inv-qty--neg" : ""}`}>
            {formatQty(r.qtyMilli, r.saleUnit.decimal_places)}
          </span>
          {r.pendingCount > 0 ? (
            <span className="acc-choice__note">
              خادمي{" "}
              <span className="sting-mono">
                {formatQty(r.serverMilli, r.saleUnit.decimal_places)}
              </span>{" "}
              + معلّق هذا الجهاز{" "}
              <span className="sting-mono">
                {formatQty(r.pendingMilli, r.saleUnit.decimal_places)}
              </span>
            </span>
          ) : null}
          {r.inTransitMilli > 0n ? (
            <span className="acc-choice__note">
              في الطريق{" "}
              <span className="sting-mono">
                {formatQty(r.inTransitMilli, r.saleUnit.decimal_places)}
              </span>
            </span>
          ) : null}
          {r.quarantineMilli > 0n ? (
            <span className="acc-choice__note">
              حجر — قابل للمراجعة{" "}
              <span className="sting-mono">
                {formatQty(r.quarantineMilli, r.saleUnit.decimal_places)}
              </span>
            </span>
          ) : null}
          {state === "stale" || state === "offline" ? (
            <span className="acc-choice__note">
              حتى <span className="sting-mono">{r.asOf ? hhmm(r.asOf) : "—"}</span>
            </span>
          ) : null}
          {multi ? (
            <span className="acc-choice__note">
              كل المواقع{" "}
              <span className="sting-mono">
                {((t) => (t === null ? "—" : formatQty(t, r.saleUnit.decimal_places)))(
                  totalAcross(r.id),
                )}
              </span>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "cartons",
      header: "بالكرتونة",
      render: (r: Row) =>
        r.purchase ? (
          <>
            <span className="sting-mono">
              {inPurchaseUnit(r.qtyMilli, BigInt(r.purchase.factor_milli))}
            </span>{" "}
            {r.purchase.name}
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "tag",
      header: "التنبيه",
      render: (r: Row) => (
        <div>
          {r.tag === "negative" ? (
            <Status state="stale" label="رصيد سالب" dot={false} />
          ) : r.tag === "low" ? (
            <Status state="pending_sync" label="تحت حد التنبيه" dot={false} />
          ) : r.tag === "missing" ? (
            <Status state="empty" label="بيانات ناقصة" dot={false} />
          ) : (
            "—"
          )}
          <div className="acc-choice__note">
            {r.tag === "negative" ? (
              "بيع فوق الرصيد الدفتري. لا يُصحَّح تلقائياً — يحتاج جرد أو تسجيل استلام فائت."
            ) : r.tag === "low" && r.thresholdMilli !== null ? (
              <>
                تحت حد إعادة الطلب (
                <span className="sting-mono">
                  {formatQty(r.thresholdMilli, r.saleUnit.decimal_places)}
                </span>
                ). التنبيه اقتراح لا أمر — قد تكون تعرف أن شحنة في الطريق.
              </>
            ) : r.tag === "missing" ? (
              "بلا سعر وبلا معامل تحويل. يُباع بسعر يدوي في POS-05 ولا يدخل تقارير القيمة حتى يُستكمل."
            ) : (
              "سليم"
            )}
          </div>
        </div>
      ),
    },
    {
      key: "last",
      header: "آخر حركة",
      render: (r: Row) =>
        r.lastAt ? (
          <>
            <DayLabel iso={r.lastAt} now={new Date()} />{" "}
            <span className="sting-mono">{hhmm(r.lastAt)}</span>
          </>
        ) : (
          "—"
        ),
    },
  ];

  const open = (r: Row) => router.push(`/inventory/items/${r.id}?branch=${branchId}`);
  const branchName = server?.branches.find((b) => b.id === branchId)?.name ?? ctx?.branchName ?? "";

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={Boolean(ctx?.roleCode === "owner")} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">المخزون — {branchName}</h2>
            <span className="cat-head__hint">
              الرصيد السالب يُنبَّه عليه ولا يمنع البيع — ACC-17. لكل رصيد تغطية زمنية.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__filters inv-filters">
              <TextField
                label="اسم الصنف"
                placeholder="اسم الصنف"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <SelectField
                label="الفرع"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={
                  server
                    ? server.branches.map((b) => ({ value: b.id, label: b.name }))
                    : [{ value: branchId, label: branchName || "—" }]
                }
              />
              <SelectField
                label="الأصناف"
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                options={[
                  { value: "all", label: "كل الأصناف" },
                  { value: "negative", label: "السالب فقط" },
                  { value: "low", label: "تحت حد التنبيه" },
                ]}
              />
            </div>
            <div className="pos-inv__foot">
              <p className="acc-choice__note">
                <span className="sting-mono">{rowsAll.length}</span> صنفاً ·{" "}
                <span className="sting-mono">{attention}</span> أصناف تحتاج انتباهاً
              </p>
              <span className="pty-actions">
                <Button variant="secondary" onClick={() => router.push("/inventory/receive")}>
                  استلم بضاعة
                </Button>
                <Button variant="quiet" onClick={() => router.push("/inventory/openings")}>
                  أدخل افتتاحيات المخزون
                </Button>
                <Button variant="quiet" onClick={() => router.push("/inventory/count")}>
                  جلسة جرد
                </Button>
                <Button variant="quiet" onClick={() => router.push("/inventory/transfers")}>
                  التحويلات
                </Button>
              </span>
            </div>

            {state === "loading" ? (
              <Notice kind="info" title="جمع المواقع">
                <p className="acc-lead">
                  المواقع تَرِد واحداً واحداً، والمجموع لا يُعرض قبل اكتمالها.
                </p>
                <p className="acc-choice__note">
                  <strong>لا مجموع جزئي</strong> · مجموعٌ ناقص يُقرأ كاملاً ويُبنى عليه أمر شراء.
                </p>
              </Notice>
            ) : null}
            {state === "partial" ? (
              <Notice kind="warning" title="جمع المواقع">
                <p className="acc-lead">
                  اتصالٌ ومواقع لم تَرد. المجموع لا يُعرض قبل اكتمالها — لا مجموع جزئي.
                </p>
                <p className="acc-choice__note">
                  {[...others.entries()]
                    .filter(([, v]) => v === "failed")
                    .map(([id]) => server?.branches.find((b) => b.id === id)?.name ?? id)
                    .join(" · ")}
                </p>
              </Notice>
            ) : null}
            {state === "stale" ? (
              <Notice kind="warning" title="أرصدة قديمة">
                <p className="acc-lead">من آخر مطابقة قبل ساعتين وقد بيع منها.</p>
                <p className="acc-choice__note">
                  <strong>الوقت مع الرقم</strong> · لا في الترويسة. صفحةٌ تُطبع للجرد تأخذ طابعها
                  معها.
                </p>
              </Notice>
            ) : null}
            {state === "offline" ? (
              <Notice kind="offline" title="أرصدة محلية">
                <p className="acc-lead">أرصدة هذا الجهاز وما زامنه، ومعها ما لم يُرفع.</p>
                <p className="acc-choice__note">
                  <strong>الفرق عن partial</strong> · هنا لا اتصال أصلاً؛ وهناك اتصالٌ ومواقع لم
                  تَرد. الأولى مفهومة والثانية تحتاج بياناً.
                </p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice
                kind="empty"
                title="لا أرصدة"
                action={
                  <>
                    <Button onClick={() => router.push("/inventory/openings")}>
                      أدخل افتتاحيات المخزون
                    </Button>
                    <Button variant="secondary" onClick={() => router.push("/inventory/receive")}>
                      استلم بضاعة
                    </Button>
                  </>
                }
              >
                <p className="acc-lead">كتالوجٌ فيه أصناف بلا رصيد — محلٌّ لم يُدخل افتتاحياته.</p>
                <p className="acc-choice__note">
                  <strong>المسار</strong> · «أدخل افتتاحيات المخزون» (INV-03) أو «استلم بضاعة»
                  (INV-04). والفراغ هنا بدايةٌ لا عطب.
                </p>
              </Notice>
            ) : null}

            <Table
              caption="أرصدة المخزون"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={state === "loading" && rows.length === 0 ? 3 : undefined}
              onOpenRow={open}
            />

            <div className="pos-inv__foot">
              <span className="acc-choice__note">
                آخر تحديث خادمي{" "}
                <span className="sting-mono">{server?.as_of ? hhmm(server.as_of) : "—"}</span>
                {pendingCount > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    {pendingCount === 1
                      ? "حركة واحدة معلقة"
                      : pendingCount === 2
                        ? "حركتان معلقتان"
                        : `${pendingCount} حركات معلقة`}{" "}
                    من هذا الجهاز داخلتان في الأرصدة.
                  </>
                ) : null}{" "}
                <strong>الرصيد السالب لا يمنع البيع</strong> — يعني أن بيعاً سُجّل قبل تسجيل
                الاستلام، والتسوية تتم بالجرد لا بالمنع.
              </span>
            </div>
            <p className="acc-choice__note">
              <strong>لا عمود «إجمالي القطع».</strong> جمع كراتين وأكياس وحبات في رقم واحد يحتاج
              معاملات تحويل لكل صنف، وبعضها تقديري. الإجماليات المعروضة بالقيمة المالية لا بالعدد.
            </p>
            <p className="acc-choice__note">
              <strong>معامل التحويل معلن ومحرَّر.</strong> «كرتونة = 12 حبة» رقم يكتبه صاحب المحل
              ويظهر في بطاقة الصنف. لا نستنتجه من اسم العبوة ولا من وزنها. الرصيد بوحدة البيع،
              والشراء يحوَّل بالمعامل المعلن عند الاستلام.
            </p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

function toRow(
  r: ServerRow,
  asOf: string,
  pend: { deltaMilli: bigint; count: number } | undefined,
): Row {
  const serverMilli = BigInt(r.qty_milli);
  const pendingMilli = pend?.deltaMilli ?? 0n;
  const qty = serverMilli + pendingMilli;
  const threshold = r.alert_threshold_milli ? BigInt(r.alert_threshold_milli) : null;
  return {
    id: r.item_id,
    name: r.name,
    serverMilli,
    pendingMilli,
    pendingCount: pend?.count ?? 0,
    qtyMilli: qty,
    saleUnit: r.sale_unit,
    purchase: r.purchase_unit,
    thresholdMilli: threshold,
    priceMissing: r.price_missing,
    lastAt: r.last_movement_at,
    asOf,
    tag: tagOf(qty, threshold, r.price_missing && !r.purchase_unit),
    quarantineMilli: BigInt(r.quarantine_milli || "0"),
    inTransitMilli: BigInt(r.in_transit_milli || "0"),
  };
}

/** بلا اتصال: أرصدة الجهاز (تشمل ما لم يُرفع لأن الحفظ المحلي يحرّكها) على أصناف الكتالوج المحلي. */
function localRowsOf(
  items: readonly LocalItem[],
  balances: Map<string, { readonly qty_milli: string; readonly as_of: string }>,
): Row[] {
  const out: Row[] = [];
  for (const it of items) {
    const b = balances.get(it.id);
    if (!b) continue;
    const units = [...it.units].sort((a, c) =>
      Number(BigInt(c.factor_milli) - BigInt(a.factor_milli)),
    );
    const top = units[0];
    const purchase =
      top && BigInt(top.factor_milli) !== 1000n
        ? {
            code: top.code,
            name: top.name,
            decimal_places: top.decimal_places ?? 0,
            factor_milli: top.factor_milli,
          }
        : null;
    const qty = BigInt(b.qty_milli);
    const threshold = it.alert_threshold_milli ? BigInt(it.alert_threshold_milli) : null;
    const priceMissing = BigInt(it.sale_price_minor || "0") <= 0n;
    out.push({
      id: it.id,
      name: it.name,
      serverMilli: qty,
      pendingMilli: 0n,
      pendingCount: 0,
      qtyMilli: qty,
      saleUnit: {
        code: it.base_unit_code,
        name: it.base_unit_name,
        decimal_places: it.base_unit_decimal_places ?? 0,
      },
      purchase,
      thresholdMilli: threshold,
      priceMissing,
      lastAt: "",
      asOf: b.as_of,
      tag: tagOf(qty, threshold, priceMissing && !purchase),
      quarantineMilli: 0n,
      inTransitMilli: 0n,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ar"));
}
