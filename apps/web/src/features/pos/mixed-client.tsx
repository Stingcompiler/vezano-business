"use client";

import { bankReferenceUsed, recordCreditOverride } from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Money,
  Notice,
  Status,
  SyncIndicator,
  TextField,
} from "@sting/ui-web";
import { useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { hhmm } from "@/features/home/format";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { PayMethods } from "./pay-methods";
import { PosNav } from "./pos-nav";
import { parseAmount, useSale } from "./use-sale";

type State =
  "ready" | "validation_error" | "saving" | "saved_local" | "success" | "server_error" | "partial";

/**
 * POS-07 — الدفع المختلط والتحويل (03-D2 ready · 42-D34 validation_error/saving/saved_local/
 * success/server_error · 14-D9 partial): ١٠٠ = ٤٠ نقداً + ٦٠ آجلاً — عملية واحدة بثلاث وجهات معلنة:
 * نقد → الصندوق، آجل → ذمّة الطرف، تحويل → «مسجَّل — غير مطابق» (ACC-08، 13، 14). المجموع
 * يُطابَق قبل الحفظ بنفس التقريب (ACC-24) والفارق يُعرض ولا يُوزَّع؛ الأجزاء تُحفظ قيداً واحداً ذرّياً.
 */
export function MixedClient() {
  const sale = useSale("/pos/pay/mixed");
  const { draft, party, pendingCredit, totals, phase, ctx, shift, online } = sale;
  const [cash, setCash] = useState("");
  const [credit, setCredit] = useState("");
  const [bank, setBank] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [refUsed, setRefUsed] = useState(false);
  const overrideIds = useRef({ operationId: "", overrideId: "" });

  const total = totals.totalMinor;
  const cashMinor = cash.trim() ? parseAmount(cash) : 0n;
  const creditMinor = credit.trim() ? parseAmount(credit) : 0n;
  const bankMinor = bank.trim() ? parseAmount(bank) : 0n;
  const parsable = cashMinor !== null && creditMinor !== null && bankMinor !== null;
  const sum = parsable ? cashMinor + creditMinor + bankMinor : null;
  const diff = sum === null ? null : total - sum;
  const matched = diff === 0n;
  const creditNeedsParty = (creditMinor ?? 0n) > 0n && !party;
  const bankNeedsRef = (bankMinor ?? 0n) > 0n && !reference.trim();
  const serverBalance = BigInt(party?.balance_minor ?? "0");
  const before = serverBalance + pendingCredit.pendingMinor;
  const after = before + (creditMinor ?? 0n);
  const limit = BigInt(party?.credit_limit_minor ?? "0");
  const overLimit = limit > 0n && (creditMinor ?? 0n) > 0n && after > limit;
  const overStock = sale.overStockOf(draft?.lines ?? []);
  const blocked = !parsable || !matched || creditNeedsParty || bankNeedsRef || refUsed;
  const touched = cash.trim() || credit.trim() || bank.trim();

  const state: State =
    phase === "saving"
      ? "saving"
      : phase === "saved"
        ? sale.push === "failed"
          ? "server_error"
          : sale.push === "synced"
            ? "success"
            : "saved_local"
        : touched && blocked
          ? "validation_error"
          : overStock.length
            ? "partial"
            : "ready";

  const commit = async () => {
    if (!draft || blocked || phase !== "idle") return;
    if (bankMinor > 0n && (await bankReferenceUsed(getStorage(), reference))) {
      setRefUsed(true);
      return;
    }
    if (overLimit && !reason.trim()) return;
    const payments = [
      ...(cashMinor > 0n ? [{ method: "cash" as const, amountMinor: cashMinor.toString() }] : []),
      ...(bankMinor > 0n
        ? [
            {
              method: "bank" as const,
              amountMinor: bankMinor.toString(),
              reference: reference.trim(),
            },
          ]
        : []),
      ...(creditMinor > 0n
        ? [{ method: "credit" as const, amountMinor: creditMinor.toString() }]
        : []),
    ];
    const saved = await sale.save(draft.lines, payments);
    if (!saved) return;
    if (overLimit && party) {
      if (!overrideIds.current.operationId)
        overrideIds.current = { operationId: crypto.randomUUID(), overrideId: crypto.randomUUID() };
      await recordCreditOverride(getStorage(), {
        ...overrideIds.current,
        saleId: saved.id,
        saleOperationId: saved.operation_id,
        partyId: party.id,
        branchId: saved.branch_id,
        creditLimitMinor: limit.toString(),
        balanceAfterMinor: after.toString(),
        reason,
        occurredAt: new Date().toISOString(),
      });
      if (online) void pushPending();
    }
    await sale.pushAfterSave();
  };

  const saved = sale.sale;
  const isOwner = ctx?.roleName === "مالك";

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="pos" canSeeReports={isOwner} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الدفع المختلط والتحويل</h2>
            {shift ? (
              <span className="cat-head__hint">
                وردية مفتوحة <span className="sting-mono">{hhmm(shift.opened_at)}</span> ·{" "}
                {shift.user_name}
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {phase !== "saved" ? <PayMethods current="mixed" /> : null}

            {phase === "saved" && saved ? (
              <>
                {state === "server_error" ? (
                  <Notice kind="error" title="فشل الرفع بعد الحفظ">
                    <p className="acc-lead">العملية محفوظة محلياً والخادم يردّها أو لا يُبلَغ.</p>
                    <p className="acc-lead">
                      <strong>لا إعادة بيع</strong> · البيع تمّ والإيصال خرج. الرفع يُعاد من طابور
                      المزامنة (SYS-01) — وإعادة العملية من الشاشة تصنع التكرار الذي تراجعه POS-12.
                    </p>
                  </Notice>
                ) : state === "success" ? (
                  <Notice kind="success" title="ثلاث وجهات معلنة">
                    <p className="acc-lead">
                      <strong>لا «تم استلام 100»</strong> · المئة لم تُستلم — استُلم 40 والتُزم
                      بـ60. لفظ الاستلام على الآجل يطمس الفرق الذي بُني عليه الكشف كله.
                    </p>
                  </Notice>
                ) : (
                  <Notice kind="success" title="مختلط بلا اتصال">
                    <p className="acc-lead">النقد في الدرج فعلاً والدين في المعلّق.</p>
                    <p className="acc-lead">
                      <strong>الوجهتان محليتان معاً</strong> · الصندوق يُقيّد النقد لحظتها والذمّة
                      تدخل معلّق الطرف — فالإغلاق والكشف صادقان قبل المزامنة (ACC-34).
                    </p>
                  </Notice>
                )}
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">رقم الفاتورة</span>
                    <span className="shift-facts__v sting-mono">{saved.invoice_number}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">إلى الصندوق — نقد فقط</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(saved.cash_minor)}
                    </span>
                  </div>
                  {BigInt(saved.credit_minor) > 0n ? (
                    <div>
                      <span className="shift-facts__k">إلى ذمّة {saved.party_name}</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(saved.credit_minor)}
                      </span>
                    </div>
                  ) : null}
                  {BigInt(saved.bank_minor) > 0n ? (
                    <div>
                      <span className="shift-facts__k">تحويل بنكي · مسجَّل — غير مطابق</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(saved.bank_minor)}
                      </span>
                    </div>
                  ) : null}
                  {BigInt(saved.credit_minor) > 0n ? (
                    <div>
                      <span className="shift-facts__k">رصيد الطرف بعد الحفظ</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(after.toString())}
                      </span>
                    </div>
                  ) : null}
                </div>
                <p className="acc-choice__note">
                  أثر العملية في ثلاث شاشات: SHIFT-02 نقد الوردية +
                  <span className="sting-mono">{formatMinor(saved.cash_minor)}</span>
                  {BigInt(saved.credit_minor) > 0n ? (
                    <>
                      {" "}
                      · PTY-05 كشف {saved.party_name}{" "}
                      <span className="sting-mono">{formatMinor(before.toString())}</span> ←{" "}
                      <span className="sting-mono">{formatMinor(after.toString())}</span>
                    </>
                  ) : null}{" "}
                  · POS-09 الفاتورة <span className="sting-mono">{saved.invoice_number}</span> بوضع
                  مزامنتها
                </p>
                <SyncIndicator
                  state={
                    !online
                      ? "offline"
                      : sale.push === "synced"
                        ? "synced"
                        : sale.push === "failed"
                          ? "server_error"
                          : "pending_sync"
                  }
                  lastServerAt={sale.matchedAt ? hhmm(sale.matchedAt) : null}
                  pendingCount={sale.push === "synced" ? 0 : 1}
                  pendingLabel={(n) =>
                    n === 1 ? "عملية واحدة معلقة من هذا الجهاز" : `${n} عمليات معلقة من هذا الجهاز`
                  }
                />
                <div className="cat-form__actions">
                  <Button onClick={() => sale.router.push(`/pos/receipt/${saved.id}`)} pos>
                    طباعة الإيصال
                  </Button>
                  <Button variant="secondary" onClick={() => sale.router.push("/pos")} pos>
                    بيع جديد
                  </Button>
                </div>
              </>
            ) : (
              <>
                {state === "saving" ? (
                  <Notice kind="info" title="قيد واحد ذرّي">
                    <p className="acc-lead">الأجزاء الثلاثة تُحفظ معاً أو لا تُحفظ.</p>
                  </Notice>
                ) : null}
                {state === "partial" ? (
                  <Notice kind="warning" title="الكمية المطلوبة تتجاوز الرصيد الدفتري">
                    {overStock.map((o) => (
                      <p key={o.line.id} className="acc-lead">
                        {o.line.item_name}: الدفتر يقول{" "}
                        <span className="sting-mono">
                          {formatQty(o.have, o.line.decimal_places)}
                        </span>{" "}
                        والزبون يطلب{" "}
                        <span className="sting-mono">
                          {formatQty(o.need, o.line.decimal_places)}
                        </span>
                        . البضاعة أمامك — الدفتر هو الذي قد يكون متأخراً.
                      </p>
                    ))}
                    <p className="acc-lead">
                      <strong>البيع يمر.</strong> يُسجَّل البيع كاملاً، ويُوسم الصنف «رصيد سالب —
                      يحتاج جرداً» في <span className="sting-mono">INV-01</span>
                    </p>
                  </Notice>
                ) : null}

                <div className="pos-pay__required">
                  <span>الإجمالي</span>
                  <Money minor={total.toString()} currency="ج.س" size="title" />
                </div>
                <div className="pos-mixed__fields">
                  <TextField
                    label="نقداً"
                    mono
                    inputMode="decimal"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    hint="يدخل صندوق الوردية المفتوحة"
                  />
                  <TextField
                    label="آجل"
                    mono
                    inputMode="decimal"
                    value={credit}
                    onChange={(e) => setCredit(e.target.value)}
                    hint={party ? `آجلاً على ${party.name}` : "عميل مسمّى — شرط الأثر الآجل"}
                    error={creditNeedsParty ? "عميل مسمّى — شرط الأثر الآجل" : undefined}
                  />
                  <TextField
                    label="تحويل بنكي"
                    mono
                    inputMode="decimal"
                    value={bank}
                    onChange={(e) => setBank(e.target.value)}
                    hint="يُقيَّد «مسجَّل — غير مطابق» حتى يُرى في الحساب البنكي (ACC-14)"
                  />
                  {(bankMinor ?? 0n) > 0n ? (
                    <TextField
                      label="مرجع"
                      mono
                      value={reference}
                      onChange={(e) => {
                        setReference(e.target.value);
                        setRefUsed(false);
                      }}
                      error={
                        refUsed
                          ? "مرجع تحويل لا يُستهلك مرتين (ACC-15)"
                          : bankNeedsRef
                            ? "مرجع تحويل لا يُستهلك مرتين (ACC-15)"
                            : undefined
                      }
                      required
                    />
                  ) : null}
                </div>

                <div className="pos-mixed__sum">
                  <span className="sting-mono">
                    {formatMinor((cashMinor ?? 0n).toString())} +{" "}
                    {formatMinor((creditMinor ?? 0n).toString())} +{" "}
                    {formatMinor((bankMinor ?? 0n).toString())} ={" "}
                    {formatMinor((sum ?? 0n).toString())}
                  </span>
                  {matched ? (
                    <Status state="synced" label="مطابق" dot={false} />
                  ) : diff !== null && diff > 0n ? (
                    <span className="pos-mixed__diff">
                      · ناقص <span className="sting-mono">{formatMinor(diff.toString())}</span>
                    </span>
                  ) : diff !== null ? (
                    <span className="pos-mixed__diff">
                      · زائد <span className="sting-mono">{formatMinor((-diff).toString())}</span>
                    </span>
                  ) : null}
                </div>
                {touched && !matched ? (
                  <Notice kind="error" title="الأجزاء لا تساوي الإجمالي">
                    <p className="acc-lead">
                      <strong>الفارق يُعرض ولا يُوزَّع</strong> · توزيع الفارق صامتاً على الآجل
                      يُنشئ ديناً لم يوافق عليه أحد — والتقريب واحد على كل منصة (ACC-24).
                    </p>
                  </Notice>
                ) : null}

                {(creditMinor ?? 0n) > 0n && party ? (
                  <p className="cat-saving__note">
                    الآجل على <strong>{party.name}</strong> ·{" "}
                    <span className="sting-mono">{formatMinor(before.toString())}</span> →{" "}
                    <span className="sting-mono">{formatMinor(after.toString())}</span>
                    {overLimit ? (
                      <>
                        <br />
                        تجاوز حدّ الائتمان: حدّه{" "}
                        <span className="sting-mono">{formatMinor(limit.toString())}</span> — هذا
                        البيع يرفعه إلى{" "}
                        <span className="sting-mono">{formatMinor(after.toString())}</span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {overLimit ? (
                  <TextField
                    label="السبب"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                ) : null}
                {(bankMinor ?? 0n) > 0n ? (
                  <p className="cat-saving__note">
                    إيصال التحويل لا يعني وصول المبلغ. يبقى «مسجَّل — غير مطابق» حتى تؤكده في كشف
                    البنك، ولا يُسقط ذمة العميل قبل ذلك.
                  </p>
                ) : null}
                <p className="acc-choice__note">
                  النقد وحده يدخل الصندوق. الجزء الآجل يدخل ذمة العميل، والتحويل البنكي يُسجَّل بلا
                  مطابقة تلقائية.
                </p>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void commit()}
                    loading={phase === "saving"}
                    disabledReason={
                      !draft?.lines.length
                        ? "السلة فارغة"
                        : !matched || !parsable
                          ? "الحفظ معطّل حتى يساوي مجموع التسوية الإجمالي"
                          : creditNeedsParty
                            ? "عميل مسمّى — شرط الأثر الآجل"
                            : bankNeedsRef
                              ? "مرجع"
                              : overLimit && !reason.trim()
                                ? "السبب"
                                : undefined
                    }
                  >
                    حفظ البيع — <span className="sting-mono">{formatMinor(total.toString())}</span>{" "}
                    ج.س
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
