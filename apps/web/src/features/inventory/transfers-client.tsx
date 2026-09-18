"use client";

import {
  type LocalTransfer,
  readLocalTransfers,
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
import { hhmm } from "@/features/home/format";
import { DayLabel } from "@/features/pos/invoices-client";
import { PosNav } from "@/features/pos/pos-nav";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

import { STATUS_LABEL, TransferCard, type TransferView } from "./transfer-card";

type State = "ready" | "loading" | "empty" | "partial" | "pending_sync";

interface ListData {
  readonly branch_id: string;
  readonly branches: readonly { readonly id: string; readonly name: string }[];
  readonly can_send: boolean;
  readonly awaiting_count: number;
  readonly partial_count: number;
  readonly transfers: readonly TransferView[];
  readonly as_of: string;
}

interface Row extends TransferView {
  readonly pending: boolean;
}

const CACHE_KEY = "transfers";

/**
 * INV-08 — قائمة التحويلات (40-D32 ready/loading/empty/partial · 14-D9 pending_sync): كل تحويل
 * بمرحلته وكميةُ الطريق معروضة صراحةً — مخزون الطريق لا يُحسب في رصيد الفرعين؛ نصف المستلم يبقى
 * مفتوحاً بالمتبقّي ولا يُغلق بالسهو؛ المحفوظ محلياً ولم يُرفع موسوم؛ مخوَّلة للفرعين والمالك.
 */
export function TransfersClient({ selectedId }: { selectedId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [data, setData] = useState<ListData | null>(null);
  const [cached, setCached] = useState<ListData | null>(null);
  const [local, setLocal] = useState<LocalTransfer[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = async () => {
    const storage = getStorage();
    const [cache, locals] = await Promise.all([
      readStockCache<ListData>(storage, CACHE_KEY),
      readLocalTransfers(storage),
    ]);
    setCached(cache);
    setLocal(locals);
    const pend = new Set<string>();
    await storage.read(async (tx) => {
      for (const t of locals) {
        const op = await tx.getOperation(t.operation_id);
        if (op && op.state !== "synced") pend.add(t.id);
      }
    });
    setPendingIds(pend);
    if (!navigator.onLine) {
      setFetching(false);
      return;
    }
    try {
      const { data, response } = await api().GET("/api/inventory/transfers", {});
      const body = data as unknown as ListData | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setData(body);
      await storeStockCache(storage, CACHE_KEY, body);
    } catch {
      setFailed(true);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finventory%2Ftransfers");
      return;
    }
    void (async () => {
      setCtx(await readShiftContext(getStorage(), app));
      await load();
    })();
  }, [router, online]);

  const server = data ?? cached;
  const serverIds = new Set((server?.transfers ?? []).map((t) => t.id));
  const rows: Row[] = [
    ...local
      .filter((t) => !serverIds.has(t.id) || pendingIds.has(t.id))
      .map((t): Row => ({ ...t, pending: true })),
    ...(server?.transfers ?? [])
      .filter((t) => !pendingIds.has(t.id))
      .map((t): Row => ({ ...t, pending: false })),
  ];
  const pendingCount = rows.filter((r) => r.pending).length;
  const partialCount = rows.filter((r) => r.status === "partially_received").length;
  const awaiting = rows.filter(
    (r) => r.status === "sent" || r.status === "partially_received",
  ).length;
  // بلا اختيار: بطاقة أول تحويل معلّق من هذا الجهاز (14-D9) — ما لم يُرفع يُعرض لا يُخفى
  const selected = rows.find((r) => r.id === selectedId) ?? rows.find((r) => r.pending) ?? null;

  const state: State =
    fetching && server === null && local.length === 0
      ? "loading"
      : rows.length === 0
        ? "empty"
        : pendingCount > 0
          ? "pending_sync"
          : partialCount > 0
            ? "partial"
            : "ready";

  const cancel = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const { response } = await api().POST("/api/inventory/transfers/{transfer_id}/cancel", {
        params: { path: { transfer_id: id } },
      });
      if (response.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: "number",
      header: "تحويل",
      render: (r: Row) => (
        <div>
          <Button
            variant="quiet"
            className="shift-row__open"
            onClick={() => router.push(`/inventory/transfers?id=${r.id}`)}
          >
            <span className="sting-mono">{r.transfer_number}</span>
          </Button>
          <div className="acc-choice__note">
            {r.branch_from_name} ← {r.branch_to_name}
          </div>
        </div>
      ),
    },
    {
      key: "sent",
      header: "أُرسل",
      render: (r: Row) => (
        <>
          <DayLabel iso={r.sent_at} now={new Date()} />{" "}
          <span className="sting-mono">{hhmm(r.sent_at)}</span>
        </>
      ),
    },
    {
      key: "status",
      header: "المرحلة",
      render: (r: Row) => (
        <Status
          state={
            r.pending
              ? "pending_sync"
              : r.status === "received"
                ? "synced"
                : r.status === "cancelled"
                  ? "empty"
                  : "pending_sync"
          }
          label={r.pending ? "معلّق هذا الجهاز" : STATUS_LABEL[r.status]}
          dot={false}
        />
      ),
    },
    {
      key: "transit",
      header: "في الطريق",
      render: (r: Row) => {
        const sent = r.lines.reduce((a, l) => a + BigInt(l.base_qty_milli), 0n);
        const rec = r.lines.reduce((a, l) => a + BigInt(l.received_base_milli), 0n);
        const transit = r.in_transit_milli !== undefined ? BigInt(r.in_transit_milli) : sent - rec;
        return (
          <>
            <span className="sting-mono">{formatQty(transit, 0)}</span>
            {r.late ? (
              <>
                {" "}
                <Status state="stale" label="تأخّر فوق 72 ساعة" dot={false} />
              </>
            ) : null}
          </>
        );
      },
    },
  ];

  const isOwner = ctx?.roleCode === "owner";

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={Boolean(isOwner)} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-08" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">التحويلات وحالاتها</h2>
            <span className="cat-head__hint">
              كل تحويل بمرحلته: أُرسل، في الطريق، استُلم، استُلم جزئياً. وكميةُ الطريق معروضة
              صراحةً.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__foot">
              <span className="acc-choice__note">
                ينتظر استلاماً <span className="sting-mono">{awaiting}</span>
                {failed ? " · المطابقة متعثّرة" : null}
              </span>
              <span className="pty-actions">
                <Button onClick={() => router.push("/inventory/transfers/new")}>
                  إنشاء وإرسال تحويل
                </Button>
              </span>
            </div>

            {state === "loading" ? (
              <Notice kind="info" title="جلب التحويلات">
                <p className="acc-lead">مع عدد ما ينتظر استلاماً — وهو سبب فتح الشاشة.</p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice
                kind="empty"
                title="لا تحويلات"
                action={
                  <Button onClick={() => router.push("/inventory/transfers/new")}>
                    إنشاء وإرسال تحويل
                  </Button>
                }
              >
                <p className="acc-lead">فرعٌ واحد أو لا نقل بين الفروع.</p>
                <p className="acc-choice__note">
                  <strong>لا اقتراح</strong> · التحويل قرار تشغيلي. اقتراحه من قائمة فارغة عبث.
                </p>
              </Notice>
            ) : null}
            {state === "partial" ? (
              <Notice kind="warning" title="تحويلات نصف مستلمة">
                <p className="acc-lead">
                  <span className="sting-mono">{partialCount}</span> تحويلات استُلم بعض سطورها —
                  والباقي في الطريق أو مفقود.
                </p>
                <p className="acc-choice__note">
                  <strong>لا يُغلق بالسهو</strong> · التحويل يبقى مفتوحاً بالمتبقّي حتى يُستلم أو
                  يُلغى بقرار. والإغلاق التلقائي يُبخّر الفرق.
                </p>
              </Notice>
            ) : null}

            {selected ? (
              <TransferCard
                t={selected}
                pending={selected.pending}
                onReceive={
                  !selected.pending && (isOwner || selected.branch_to_id === ctx?.branchId)
                    ? () => router.push(`/inventory/transfers/${selected.id}/receive`)
                    : undefined
                }
                onCancel={
                  !selected.pending && (isOwner || selected.branch_from_id === ctx?.branchId)
                    ? () => void cancel(selected.id)
                    : undefined
                }
                cancelDisabledReason={selected.pending ? "بانتظار الرفع" : undefined}
              />
            ) : null}

            <Table
              caption="التحويلات"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={state === "loading" ? 3 : undefined}
              onOpenRow={(r) => router.push(`/inventory/transfers?id=${r.id}`)}
            />
            <p className="acc-choice__note">
              <strong>مخزون الطريق</strong> · لا يُحسب في رصيد الفرعين. إهماله يُفقد بضاعةً من
              الدفتر؛ وعدّه مرتين يضاعفها.
            </p>
          </div>
        </div>
      </div>
    </Frame>
  );
}
