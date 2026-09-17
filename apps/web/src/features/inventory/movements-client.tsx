"use client";

import {
  type PendingStockMovement,
  readLocalItems,
  readPendingStockMovements,
  readReturns,
  readSales,
  readStockCache,
  storeStockCache,
} from "@sting/sync-core";
import { Button, formatQty, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import "@/features/inventory/inventory.css";
import { agoParts, dayMonth } from "@/features/home/format";
import { PosNav } from "@/features/pos/pos-nav";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "pending_sync" | "stale";
type Range = "30" | "all";
type Dp = 0 | 1 | 2 | 3;

interface ServerRow {
  readonly id: string;
  readonly occurred_at: string;
  readonly reason: string;
  readonly label: string;
  readonly actor: string;
  readonly doc: string;
  readonly delta_milli: string;
  readonly balance_after_milli: string;
}

interface Movements {
  readonly item: {
    readonly id: string;
    readonly name: string;
    readonly sale_unit: {
      readonly code: string;
      readonly name: string;
      readonly decimal_places: Dp;
    };
  };
  readonly branch_id: string;
  readonly branch_name: string;
  readonly range: Range;
  readonly as_of: string;
  readonly rows: readonly ServerRow[];
  readonly balance_milli: string;
  readonly total_count: number;
  readonly last_movement_at: string;
}

interface Row {
  readonly id: string;
  readonly at: string;
  readonly label: string;
  readonly who: string;
  readonly doc: string;
  readonly deltaMilli: bigint;
  readonly balanceMilli: bigint | null;
  readonly phase: "confirmed" | "pending";
}

const REASON_LABELS: Record<string, string> = {
  sale: "بيع نقطة بيع",
  return: "مرتجع زبون",
  return_damaged: "مرتجع زبون",
  reversal: "عكس بيع مكرَّر",
  receive: "استلام بضاعة",
  count: "تسوية جرد",
  transfer_out: "تحويل صادر",
  transfer_in: "تحويل وارد",
  opening: "افتتاحية",
};

/** «13/09 14:22» بأرقام لاتينية داخل mono (28-D21). */
function when(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const cacheKey = (itemId: string, branchId: string, range: Range) =>
  `movements.${itemId}.${branchId}.${range}`;

/**
 * INV-02 — سجل حركة الصنف (28-D21 ready/pending_sync/stale · 40-D32 loading/empty): الجواب على
 * «كيف صار الرصيد كذا» — لا سطر بلا مصدر ومستند؛ الرصيد يفصل «مؤكَّد خادمياً» عن «معلّق هذا
 * الجهاز» برقمين (SYS-03)؛ الصفوف المعلّقة لا تُخفى ولا تُخلط؛ «لم يتحرّك بعد» غير «لا حركة في
 * هذا المدى».
 */
export function MovementsClient({
  itemId,
  branchId: wanted,
  range: initialRange,
}: {
  itemId: string;
  branchId: string;
  range: Range;
}) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [range, setRange] = useState<Range>(initialRange);
  const [data, setData] = useState<Movements | null>(null);
  const [cached, setCached] = useState<Movements | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [pendingRows, setPendingRows] = useState<Row[]>([]);
  const [pendingDelta, setPendingDelta] = useState(0n);
  const [itemName, setItemName] = useState("");
  const appRef = useRef(app);
  appRef.current = app;
  const branchId = wanted || ctx?.branchId || "";

  useEffect(() => {
    const app = appRef.current;
    const here = `/inventory/items/${itemId}?branch=${wanted}&range=${initialRange}`;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const c = await readShiftContext(storage, app);
      setCtx(c);
      const items = await readLocalItems(storage);
      setItemName(items.find((i) => i.id === itemId)?.name ?? "");
    })();
  }, [router, itemId, wanted, initialRange]);

  useEffect(() => {
    if (!branchId) return;
    let alive = true;
    setFetching(true);
    setFailed(false);
    setData(null);
    void (async () => {
      const storage = getStorage();
      const [cache, moves, sales, returns] = await Promise.all([
        readStockCache<Movements>(storage, cacheKey(itemId, branchId, range)),
        readPendingStockMovements(storage),
        readSales(storage),
        readReturns(storage),
      ]);
      if (!alive) return;
      setCached(cache);
      const mine = moves.filter((m) => m.itemId === itemId && m.branchId === branchId);
      const docOf = (m: PendingStockMovement): { doc: string; who: string } => {
        if (m.sourceEntity === "sales.Sale") {
          const s = sales.find((x) => x.id === m.sourceId);
          return { doc: s?.invoice_number ?? "", who: s?.user_name ?? "" };
        }
        if (m.sourceEntity === "sales.SaleReturn") {
          const r = returns.find((x) => x.id === m.sourceId);
          return { doc: r?.return_number ?? "", who: r?.user_name ?? "" };
        }
        return { doc: "", who: "" };
      };
      setPendingRows(
        mine
          .map((m): Row => ({
            id: m.movementId,
            at: m.occurredAt,
            label: REASON_LABELS[m.reason] ?? m.reason,
            ...docOf(m),
            deltaMilli: m.deltaMilli,
            balanceMilli: null,
            phase: "pending",
          }))
          .reverse(),
      );
      setPendingDelta(mine.reduce((a, m) => a + m.deltaMilli, 0n));
      if (!navigator.onLine) {
        setFetching(false);
        return;
      }
      try {
        const { data, response } = await api().GET("/api/inventory/items/{item_id}/movements", {
          params: { path: { item_id: itemId }, query: { branch_id: branchId, range } },
        });
        if (!alive) return;
        const body = data as unknown as Movements | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        await storeStockCache(storage, cacheKey(itemId, branchId, range), body);
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setFetching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [itemId, branchId, range, online]);

  const server = data ?? cached;
  const dp: Dp = server?.item.sale_unit.decimal_places ?? 0;
  const confirmed: Row[] = (server?.rows ?? [])
    .map((r): Row => ({
      id: r.id,
      at: r.occurred_at,
      label: r.label,
      who: r.actor,
      doc: r.doc,
      deltaMilli: BigInt(r.delta_milli),
      balanceMilli: BigInt(r.balance_after_milli),
      phase: "confirmed",
    }))
    .reverse();
  const rows = [...pendingRows, ...confirmed];
  const serverBalance = server ? BigInt(server.balance_milli) : null;
  const staleData = !online || failed;

  // «جلب الحركات» مع كل جلب — اللقطة السابقة تعطي عدد الحركات المتوقَّع
  const state: State = staleData
    ? "stale"
    : fetching && data === null
      ? "loading"
      : rows.length === 0
        ? "empty"
        : pendingRows.length > 0
          ? "pending_sync"
          : "ready";

  const columns = [
    {
      key: "when",
      header: "الوقت",
      mono: true,
      render: (r: Row) => when(r.at),
    },
    {
      key: "src",
      header: "المصدر",
      render: (r: Row) => (
        <div>
          <div>{r.label}</div>
          <div className="acc-choice__note">{r.who || "—"}</div>
        </div>
      ),
    },
    { key: "doc", header: "المستند", mono: true, render: (r: Row) => r.doc || "—" },
    {
      key: "delta",
      header: "الحركة",
      render: (r: Row) => (
        <span className={`sting-mono ${r.deltaMilli < 0n ? "inv-delta--out" : "inv-delta--in"}`}>
          {r.deltaMilli > 0n ? "+" : ""}
          {formatQty(r.deltaMilli, dp)}
        </span>
      ),
    },
    {
      key: "bal",
      header: "الرصيد بعدها",
      mono: true,
      // المعلّق بلا «رصيد بعدها» — لا يُخلط بالمؤكَّد (SYS-03)
      render: (r: Row) => (r.balanceMilli === null ? "—" : formatQty(r.balanceMilli, dp)),
    },
    {
      key: "phase",
      header: "الطور",
      render: (r: Row) => (
        <Status
          state={r.phase === "pending" ? "pending_sync" : "synced"}
          label={r.phase === "pending" ? "معلّق هذا الجهاز" : "مؤكَّد"}
          dot={false}
        />
      ),
    },
  ];

  const name = server?.item.name || itemName;
  const unit = server?.item.sale_unit.name ?? "";
  const branchName = server?.branch_name ?? ctx?.branchName ?? "";
  const ago = server ? agoParts(server.as_of) : null;
  const last = server?.last_movement_at ? dayMonth(server.last_movement_at) : null;

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={Boolean(ctx?.roleCode === "owner")} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">سجل حركة الصنف</h2>
            <span className="cat-head__hint">
              هذا هو الجواب على «كيف صار الرصيد كذا». لا سطر بلا مستند، والحركات المحفوظة محلياً
              معلَّمة بصراحة فلا تُقرأ كمؤكَّدة.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="inv-head">
              <div>
                <h3 className="cat-head__title">
                  {name}
                  {unit ? <> — {unit}</> : null}
                  {branchName ? <> · {branchName}</> : null}
                </h3>
                <div className="acc-choice__note">
                  الرصيد الحالي{" "}
                  <span className="sting-mono">
                    {serverBalance === null ? "—" : formatQty(serverBalance + pendingDelta, dp)}
                  </span>
                  {pendingRows.length > 0 ? (
                    <>
                      {" "}
                      · منه <span className="sting-mono">{formatQty(pendingDelta, dp)}</span> من
                      حركات لم تُرفع بعد
                    </>
                  ) : null}
                </div>
              </div>
              <span className="inv-head__chip">
                <Status
                  state={staleData ? "stale" : "synced"}
                  label={
                    ago ? (
                      <>
                        آخر تحديث خادمي قبل <span className="sting-mono">{ago.n}</span>{" "}
                        {ago.unit === "minute" ? "دقيقة" : ago.unit === "hour" ? "ساعة" : "يوم"}
                      </>
                    ) : (
                      "لا تحديث خادمي بعد"
                    )
                  }
                  dot={false}
                />
              </span>
            </div>
            <div className="cat-form__actions">
              <Button
                variant="secondary"
                onClick={() => router.push(`/inventory/items/${itemId}/damage`)}
              >
                تسجيل التالف
              </Button>
            </div>
            <div className="pos-chips" role="group" aria-label="المدى">
              {(
                [
                  ["30", "30 يوماً"],
                  ["all", "كل الحركات"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`pos-chip${range === id ? " pos-chip--on" : ""}`}
                  aria-pressed={range === id}
                  onClick={() => setRange(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {state === "loading" ? (
              <Notice kind="info" title="جلب الحركات">
                <p className="acc-lead">مع المدى وعدد الحركات المتوقَّع.</p>
                <p className="acc-choice__note">
                  المدى {range === "all" ? "كل الحركات" : <span className="sting-mono">30</span>}
                  {cached ? (
                    <>
                      {" "}
                      · الحركات المتوقَّعة <span className="sting-mono">{cached.rows.length}</span>
                    </>
                  ) : null}
                </p>
              </Notice>
            ) : null}
            {state === "stale" ? (
              <Notice kind={online ? "warning" : "offline"} title="آخر تحديث خادمي">
                <p className="acc-lead">
                  الحركات المحفوظة محلياً معلَّمة بصراحة فلا تُقرأ كمؤكَّدة.
                </p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice
                kind="empty"
                title="لا حركة"
                action={
                  <Button variant="secondary" onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                }
              >
                <p className="acc-lead">
                  {server && server.total_count > 0 && last ? (
                    <>
                      لا حركة في هذا المدى — آخرها <span className="sting-mono">{last.day}</span>{" "}
                      {last.month}
                    </>
                  ) : (
                    "الصنف لم يتحرّك بعد"
                  )}
                </p>
                <p className="acc-choice__note">
                  <strong>نفرّق</strong> · «الصنف لم يتحرّك بعد» تختلف عن «لا حركة في هذا المدى —
                  آخرها 12 سبتمبر». الأولى عن الصنف والثانية عن المرشّح.
                </p>
              </Notice>
            ) : null}

            <Table
              caption="سجل الحركة"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={state === "loading" && rows.length === 0 ? 3 : undefined}
            />
            <p className="acc-choice__note">
              <strong>الصفوف المعلّقة لا تُخفى ولا تُخلط.</strong> الرصيد المعروض يفصل «مؤكَّد
              خادمياً» عن «معلّق هذا الجهاز» برقمين، لأن دمجهما في رقم واحد يعطي التاجر ثقة لا أساس
              لها عند تعارض لاحق (SYS-03).
            </p>
          </div>
        </div>
      </div>
    </Frame>
  );
}
