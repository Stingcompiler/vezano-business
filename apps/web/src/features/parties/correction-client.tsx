"use client";

import { storeParties } from "@sting/sync-core";
import {
  Button,
  formatMinor,
  Frame,
  Notice,
  RadioGroupField,
  SelectField,
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
import { dayMonth } from "@/features/home/format";
import { PosNav } from "@/features/pos/pos-nav";
import { parseAmount } from "@/features/pos/use-sale";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

type State = "ready" | "validation_error" | "permission_denied" | "success";
type Kind = "method" | "reverse" | "amount" | "date";

interface Context {
  readonly receipt: {
    readonly id: string;
    readonly receipt_number: string;
    readonly party_id: string;
    readonly kind: "receipt" | "refund";
    readonly method: "cash" | "bank";
    readonly amount_minor: string;
    readonly reference: string;
    readonly reason: string;
    readonly user_name: string;
    readonly business_date: string;
  };
  readonly effective: {
    readonly method: "cash" | "bank";
    readonly reference: string;
    readonly amount_minor: string;
    readonly business_date: string;
    readonly reversed: boolean;
    readonly effective: boolean;
  };
  readonly corrections: readonly { readonly id: string; readonly kind: Kind }[];
  readonly party: { readonly id: string; readonly name: string; readonly balance_minor: string };
  readonly locked_before: string;
}

interface Result {
  readonly correction: { readonly id: string; readonly kind: Kind; readonly occurred_at: string };
  readonly party: { readonly id: string; readonly name: string; readonly balance_minor: string };
}

const KINDS: readonly { readonly value: Kind; readonly label: string }[] = [
  { value: "method", label: "تصحيح وسيلة الدفع" },
  { value: "reverse", label: "عكس الحركة بالكامل" },
  { value: "amount", label: "تصحيح المبلغ" },
  // الشاشة اسمها «تصحيح تاريخ الأعمال» وحالتاها في 40-D32 عن التاريخ — الخيار الرابع باسمها (§٢٩)
  { value: "date", label: "تصحيح تاريخ الأعمال" },
];

/**
 * PTY-09 — تصحيح تاريخ الأعمال (04-D2 ready · 40-D32 validation_error/permission_denied/success):
 * الأصل ثابت والتصحيح مستند مستقل مرتبط به بسبب واضح وهوية منفّذ؛ للمالك وحده؛ تاريخ داخل فترة
 * مقفلة يُمنع ويُقال السبب؛ الأثر يُعلَن بعد الحفظ (رصيد الطرف كما هو أو تغيّر).
 */
export function CorrectionClient({ receiptId }: { receiptId: string }) {
  const router = useRouter();
  const app = useApp();
  const [ctx, setCtx] = useState<Context | null | undefined>(undefined);
  const [denied, setDenied] = useState(false);
  const [kind, setKind] = useState<Kind>("method");
  const [method, setMethod] = useState<"cash" | "bank">("bank");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ field: string; code: string } | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/parties/receipts/${receiptId}/correct`)}`);
      return;
    }
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/parties/receipts/{receipt_id}/correct", {
          params: { path: { receipt_id: receiptId } },
        });
        if (response.status === 403) {
          setDenied(true);
          setCtx(null);
          return;
        }
        const body = data as unknown as Context | undefined;
        if (!response.ok || !body) {
          setCtx(null);
          return;
        }
        setCtx(body);
        setMethod(body.effective.method === "cash" ? "bank" : "cash");
      } catch {
        setCtx(null);
      }
    })();
  }, [receiptId, router]);

  useEffect(() => {
    if (ctx === null && !denied) router.replace("/parties");
  }, [ctx, denied, router]);

  const eff = ctx?.effective;
  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!reason.trim()) errors["reason"] = "السبب — إلزامي ويظهر في سجل التدقيق";
  if (kind === "method" && method === "bank" && !reference.trim())
    errors["reference"] = "مرجع التحويل — إلزامي";
  if (kind === "amount" && (!amount.trim() || amountMinor === null || amountMinor <= 0n))
    errors["amount"] = "مبلغ موجب";
  if (kind === "date") {
    if (!date) errors["date"] = "تاريخ الأعمال";
    else if (ctx && eff && (date < ctx.locked_before || eff.business_date < ctx.locked_before))
      errors["date"] = "تاريخ داخل فترة مقفلة";
  }
  const invalid = Object.keys(errors).length > 0;
  const lockedPeriod =
    serverError?.code === "period_locked" ||
    (attempted && errors["date"] === "تاريخ داخل فترة مقفلة");

  const state: State = done
    ? "success"
    : denied
      ? "permission_denied"
      : serverError !== null || (attempted && invalid) || eff?.reversed
        ? "validation_error"
        : "ready";

  const save = async () => {
    if (!ctx || busy) return;
    setAttempted(true);
    if (invalid || ctx.effective.reversed) return;
    setBusy(true);
    setServerError(null);
    try {
      const { data, response } = await api().POST("/api/parties/receipts/{receipt_id}/correct", {
        params: { path: { receipt_id: ctx.receipt.id } },
        body: {
          kind,
          reason: reason.trim(),
          new_method: kind === "method" ? method : "",
          new_reference: kind === "method" && method === "bank" ? reference.trim() : "",
          new_amount_minor: kind === "amount" ? (amountMinor ?? 0n).toString() : "",
          new_business_date: kind === "date" ? date : null,
        },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.status === 400) {
        const errs = (data as unknown as { errors?: { field: string; code: string }[] } | undefined)
          ?.errors;
        setServerError(errs?.[0] ?? { field: "correction", code: "invalid" });
        return;
      }
      const body = data as unknown as Result | undefined;
      if (!response.ok || !body) return;
      await storeParties(getStorage(), [body.party as never], new Date().toISOString());
      setDone(body);
    } finally {
      setBusy(false);
    }
  };

  const rec = ctx?.receipt;
  const kindLabel = rec?.kind === "refund" ? "ردّ مبلغ" : "سداد";
  const balanceBefore = ctx ? BigInt(ctx.party.balance_minor || "0") : 0n;
  const balanceAfter = done ? BigInt(done.party.balance_minor || "0") : balanceBefore;
  const origDate = eff ? dayMonth(eff.business_date) : null;

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={!denied} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تصحيح حركة</h2>
            <span className="cat-head__hint">
              الأصل ثابت، والتصحيح مستند مستقل بسبب واضح وهوية منفّذ.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="التصحيح للمالك">
                <p className="acc-lead">تغيير التاريخ يُعيد ترتيب الدفتر ويمسّ تقارير صدرت.</p>
              </Notice>
            ) : null}

            {rec && eff && origDate ? (
              <div className="pty-orig">
                <div className="pty-merge__role">الحركة الأصلية — لن تتغير</div>
                <div>
                  {kindLabel} <span className="sting-mono">{formatMinor(eff.amount_minor)}</span> ·{" "}
                  <span className="sting-mono">{origDate.day}</span> {origDate.month}
                  {rec.user_name ? <> · {rec.user_name}</> : null}
                </div>
                <div className="acc-choice__note">
                  {eff.method === "cash" ? "نقداً" : "تحويل بنكي"}
                  {eff.reference ? (
                    <>
                      {" "}
                      · <span className="sting-mono">{eff.reference}</span>
                    </>
                  ) : null}
                  {rec.reason ? <> · {rec.reason}</> : null}
                  {" · "}
                  <span className="sting-mono">{rec.receipt_number}</span>
                </div>
              </div>
            ) : null}

            {lockedPeriod ? (
              <Notice kind="error" title="تاريخ داخل فترة مقفلة">
                <p className="acc-lead">نقل حركة إلى شهر أُقفلت ورديّاته وصُدِّرت تقاريره.</p>
                <p className="acc-choice__note">
                  <strong>نمنع ونقول السبب</strong> · الفترة مقفلة — الحركة تبقى بتاريخها ويُسجَّل
                  التصحيح بحركة معلَّلة.
                </p>
              </Notice>
            ) : null}

            {eff?.reversed && !done ? (
              <Notice kind="error" title="عكس الحركة بالكامل">
                <p className="acc-lead">الحركة معكوسة بمستند تصحيح سابق — لا تصحيح بعده.</p>
              </Notice>
            ) : null}

            {state === "success" && done ? (
              <>
                <Notice
                  kind="success"
                  title={done.correction.kind === "date" ? "صُحِّح التاريخ" : "مستند تصحيح جديد"}
                >
                  <p className="acc-lead">
                    التاريخ القديم والجديد وسبب التصحيح ومن نفّذه — الثلاثة في السجل لا التاريخ
                    الجديد وحده.
                  </p>
                  <p className="acc-choice__note">
                    <strong>أثرٌ مُعلن</strong> · نقول ما تغيّر:{" "}
                    {balanceAfter === balanceBefore ? (
                      "رصيد الطرف كما هو"
                    ) : (
                      <>
                        رصيد الطرف{" "}
                        <span className="sting-mono">{formatMinor(balanceBefore.toString())}</span>{" "}
                        → <span className="sting-mono">{formatMinor(balanceAfter.toString())}</span>
                      </>
                    )}
                  </p>
                </Notice>
                <div className="cat-form__actions">
                  <Button onClick={() => router.push(`/parties/${done.party.id}/statement`)} pos>
                    كشف الحساب
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => router.push(`/parties/${done.party.id}`)}
                  >
                    بطاقة الطرف
                  </Button>
                </div>
              </>
            ) : null}

            {ctx && !done && !eff?.reversed ? (
              <>
                <SelectField
                  label="نوع التصحيح"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as Kind);
                    setServerError(null);
                  }}
                  options={KINDS}
                />
                {kind === "method" ? (
                  <>
                    <RadioGroupField
                      label="الوسيلة"
                      name="m2"
                      value={method}
                      onChange={(v) => setMethod(v as "cash" | "bank")}
                      options={[
                        { value: "cash", label: "نقداً" },
                        { value: "bank", label: "تحويل بنكي" },
                      ]}
                    />
                    {method === "bank" ? (
                      <TextField
                        label="مرجع التحويل — إلزامي"
                        mono
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        error={attempted ? errors["reference"] : undefined}
                        required
                      />
                    ) : null}
                  </>
                ) : null}
                {kind === "amount" ? (
                  <TextField
                    label="المبلغ"
                    mono
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    error={attempted ? errors["amount"] : undefined}
                    required
                  />
                ) : null}
                {kind === "date" ? (
                  <TextField
                    label="تاريخ الأعمال"
                    kind="date"
                    mono
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setServerError(null);
                    }}
                    error={attempted ? errors["date"] : undefined}
                    required
                  />
                ) : null}
                <TextField
                  label="السبب — إلزامي ويظهر في سجل التدقيق"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  error={attempted ? errors["reason"] : undefined}
                  required
                />
                <Notice kind="info" title="سيُنشأ مستند تصحيح جديد">
                  <p className="acc-lead">
                    مرتبط بالأصل. كلاهما يظهر في كشف الحساب: الأصل بوسم «مصحَّح» والتصحيح بوسم
                    «يصحّح حركة <span className="sting-mono">{origDate?.day}</span>{" "}
                    {origDate?.month}». الرصيد النهائي واحد.
                  </p>
                </Notice>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void save()}
                    loading={busy}
                    disabledReason={attempted && invalid ? "أكمل الحقول المطلوبة" : undefined}
                  >
                    إنشاء مستند التصحيح
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => router.push(`/parties/${ctx.party.id}/statement`)}
                  >
                    كشف الحساب
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
