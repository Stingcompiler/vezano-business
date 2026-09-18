"use client";

import { Button, formatMinor, formatQty, Status } from "@sting/ui-web";

import { hhmm } from "@/features/home/format";
import { DayLabel } from "@/features/pos/invoices-client";

export type TransferStatus = "sent" | "partially_received" | "received" | "cancelled";

export interface TransferLineView {
  readonly id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly unit_name: string;
  readonly factor_milli: string;
  readonly qty_milli: string;
  readonly base_qty_milli: string;
  readonly received_base_milli: string;
  readonly value_minor?: string;
}

export interface TransferView {
  readonly id: string;
  readonly transfer_number: string;
  readonly branch_from_id: string;
  readonly branch_from_name: string;
  readonly branch_to_id: string;
  readonly branch_to_name: string;
  readonly status: TransferStatus;
  readonly user_name: string;
  readonly sent_at: string;
  readonly late?: boolean;
  readonly in_transit_milli?: string;
  readonly in_transit_value_minor?: string;
  readonly lines: readonly TransferLineView[];
}

/** «للرئيسي» / «لبحري»: حرف الجرّ ملتصقاً بالاسم كما في الإطار. */
export function li(name: string): string {
  return name.startsWith("ال") ? `ل${name.slice(1)}` : `ل${name}`;
}

/** «الفرع الرئيسي» / «فرع بحري» — عنوان دفتر الفرع كما في الإطار. */
export function branchTitle(name: string): string {
  if (name.includes("فرع")) return name;
  return name.startsWith("ال") ? `الفرع ${name}` : `فرع ${name}`;
}

export const STATUS_LABEL: Record<TransferStatus, string> = {
  sent: "أُرسل",
  partially_received: "استُلم جزئياً",
  received: "استُلم",
  cancelled: "أُلغي",
};

/** «6 كراتين» — الكمية بوحدة الإدخال والاسم خارج mono. */
export function QtyUnits({ lines }: { lines: readonly TransferLineView[] }) {
  const first = lines[0];
  if (!first) return <>—</>;
  const total = lines.reduce((a, l) => a + BigInt(l.qty_milli), 0n);
  return (
    <>
      <span className="sting-mono">{formatQty(total, 0)}</span>{" "}
      {lines.every((l) => l.unit_name === first.unit_name) ? first.unit_name : "وحدة"}
    </>
  );
}

/**
 * بطاقة التحويل (14-D9): «خرج وصل، لا حركة واحدة» — دفتر المرسِل (خرج من الرصيد فوراً)، ودفتر
 * المستلم (متوقع بانتظار العدّ)، و«بضاعة في الطريق» حساب وسيط بكميته وقيمته؛ تأخّر فوق 72 ساعة
 * تنبيه للمالك — تأخر لا اتهام؛ عند الاستلام بفارق يبقى المتبقّي «فارق تحويل» ولا يُغلق بالسهو.
 */
export function TransferCard({
  t,
  pending,
  onReceive,
  onRemind,
  onCancel,
  cancelDisabledReason,
}: {
  t: TransferView;
  pending: boolean;
  onReceive?: (() => void) | undefined;
  onRemind?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  cancelDisabledReason?: string | undefined;
}) {
  const sent = t.lines.reduce((a, l) => a + BigInt(l.base_qty_milli), 0n);
  const received = t.lines.reduce((a, l) => a + BigInt(l.received_base_milli), 0n);
  const inTransit = t.in_transit_milli !== undefined ? BigInt(t.in_transit_milli) : sent - received;
  const value = t.in_transit_value_minor ?? "0";
  const open = t.status === "sent" || t.status === "partially_received";
  return (
    <div className="inv-transfer" data-transfer={t.id}>
      <div className="inv-head">
        <div>
          <h3 className="cat-head__title">
            تحويل <span className="sting-mono">{t.transfer_number}</span> — {t.branch_from_name} ←{" "}
            {t.branch_to_name}
          </h3>
          <div className="acc-choice__note">
            أُرسل <DayLabel iso={t.sent_at} now={new Date()} />{" "}
            <span className="sting-mono">{hhmm(t.sent_at)}</span> · المسؤول: {t.user_name}
          </div>
        </div>
        <span className="inv-head__chip">
          <Status
            state={
              pending
                ? "pending_sync"
                : t.status === "cancelled"
                  ? "empty"
                  : t.status === "received"
                    ? "synced"
                    : "pending_sync"
            }
            label={
              pending
                ? "معلّق هذا الجهاز"
                : t.status === "sent"
                  ? "في الطريق — لم يُستلم بعد"
                  : STATUS_LABEL[t.status]
            }
            dot={false}
          />
        </span>
      </div>
      <div className="inv-ledgers">
        <div className="inv-ledger">
          <div className="pty-merge__role">دفتر {branchTitle(t.branch_from_name)} — المرسِل</div>
          <div className="shift-facts">
            <div>
              <span className="shift-facts__k">خرج من الرصيد</span>
              <span className="shift-facts__v inv-delta--out">
                −<QtyUnits lines={t.lines} />
              </span>
            </div>
            <div>
              <span className="shift-facts__k">بقيمة</span>
              <span className="shift-facts__v sting-mono">
                {formatMinor(
                  t.lines.reduce((a, l) => a + BigInt(l.value_minor ?? "0"), 0n).toString(),
                )}
              </span>
            </div>
            <div>
              <span className="shift-facts__k">حالة القيد</span>
              <span className="shift-facts__v">{pending ? "معلّق هذا الجهاز" : "مؤكد"}</span>
            </div>
          </div>
          <p className="acc-choice__note">
            خرج من رصيده فوراً: البضاعة ليست عنده. لكنها لم تدخل رصيد {t.branch_to_name} بعد.
          </p>
        </div>
        <div className="inv-ledger inv-ledger--in">
          <div className="pty-merge__role">دفتر {branchTitle(t.branch_to_name)} — المستلم</div>
          <div className="shift-facts">
            <div>
              <span className="shift-facts__k">دخل الرصيد</span>
              <span className="shift-facts__v">
                {received > 0n ? (
                  <span className="sting-mono">{formatQty(received, 0)}</span>
                ) : (
                  "متوقع"
                )}
              </span>
            </div>
            <div>
              <span className="shift-facts__k">
                {received > 0n ? "المتبقّي" : <QtyUnits lines={t.lines} />}
              </span>
              <span className="shift-facts__v">
                {received > 0n ? (
                  <span className="sting-mono">{formatQty(inTransit, 0)}</span>
                ) : (
                  "بانتظار العدّ"
                )}
              </span>
            </div>
          </div>
          <p className="acc-choice__note">
            لا يستطيع بيع ما لم يستلمه. لو باعه قبل الاستلام لصار رصيده سالباً بسبب لا يخصه.
          </p>
        </div>
        <div className="inv-ledger inv-ledger--transit">
          <div className="pty-merge__role">«بضاعة في الطريق» — حساب وسيط</div>
          <div className="inv-transit">
            <span className="sting-mono">{formatQty(inTransit, 0)}</span>{" "}
            {t.lines[0]?.unit_name ?? "وحدة"} ·{" "}
            <span className="sting-mono">{formatMinor(value)}</span>
          </div>
          <p className="acc-choice__note">
            تظهر في تقرير المنشأة المجمَّع ولا تُنسب لأي فرع. من دون هذا الحساب تختفي البضاعة من
            الدفاتر بين الخروج والدخول.
          </p>
          <p className="acc-choice__note">
            لو تأخر الاستلام فوق 72 ساعة يظهر تنبيه للمالك — تأخر لا اتهام.
            {t.late ? (
              <>
                {" "}
                <Status state="stale" label="تأخّر فوق 72 ساعة" dot={false} />
              </>
            ) : null}
          </p>
        </div>
      </div>
      {t.status === "partially_received" ? (
        <p className="acc-choice__note inv-variance">
          <strong>عند الاستلام بفارق:</strong> يُسجَّل المستلم فعلاً، ويبقى المتبقّي في «الطريق»
          موسوماً «فارق تحويل»، ويُحسم بجرد أو بإقرار من أحد الفرعين — الاثنان دفتران لمالك واحد لكن
          مسؤولية العدّ لشخصين.
        </p>
      ) : null}
      {open ? (
        <div className="cat-form__actions">
          <Button
            pos
            onClick={onReceive}
            disabledReason={onReceive ? undefined : "الاستلام من الفرع المستقبل"}
          >
            تسجيل استلام {t.branch_to_name}
          </Button>
          <Button
            variant="secondary"
            onClick={onRemind}
            disabledReason={onRemind ? undefined : "التذكير مع N-01"}
          >
            تذكير المستلم
          </Button>
          <Button
            variant="secondary"
            onClick={onCancel}
            disabledReason={cancelDisabledReason ?? (onCancel ? undefined : "الإلغاء للمرسِل")}
          >
            إلغاء التحويل — يرجع {li(t.branch_from_name)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
