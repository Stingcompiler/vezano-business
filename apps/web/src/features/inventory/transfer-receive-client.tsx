"use client";

import {
  type LocalTransferReceipt,
  readLocalTransfers,
  saveTransferReceiptLocally,
} from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Notice,
  SyncIndicator,
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
import { dayMonth, hhmm } from "@/features/home/format";
import { PosNav } from "@/features/pos/pos-nav";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { branchTitle, type TransferView } from "./transfer-card";
import { parseQtyInput } from "./units";

type State = "ready" | "partial" | "validation_error" | "conflict" | "success";

interface Row {
  readonly id: string;
  readonly itemId: string;
  readonly name: string;
  readonly unit: string;
  readonly sentMilli: bigint;
  readonly draft: string;
  readonly receivedMilli: bigint | null;
  readonly valueMinor: bigint;
}

const REMAIN_WORDS = [
  "",
  "الواحد",
  "الاثنان",
  "الثلاثة",
  "الأربعة",
  "الخمسة",
  "الستة",
  "السبعة",
  "الثمانية",
  "التسعة",
  "العشرة",
] as const;

/** «الثلاثة الباقية» كما في الإطار — كلمةً حتى العشرة، وإلا رقمٌ داخل mono. */
function RemainWord({ milli }: { milli: bigint }) {
  const whole = milli % 1000n === 0n ? Number(milli / 1000n) : -1;
  const word = whole >= 1 && whole <= 10 ? REMAIN_WORDS[whole] : undefined;
  return word ? <>{word}</> : <span className="sting-mono">{formatQty(milli, 0)}</span>;
}

/**
 * INV-10 — استلام تحويل جزئي ومراجعة فرق (05-D2 partial · 40-D32 ready/validation_error/conflict/
 * success): عمودان — المُرسل كما ادّعاه المصدر وما تعدّه أنت (المُرسل معروض هنا بخلاف الجرد)؛ ما عُدّ
 * يدخل مخزونك، والفرق يبقى مفتوحاً على التحويل بسبب مكتوب حتى يقرّ المصدر أو يعترض — لا ترجيح؛ الزيادة
 * لا تُقبل صامتة (ACC-128)؛ الإشعار نفسه مرتين = استلام واحد (ACC-18).
 */
export function TransferReceiveClient({ transferId }: { transferId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [transfer, setTransfer] = useState<TransferView | null | undefined>(undefined);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<LocalTransferReceipt | null>(null);
  const ids = useRef<{ operationId: string; receiptId: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(
        `/login?next=${encodeURIComponent(`/inventory/transfers/${transferId}/receive`)}`,
      );
      return;
    }
    void (async () => {
      const storage = getStorage();
      setCtx(await readShiftContext(storage, app));
      try {
        const { data, response } = await api().GET("/api/inventory/transfers/{transfer_id}", {
          params: { path: { transfer_id: transferId } },
        });
        const body = data as unknown as { transfer: TransferView } | undefined;
        if (response.ok && body) {
          setTransfer(body.transfer);
          return;
        }
      } catch {
        /* بلا اتصال: من الإسقاط المحلي إن وصل عبر المزامنة */
      }
      const local = (await readLocalTransfers(storage)).find((t) => t.id === transferId);
      setTransfer(local ? { ...local, late: false } : null);
    })();
  }, [router, transferId]);

  useEffect(() => {
    if (transfer === null) router.replace("/inventory/transfers");
  }, [transfer, router]);

  const rows: Row[] = (transfer?.lines ?? []).map((l) => {
    const sent = BigInt(l.base_qty_milli);
    const draft = drafts[l.id] ?? formatQty(sent, 0);
    const q = parseQtyInput(draft);
    const val = BigInt(l.value_minor ?? "0");
    return {
      id: l.id,
      itemId: l.item_id,
      name: l.item_name,
      unit: l.unit_name,
      sentMilli: sent,
      draft,
      receivedMilli: q,
      valueMinor: sent > 0n ? val : 0n,
    };
  });
  const sentTotal = rows.reduce((a, r) => a + r.sentMilli, 0n);
  const receivedTotal = rows.reduce((a, r) => a + (r.receivedMilli ?? 0n), 0n);
  const diff = receivedTotal - sentTotal;
  const excess = rows.filter((r) => r.receivedMilli !== null && r.receivedMilli > r.sentMilli);
  const variance = rows.some((r) => r.receivedMilli !== null && r.receivedMilli !== r.sentMilli);
  const invalidQty = rows.some((r) => r.receivedMilli === null);
  const varianceValue = rows.reduce(
    (a, r) =>
      a +
      (r.receivedMilli !== null && r.sentMilli > 0n
        ? ((r.receivedMilli - r.sentMilli) * r.valueMinor) / r.sentMilli
        : 0n),
    0n,
  );
  const errors: Record<string, string> = {};
  if (invalidQty) errors["qty"] = "المستلم فعلياً";
  if (variance && !reason.trim()) errors["reason"] = "سبب الفرق — إلزامي";
  const invalid = Object.keys(errors).length > 0;
  const alreadyReceived =
    transfer?.status === "received" ||
    transfer?.status === "partially_received" ||
    transfer?.status === "cancelled";

  const state: State =
    phase === "saved"
      ? variance
        ? "conflict"
        : "success"
      : excess.length > 0 && !reason.trim()
        ? "validation_error"
        : variance
          ? "partial"
          : "ready";

  const confirm = async () => {
    if (!ctx || !transfer || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    if (!ids.current)
      ids.current = { operationId: crypto.randomUUID(), receiptId: crypto.randomUUID() };
    const { receipt } = await saveTransferReceiptLocally(getStorage(), {
      operationId: ids.current.operationId,
      receiptId: ids.current.receiptId,
      transferId: transfer.id,
      branchId: ctx.branchId,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      reason,
      lines: rows.map((r) => ({
        lineId: crypto.randomUUID(),
        movementId: crypto.randomUUID(),
        transferLineId: r.id,
        itemId: r.itemId,
        sentBaseMilli: r.sentMilli.toString(),
        receivedBaseMilli: (r.receivedMilli ?? 0n).toString(),
      })),
      receivedAt: new Date().toISOString(),
    });
    setSaved(receipt);
    if (!online) {
      setPush("pending");
      setPhase("saved");
      return;
    }
    try {
      const out = await pushPending();
      setPush(
        out.kind === "applied" || out.kind === "idle"
          ? "synced"
          : out.kind === "retry"
            ? "failed"
            : "pending",
      );
    } catch {
      setPush("failed");
    } finally {
      setPhase("saved");
    }
  };

  const step = (r: Row, delta: bigint) => {
    const cur = r.receivedMilli ?? 0n;
    const next = cur + delta * 1000n;
    if (next < 0n) return;
    setDrafts((d) => ({ ...d, [r.id]: formatQty(next, 0) }));
  };

  const columns = [
    { key: "item", header: "الصنف", render: (r: Row) => r.name },
    { key: "sent", header: "مُرسَل", mono: true, render: (r: Row) => formatQty(r.sentMilli, 0) },
    {
      key: "recv",
      header: "المستلم فعلياً",
      render: (r: Row) => (
        <div className="inv-stepper" role="group" aria-label={`عدّاد — ${r.name}`}>
          <button
            type="button"
            className="inv-stepper__btn"
            aria-label={`نقص — ${r.name}`}
            onClick={() => step(r, -1n)}
          >
            −
          </button>
          <input
            className="inv-stepper__input sting-mono"
            aria-label={`المستلم فعلياً — ${r.name}`}
            inputMode="decimal"
            value={r.draft}
            onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
            disabled={phase !== "idle"}
          />
          <button
            type="button"
            className="inv-stepper__btn"
            aria-label={`زيادة — ${r.name}`}
            onClick={() => step(r, 1n)}
          >
            +
          </button>
        </div>
      ),
    },
    {
      key: "diff",
      header: "فرق",
      render: (r: Row) => {
        if (r.receivedMilli === null) return "—";
        const d = r.receivedMilli - r.sentMilli;
        return (
          <span
            className={`sting-mono ${d < 0n ? "inv-delta--out" : d > 0n ? "inv-delta--in" : ""}`}
          >
            {d > 0n ? "+" : ""}
            {formatQty(d, 0)}
          </span>
        );
      },
    },
  ];

  const sent = transfer ? dayMonth(transfer.sent_at) : null;
  const unitName = rows[0]?.unit ?? "";

  return (
    <Frame
      title="المخزون"
      nav={<PosNav currentId="inventory" canSeeReports={ctx?.roleCode === "owner"} />}
      footer={null}
    >
      <div className="pos" data-screen="INV-10" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              استلام تحويل{" "}
              {transfer ? (
                <>
                  <span className="sting-mono">{transfer.transfer_number}</span> من{" "}
                  {branchTitle(transfer.branch_from_name)}
                </>
              ) : null}
            </h2>
            {transfer && sent ? (
              <span className="cat-head__hint">
                أُرسل <span className="sting-mono">{sent.day}</span> {sent.month}{" "}
                <span className="sting-mono">{hhmm(transfer.sent_at)}</span> · {transfer.user_name}
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {transfer && alreadyReceived && phase === "idle" ? (
              <Notice kind="info" title="استُلم التحويل">
                <p className="acc-lead">
                  إن وصل إشعار الاستلام نفسه مرتين — من جهازين أو بعد انقطاع — يُسجَّل استلام واحد.
                  الباقي المفتوح لا يتضاعف.
                </p>
              </Notice>
            ) : null}
            <div className="inv-tiles">
              <div className="inv-tile">
                <div className="acc-choice__note">مُرسَل</div>
                <div className="sting-mono inv-tile__v">{formatQty(sentTotal, 0)}</div>
              </div>
              <div className="inv-tile inv-tile--ok">
                <div className="acc-choice__note">مستلم الآن</div>
                <div className="sting-mono inv-tile__v">{formatQty(receivedTotal, 0)}</div>
              </div>
              <div className="inv-tile inv-tile--warn">
                <div className="acc-choice__note">فرق</div>
                <div className="sting-mono inv-tile__v">
                  {diff > 0n ? "+" : ""}
                  {formatQty(diff, 0)}
                </div>
              </div>
            </div>

            {state === "validation_error" && excess.length > 0 ? (
              <Notice kind="error" title="استلام يتجاوز المرسل">
                <p className="acc-lead">
                  عدُّ{" "}
                  <span className="sting-mono">{formatQty(excess[0]!.receivedMilli ?? 0n, 0)}</span>{" "}
                  والمرسل <span className="sting-mono">{formatQty(excess[0]!.sentMilli, 0)}</span>.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نقبل الزيادة صامتين</strong> · قد يكون خطأ عدٍّ أو إرسالاً زائداً.
                  تُسجَّل بسبب مكتوب وتُحال إلى مراجعة الفرق لا تُقبل بالسكوت.
                </p>
              </Notice>
            ) : null}

            <Table caption="سطور الاستلام" columns={columns} rows={rows} rowKey={(r) => r.id} />

            {phase !== "saved" ? (
              <>
                {variance ? (
                  <TextField
                    label="سبب الفرق — إلزامي"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    error={attempted ? errors["reason"] : undefined}
                    required
                  />
                ) : null}
                {variance && diff < 0n ? (
                  <Notice
                    kind="warning"
                    title={
                      <>
                        يدخل مخزونك{" "}
                        <span className="sting-mono">{formatQty(receivedTotal, 0)}</span> فقط.
                      </>
                    }
                  >
                    <p className="acc-lead">
                      <RemainWord milli={-diff} /> الباقية تبقى مفتوحة على التحويل حتى يقرّ{" "}
                      {transfer ? branchTitle(transfer.branch_from_name) : "المصدر"} بالفرق أو يعترض
                      — لا تُخصَم من مخزونه تلقائياً ولا تُضاف إلى مخزونك.
                    </p>
                  </Notice>
                ) : null}
                <p className="acc-choice__note">
                  إن وصل إشعار الاستلام نفسه مرتين — من جهازين أو بعد انقطاع — يُسجَّل استلام واحد.
                  الباقي المفتوح لا يتضاعف.
                </p>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void confirm()}
                    loading={phase === "saving"}
                    disabledReason={
                      !transfer
                        ? "جارٍ التحميل"
                        : alreadyReceived
                          ? "استُلم التحويل"
                          : attempted && invalid
                            ? "أكمل الحقول المطلوبة"
                            : undefined
                    }
                  >
                    تأكيد استلام <span className="sting-mono">{formatQty(receivedTotal, 0)}</span>
                    {variance ? " وفتح مراجعة الفرق" : ""}
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/inventory/transfers")}>
                    قائمة التحويلات
                  </Button>
                </div>
              </>
            ) : null}

            {phase === "saved" && saved ? (
              <>
                {state === "conflict" ? (
                  <Notice kind="warning" title="الفرعان يدّعيان رقمين">
                    <p className="acc-lead">
                      المصدر يقول أرسل <span className="sting-mono">{formatQty(sentTotal, 0)}</span>{" "}
                      والمستقبل عدّ{" "}
                      <span className="sting-mono">{formatQty(receivedTotal, 0)}</span>.{" "}
                      <span className="sting-mono">{formatQty(diff < 0n ? -diff : diff, 0)}</span>{" "}
                      {unitName} {diff < 0n ? "مفقودة" : "زائدة"} بين المخزنين.
                    </p>
                    <p className="acc-choice__note">
                      <strong>لا ترجيح</strong> · لا نأخذ رقم المرسل ولا المستلم. الفرق يُحجَز
                      بقيمته ويُراجَع بقرار — والبضاعة قد تكون في الشاحنة أو سُرقت.
                    </p>
                    <p className="acc-choice__note">
                      <strong>من يقرّر</strong> · المالك أو مدير أعلى من الفرعين. مديرُ أحدهما طرفٌ
                      في الخلاف لا حكم.
                    </p>
                    <p className="acc-choice__note">
                      الفرق المحجوز <span className="sting-mono">{formatQty(diff, 0)}</span>{" "}
                      {unitName} · بقيمة{" "}
                      <span className="sting-mono">
                        {formatMinor(
                          (varianceValue < 0n ? -varianceValue : varianceValue).toString(),
                        )}
                      </span>
                    </p>
                  </Notice>
                ) : null}
                <Notice kind="success" title="استُلم التحويل">
                  <p className="acc-lead">
                    ما دخل رصيدك ومصير الفرق: مغلقٌ بتسوية، أو محجوز للمراجعة.
                  </p>
                  <p className="acc-choice__note">
                    <strong>مخزون الطريق يُصفّى</strong> · ما استُلم يخرج من الطريق إلى الرصيد، وما
                    بقي يبقى في الطريق موسوماً — لا يتبخّر ولا يُحتسب مرتين.
                  </p>
                </Notice>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">الإشعار</span>
                    <span className="shift-facts__v sting-mono">{saved.receipt_number}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">دخل رصيدك</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{formatQty(receivedTotal, 0)}</span> {unitName}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">محجوز للمراجعة</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{formatQty(diff, 0)}</span> {unitName}
                    </span>
                  </div>
                </div>
                <SyncIndicator
                  state={!online ? "offline" : push === "synced" ? "synced" : "pending_sync"}
                  lastServerAt={push === "synced" ? hhmm(new Date().toISOString()) : null}
                  pendingCount={push === "synced" ? 0 : 1}
                  pendingLabel={(n) =>
                    n === 1 ? "عملية واحدة معلقة من هذا الجهاز" : `${n} عمليات معلقة من هذا الجهاز`
                  }
                />
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() => router.push(`/inventory/transfers?id=${transfer?.id ?? ""}`)}
                  >
                    قائمة التحويلات
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/inventory")}>
                    أرصدة المخزون
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
