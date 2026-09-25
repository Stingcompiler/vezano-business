"use client";

import {
  bankReferenceUsed,
  type LocalParty,
  type LocalReceipt,
  type LocalShift,
  readLocalParties,
  readOpenShift,
  readPartyPendingCredit,
  type ReceiptKind,
  type ReceiptMethod,
  saveReceiptLocally,
} from "@sting/sync-core";
import {
  Button,
  formatMinor,
  Frame,
  Notice,
  RadioGroupField,
  SyncIndicator,
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
import { hhmm } from "@/features/home/format";
import { PosNav } from "@/features/pos/pos-nav";
import { parseAmount, today } from "@/features/pos/use-sale";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

type State =
  "ready" | "validation_error" | "saving" | "saved_local" | "success" | "permission_denied";

/** نصّ رفض المرجع المستهلَك (ACC-15) — خطأ الحقل وعنوان التنبيه معاً. */
const REF_USED_TEXT = "مرجع تحويل لا يُستهلك مرتين";

/**
 * PTY-06 — تسجيل سداد أو ردّ مبلغ (04-D2 ready · 33-D25 validation_error/saving/saved_local/
 * success/permission_denied): بحث ثم مبلغ ثم حفظ (§١٤.١)؛ يخفض التراكمي دون توزيع على فواتير
 * (ACC-79)؛ النقد يدخل صندوق الوردية المفتوحة فوراً (SHIFT-02)؛ التحويل البنكي «مسجَّل — غير مطابق»
 * لا يُسقط الذمّة حتى المطابقة (ACC-133) ومرجعه لا يُستهلك مرتين (ACC-15)؛ الكاشير يقبض ولا يردّ.
 */
export function PaymentClient({ partyId }: { partyId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [party, setParty] = useState<LocalParty | null | undefined>(undefined);
  const [pending, setPending] = useState(0n);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [kind, setKind] = useState<ReceiptKind>("receipt");
  const [method, setMethod] = useState<ReceiptMethod>("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [refUsed, setRefUsed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [denied, setDenied] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [push, setPush] = useState<"none" | "synced" | "pending" | "failed">("none");
  const [saved, setSaved] = useState<LocalReceipt | null>(null);
  const ids = useRef<{ operationId: string; receiptId: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/parties/${partyId}/payment`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [parties, s, c, pend] = await Promise.all([
        readLocalParties(storage),
        readOpenShift(storage),
        readShiftContext(storage, app),
        readPartyPendingCredit(storage, partyId),
      ]);
      setParty(parties.find((p) => p.id === partyId) ?? null);
      setShift(s);
      setCtx(c);
      setPending(pend.pendingMinor);
    })();
  }, [partyId, router]);

  useEffect(() => {
    if (party === null) router.replace("/parties");
  }, [party, router]);

  useEffect(() => {
    if (method !== "bank" || !reference.trim()) {
      setRefUsed(false);
      return;
    }
    void bankReferenceUsed(getStorage(), reference).then(setRefUsed);
  }, [method, reference]);

  const isOwner = ctx?.roleName === "مالك" || ctx?.roleCode === "owner";
  const canRefund = isOwner || ctx?.roleCode === "manager";
  const serverBalance = BigInt(party?.balance_minor || "0");
  const before = serverBalance + pending;
  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || amountMinor === null || amountMinor <= 0n) errors["amount"] = "مبلغ موجب";
  if (method === "bank" && !reference.trim()) errors["reference"] = "مرجع التحويل — إلزامي";
  // المرجع المستهلَك يُعرَف بعَلَم لا بنصّ الخطأ — النص للمستخدم ولا يحمل رموزاً داخلية
  const refDuplicate = method === "bank" && refUsed;
  if (refDuplicate) errors["reference"] = REF_USED_TEXT;
  if (kind === "refund" && !reason.trim()) errors["reason"] = "يُطلب سبب";
  const invalid = Object.keys(errors).length > 0;
  // النقد يؤثر فوراً؛ التحويل غير المطابق لا يغيّر الرصيد
  const effect =
    method === "bank" || !amountMinor || amountMinor <= 0n
      ? 0n
      : kind === "receipt"
        ? -amountMinor
        : amountMinor;
  const after = before + effect;

  const state: State = denied
    ? "permission_denied"
    : phase === "saving"
      ? "saving"
      : phase === "saved"
        ? push === "synced"
          ? "success"
          : "saved_local"
        : attempted && invalid
          ? "validation_error"
          : "ready";

  const commit = async () => {
    if (!party || !shift || !ctx || phase !== "idle") return;
    setAttempted(true);
    if (invalid) return;
    setPhase("saving");
    if (!ids.current)
      ids.current = { operationId: crypto.randomUUID(), receiptId: crypto.randomUUID() };
    const { receipt } = await saveReceiptLocally(getStorage(), {
      operationId: ids.current.operationId,
      receiptId: ids.current.receiptId,
      partyId: party.id,
      partyName: party.name,
      partyOperationId: party.operation_id,
      kind,
      method,
      amountMinor: (amountMinor ?? 0n).toString(),
      reference,
      reason,
      shift,
      branchCode: ctx.branchCode || "BR",
      devicePrefix: ctx.devicePrefix || "X",
      deviceId: ctx.deviceId,
      userId: ctx.userId,
      userName: ctx.userName,
      businessDate: shift.business_date || today(),
      occurredAt: new Date().toISOString(),
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

  const title =
    kind === "receipt" ? (method === "cash" ? "— سداد نقدي" : "— تحويل غير مطابق") : "— ردّ مبلغ";

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={isOwner} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تسجيل سداد أو رد مبلغ {title}</h2>
            <span className="cat-head__hint">
              وسيلة ومرجع وصلاحية وإيصال. التحويل البنكي لا يُسقط الذمة حتى المطابقة.
            </span>
          </div>
          {party ? (
            <div className="acc-card__body">
              {phase !== "saved" ? (
                <div className="pos-chips" role="group" aria-label="نوع السند">
                  <button
                    type="button"
                    className={`pos-chip${kind === "receipt" ? " pos-chip--on" : ""}`}
                    aria-pressed={kind === "receipt"}
                    onClick={() => {
                      setKind("receipt");
                      setDenied(false);
                    }}
                  >
                    سداد
                  </button>
                  <button
                    type="button"
                    className={`pos-chip${kind === "refund" ? " pos-chip--on" : ""}${canRefund ? "" : " pos-chip--restricted"}`}
                    aria-pressed={kind === "refund"}
                    onClick={() => {
                      if (canRefund) setKind("refund");
                      else setDenied(true);
                    }}
                  >
                    ردّ مبلغ
                  </button>
                </div>
              ) : null}

              {state === "permission_denied" ? (
                <Notice kind="locked" title="الكاشير يقبض ولا يردّ">
                  <p className="acc-lead">
                    القبض يزيد النقد والردّ يُخرجه. الفعلان متعاكسان في الأثر فلا يتساويان في
                    الصلاحية.
                  </p>
                  <p className="acc-choice__note">
                    <strong>نُظهر</strong> · تبويب «ردّ مبلغ» معطّلاً بسببه لا محذوفاً — الكاشير
                    يعرف أن المسار موجود ويُطلب.
                  </p>
                  <p className="acc-choice__note">
                    «اطلب من {ctx?.ownerName || "المالك"}» بالمبلغ والسبب والطرف، فتوافق من جهازها
                    ويُنسب الردّ إليها.
                  </p>
                </Notice>
              ) : null}

              {phase !== "saved" ? (
                <>
                  <h3 className="pos-credit__title">
                    {kind === "receipt" ? "سداد من" : "ردّ مبلغ إلى"} {party.name}
                  </h3>
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">عليه الآن</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(before.toString())}
                      </span>
                    </div>
                  </div>
                  {pending !== 0n ? (
                    <p className="acc-choice__note">
                      خادمي{" "}
                      <span className="sting-mono">{formatMinor(serverBalance.toString())}</span>{" "}
                      {pending > 0n ? "+" : "−"} معلّق هذا الجهاز{" "}
                      <span className="sting-mono">
                        {formatMinor((pending > 0n ? pending : -pending).toString())}
                      </span>{" "}
                      = <span className="sting-mono">{formatMinor(before.toString())}</span>
                    </p>
                  ) : null}
                  <TextField
                    label={kind === "receipt" ? "المبلغ المسدَّد" : "المبلغ المردود"}
                    mono
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    error={attempted ? errors["amount"] : undefined}
                    required
                  />
                  <RadioGroupField
                    label="الوسيلة"
                    name="m1"
                    value={method}
                    onChange={(v) => setMethod(v as ReceiptMethod)}
                    options={[
                      { value: "cash", label: "نقداً" },
                      { value: "bank", label: "تحويل بنكي" },
                    ]}
                  />
                  {method === "bank" ? (
                    <>
                      <TextField
                        label="مرجع التحويل — إلزامي"
                        mono
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        error={attempted ? errors["reference"] : undefined}
                        required
                      />
                      <Notice kind="warning" title="مسجَّل — غير مطابق">
                        <p className="acc-lead">
                          رفع الإيصال لا يعني وصول المبلغ. تبقى ذمة العميل{" "}
                          <span className="sting-mono">{formatMinor(before.toString())}</span> حتى
                          تؤكد الاستلام في كشف البنك، ثم يُسقط الدين بفعل صريح.
                        </p>
                      </Notice>
                    </>
                  ) : null}
                  {kind === "refund" ? (
                    <>
                      <TextField
                        label="السبب"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        error={attempted ? errors["reason"] : undefined}
                        required
                      />
                      <p className="acc-choice__note">
                        الردّ يطلب سبباً مكتوباً دائماً، ولو نفّذه المالك بنفسه.
                      </p>
                    </>
                  ) : null}
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">
                        <strong>
                          {method === "bank" ? "الرصيد بعد التسجيل" : "الرصيد بعد السداد"}
                        </strong>
                      </span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(after.toString())}
                      </span>
                    </div>
                  </div>
                  {method === "bank" ? (
                    <p className="acc-choice__note">— لا يتغير</p>
                  ) : (
                    <p className="acc-choice__note">
                      النقد {kind === "receipt" ? "يدخل" : "يخرج من"} صندوق الوردية المفتوحة فوراً
                      ويظهر في «الوردية».
                    </p>
                  )}
                  {state === "validation_error" && refDuplicate ? (
                    <Notice kind="error" title={REF_USED_TEXT}>
                      <p className="acc-lead">
                        المرجع <span className="sting-mono">{reference.trim()}</span> مسجَّل على سند
                        أو فاتورة أخرى على هذا الجهاز.
                      </p>
                    </Notice>
                  ) : null}
                  <div className="cat-form__actions">
                    <Button
                      financial
                      pos
                      onClick={() => void commit()}
                      loading={phase === "saving"}
                      disabledReason={
                        !shift
                          ? "لا وردية مفتوحة — النقد يدخل صندوق الوردية"
                          : attempted && invalid
                            ? "أكمل الحقول المطلوبة"
                            : undefined
                      }
                    >
                      {method === "bank"
                        ? "تسجيل التحويل بانتظار المطابقة"
                        : kind === "receipt"
                          ? "تسجيل السداد وطباعة إيصال"
                          : "تسجيل الردّ وطباعة إيصال"}
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/parties/${party.id}/statement`)}
                    >
                      كشف الحساب
                    </Button>
                  </div>
                </>
              ) : null}

              {state === "saving" ? (
                <Notice kind="info" title="جارٍ الحفظ">
                  <p className="acc-lead">
                    الحفظ والطباعة منفصلان هنا أيضاً: يُحفظ السند ثم يُطبع. لا تُطبع ورقة على شيء لم
                    يُحفظ.
                  </p>
                </Notice>
              ) : null}

              {phase === "saved" && saved ? (
                <>
                  {state === "success" ? (
                    <Notice kind="success" title="سُجّل السداد">
                      <p className="acc-lead">
                        سند <span className="sting-mono">{saved.receipt_number}</span> · رقم نهائي
                        وطباعة جاهزة. نسخة للطرف ونسخة تبقى في المستندات.
                      </p>
                      <p className="acc-choice__note">
                        <strong>لا يُحذف</strong> · التصحيح بسند عكس يشير إليه. سندُ قبضٍ يختفي يعني
                        مالاً قُبض ولا أثر له.
                      </p>
                    </Notice>
                  ) : (
                    <Notice kind="offline" title="سُجّل بلا اتصال">
                      <p className="acc-lead">
                        السداد محفوظ على الجهاز بسند مؤقت. رصيد الطرف يُحدَّث محلياً ويُوسم «غير
                        مزامن».
                      </p>
                      <p className="acc-choice__note">
                        <strong>الخطر</strong> · قد يكون الطرف قد سدّد في فرع آخر في الوقت نفسه.
                        الكشف يُظهر السند المؤقت بوسمه حتى تتم المزامنة ويُطابَق.
                      </p>
                    </Notice>
                  )}
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">السند</span>
                      <span className="shift-facts__v sting-mono">{saved.receipt_number}</span>
                    </div>
                    <div>
                      <span className="shift-facts__k">المبلغ</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(saved.amount_minor)}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">الوسيلة</span>
                      <span className="shift-facts__v">
                        {saved.method === "cash" ? "نقداً" : "تحويل بنكي · مسجَّل — غير مطابق"}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">رصيد الطرف</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(after.toString())}
                      </span>
                    </div>
                  </div>
                  <SyncIndicator
                    state={!online ? "offline" : push === "synced" ? "synced" : "pending_sync"}
                    lastServerAt={push === "synced" ? hhmm(new Date().toISOString()) : null}
                    pendingCount={push === "synced" ? 0 : 1}
                    pendingLabel={(n) =>
                      n === 1
                        ? "عملية واحدة معلقة من هذا الجهاز"
                        : `${n} عمليات معلقة من هذا الجهاز`
                    }
                  />
                  <p className="acc-choice__note">
                    المسار التالي: اطبع، أو سجّل سداداً لطرف آخر — لا عودة إلى نموذج فارغ بلا سياق.
                  </p>
                  <div className="cat-form__actions">
                    <Button onClick={() => window.print()} pos>
                      اطبع
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/parties/${party.id}/statement`)}
                    >
                      كشف الحساب
                    </Button>
                    <Button variant="quiet" onClick={() => router.push("/parties")}>
                      طرف آخر
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
