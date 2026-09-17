"use client";

import { storeParties } from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, RadioGroupField, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import { PosNav } from "@/features/pos/pos-nav";
import { parseAmount } from "@/features/pos/use-sale";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

import type { Card } from "./party-card-client";

type State = "ready" | "validation_error" | "permission_denied" | "success";
type Side = "customer_due" | "supplier_owed";

/**
 * PTY-04 — رصيد افتتاحي (04-D2 ready · 40-D32 validation_error/permission_denied/success): جهة
 * الدين والعملة والسبب ومعاينة الأثر؛ بند واحد بلا فواتير خلفه فلا «عمر دين» منه (ACC-79)؛ للمالك
 * وحده، مرة واحدة لكل صفة وقبل أول حركة؛ بلا تاريخ = «قبل النظام».
 */
export function OpeningClient({ partyId }: { partyId: string }) {
  const router = useRouter();
  const app = useApp();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [side, setSide] = useState<Side>("customer_due");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ amount: string; side: Side; date: string } | null>(null);
  const [denied, setDenied] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/parties/${partyId}/opening`)}`);
      return;
    }
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/parties/{party_id}", {
          params: { path: { party_id: partyId } },
        });
        const body = data as unknown as Card | undefined;
        if (!response.ok || !body) {
          setCard(null);
          return;
        }
        setCard(body);
        if (!body.is_customer && body.is_supplier) setSide("supplier_owed");
        if (!body.can_open_balance) setDenied(true);
      } catch {
        setCard(null);
      }
    })();
  }, [partyId, router]);

  useEffect(() => {
    if (card === null) router.replace("/parties");
  }, [card, router]);

  const amountMinor = parseAmount(amount);
  const errors: Record<string, string> = {};
  if (!amount.trim() || amountMinor === null || amountMinor <= 0n) errors["amount"] = "مبلغ موجب";
  if (!reason.trim()) errors["reason"] = "السبب — إلزامي";
  const alreadyRecorded = card?.opening_balances.some((o) => o.side === side) ?? false;
  const hasMovements = card?.has_movements ?? false;
  const blocked = hasMovements || alreadyRecorded || serverError !== null;
  const invalid = Object.keys(errors).length > 0;

  const state: State = saved
    ? "success"
    : denied
      ? "permission_denied"
      : blocked || (attempted && invalid)
        ? "validation_error"
        : "ready";

  const current = card
    ? BigInt((side === "customer_due" ? card.balance_minor : card.supplier_owed_minor) || "0")
    : 0n;
  const adding = amountMinor && amountMinor > 0n ? amountMinor : 0n;
  const after = current + adding;

  const save = async () => {
    if (!card || busy) return;
    setAttempted(true);
    if (invalid || blocked) return;
    setBusy(true);
    try {
      const { data, error, response } = await api().POST(
        "/api/parties/{party_id}/opening-balance",
        {
          params: { path: { party_id: card.id } },
          body: {
            side,
            amount_minor: (amountMinor ?? 0n).toString(),
            reason: reason.trim(),
            reference: reference.trim(),
            business_date: date || null,
          },
        },
      );
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      if (response.status === 400) {
        const errs = (error as { errors?: { field: string; code: string }[] } | undefined)?.errors;
        setServerError(errs?.[0]?.code ?? "invalid");
        return;
      }
      const body = data as unknown as { party: Card } | undefined;
      if (!response.ok || !body) return;
      await storeParties(getStorage(), [body.party as never], new Date().toISOString());
      setSaved({ amount: (amountMinor ?? 0n).toString(), side, date });
    } finally {
      setBusy(false);
    }
  };

  const sideLabel = side === "customer_due" ? "عليها لنا" : "لها علينا";

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={!denied} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">رصيد افتتاحي{card ? <> — {card.name}</> : null}</h2>
            <span className="cat-head__hint">لتسجيل دين قائم قبل استخدام النظام</span>
          </div>
          {card ? (
            <div className="acc-card__body">
              {state === "permission_denied" ? (
                <Notice kind="locked" title="الافتتاحي للمالك">
                  <p className="acc-lead">يُنشئ ذمّةً بلا فاتورة — إقرارٌ مالي محض.</p>
                  <p className="acc-choice__note">
                    <strong>لا استثناء</strong> · ولا للمحاسب في الإصدار الأول. الرقم بلا مستند
                    يُراجَع من مالكه.
                  </p>
                </Notice>
              ) : null}
              {state === "success" && saved ? (
                <>
                  <Notice kind="success" title="سُجّل الافتتاحي">
                    <p className="acc-lead">
                      المبلغ وجهته (عليه أو له) وتاريخه ومستنده المرجعي إن كُتب.
                    </p>
                    <p className="acc-choice__note">
                      <strong>يظهر أول الكشف</strong> · سطراً مسمّى «رصيد افتتاحي» لا مندساً بين
                      الفواتير. من يقرأ الكشف يحتاج أن يعرف من أين بدأ.
                    </p>
                    <p className="acc-choice__note">
                      <strong>لا أعمار منه</strong> · الافتتاحي بلا فواتير يُسنَد إليها، فلا يُحتسب
                      في أعمار الدين (ACC-79).
                    </p>
                  </Notice>
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">المبلغ</span>
                      <span className="shift-facts__v sting-mono">{formatMinor(saved.amount)}</span>
                    </div>
                    <div>
                      <span className="shift-facts__k">جهة الدين</span>
                      <span className="shift-facts__v">
                        {saved.side === "customer_due" ? "عليها لنا" : "لها علينا"}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">التاريخ</span>
                      <span className="shift-facts__v">
                        {saved.date ? (
                          <span className="sting-mono">{saved.date}</span>
                        ) : (
                          "قبل النظام"
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="cat-form__actions">
                    <Button onClick={() => router.push(`/parties/${card.id}`)} pos>
                      بطاقة الطرف
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/parties/${card.id}/statement`)}
                    >
                      كشف الحساب
                    </Button>
                  </div>
                </>
              ) : null}

              {!saved && (hasMovements || alreadyRecorded || serverError) ? (
                <Notice kind="error" title="رصيد على طرف له حركات">
                  <p className="acc-lead">
                    الطرف عليه فواتير مسجّلة، وإدخال رصيد افتتاحي الآن يُحرّف تاريخه.
                  </p>
                  <p className="acc-choice__note">
                    <strong>الافتتاحي مرة واحدة</strong> · وقبل أول حركة. بعدها التصحيح بحركة
                    معلَّلة لا برصيد افتتاحي ثانٍ — وإلا ضاع الفرق بين ما كان وما صار.
                  </p>
                  <p className="acc-choice__note">
                    <strong>المخرج</strong> · حركة تسوية بسبب مكتوب، أو تصحيح تاريخ الأعمال (PTY-09)
                    إن كان الخطأ في التاريخ لا المبلغ.
                  </p>
                </Notice>
              ) : null}

              {!saved ? (
                <>
                  <RadioGroupField
                    label="جهة الدين"
                    name="dir"
                    value={side}
                    onChange={(v) => {
                      setSide(v as Side);
                      setServerError(null);
                    }}
                    options={[
                      ...(card.is_customer ? [{ value: "customer_due", label: "عليها لنا" }] : []),
                      ...(card.is_supplier ? [{ value: "supplier_owed", label: "لها علينا" }] : []),
                    ]}
                  />
                  <TextField
                    label="المبلغ"
                    mono
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    error={attempted ? errors["amount"] : undefined}
                    required
                  />
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">العملة</span>
                      <span className="shift-facts__v">
                        الجنيه السوداني — عملة المنشأة، غير قابلة للتبديل
                      </span>
                    </div>
                  </div>
                  <TextField
                    label="السبب — إلزامي"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    error={attempted ? errors["reason"] : undefined}
                    required
                  />
                  <TextField
                    label="مستند مرجعي"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    hint="اختياري"
                  />
                  <TextField
                    label="تاريخ الدين"
                    kind="date"
                    mono
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    hint="اختياري — بلا تاريخ يظهر «قبل النظام»"
                  />

                  <div className="cat-head">
                    <h3 className="cat-head__title">معاينة الأثر قبل الحفظ</h3>
                  </div>
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">
                        {side === "customer_due" ? "رصيدها الآن" : "لها علينا الآن"}
                      </span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(current.toString())}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">يضاف افتتاحياً</span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(adding.toString())}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">
                        <strong>بعد الحفظ</strong>
                      </span>
                      <span className="shift-facts__v sting-mono">
                        {formatMinor(after.toString())}
                      </span>
                    </div>
                  </div>
                  <p className="acc-choice__note">
                    الرصيد الافتتاحي بند واحد بلا فواتير خلفه. لن يظهر له «عمر دين» في التقارير، لأن
                    النظام لا يخترع تواريخ فواتير غير موجودة.
                  </p>
                  <div className="cat-form__actions">
                    <Button
                      financial
                      pos
                      onClick={() => void save()}
                      loading={busy}
                      disabledReason={
                        denied
                          ? "الافتتاحي للمالك"
                          : hasMovements
                            ? "الطرف عليه فواتير مسجّلة"
                            : alreadyRecorded
                              ? "الافتتاحي مرة واحدة"
                              : undefined
                      }
                    >
                      حفظ الرصيد الافتتاحي
                    </Button>
                    <Button variant="quiet" onClick={() => router.push(`/parties/${card.id}`)}>
                      بطاقة الطرف
                    </Button>
                  </div>
                  <span className="acc-choice__note">جهة الدين: {sideLabel}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
