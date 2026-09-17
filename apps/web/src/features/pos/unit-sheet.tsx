"use client";

import { lineTotalMinor } from "@sting/domain";
import { type CatalogRow, checkQty, unitRowsOf } from "@sting/sync-core";
import { Button, formatMinor, formatQty, Sheet, TextField } from "@sting/ui-web";
import { useEffect, useRef, useState } from "react";

type State = "ready" | "validation_error";

/** نصوص POS-02 (03-D2): خطأ الوزن حرفي؛ سائر الأخطاء من C-QTYUNIT. */
const WEIGHT_ERROR =
  "الوزن يقبل ثلاث منازل عشرية كحد أقصى. اكتب 0.123 أو 0.124 — لن نقرّب نيابة عنك في معاملة مالية.";
const QTY_ERROR = "اكتب كمية موجبة — مثل 2 أو 0.5";
const decimalsError = (n: number) => `هذه الوحدة تقبل ${n} منازل على الأكثر`;

export interface UnitSheetProps {
  readonly row: CatalogRow;
  /** كمية ابتدائية (تعديل سطر قائم) بأجزاء الألف. */
  readonly initialQtyMilli?: string | undefined;
  readonly onConfirm: (row: CatalogRow, qtyMilli: string) => void;
  readonly onClose: () => void;
}

/**
 * POS-02 — اختيار وحدة أو وزن (03-D2 ready/validation_error): التحويل مُعلن («= 12 كغ») وسعر
 * الوحدة محسوب أمام المستخدم قبل التأكيد (ACC-19/ACC-20). الوزن ثلاث منازل كحد أقصى — لا تقريب
 * نيابةً عن المستخدم؛ الزر معطّل حتى تصحيح الكمية.
 */
export function UnitSheet({ row: initial, initialQtyMilli, onConfirm, onClose }: UnitSheetProps) {
  const units = unitRowsOf(initial.item);
  const [row, setRow] = useState<CatalogRow>(initial);
  const [text, setText] = useState(() =>
    initialQtyMilli ? formatQty(initialQtyMilli, initial.decimalPlaces) : "",
  );
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const check = text.trim() ? checkQty(text, row.decimalPlaces) : null;
  const error =
    check && !check.ok
      ? check.reason === "too_many_decimals"
        ? row.decimalPlaces === 3
          ? WEIGHT_ERROR
          : decimalsError(row.decimalPlaces)
        : QTY_ERROR
      : undefined;
  const state: State = error ? "validation_error" : "ready";
  const value =
    check?.ok === true
      ? formatMinor(lineTotalMinor(BigInt(check.qtyMilli), BigInt(row.unitPriceMinor)))
      : null;

  return (
    <Sheet open title={`${initial.item.name} — اختيار الوحدة`} onClose={onClose} height="half">
      <div className="pos-unit" data-screen="POS-02" data-state={state}>
        <p className="acc-choice__note">
          الوحدة المختارة تُثبَّت على سطر البيع ولا تتأثر بتغيير المعامل لاحقاً
        </p>
        <div className="pos-unit__options" role="radiogroup" aria-label="الوحدة">
          {units.map((u) => (
            <button
              key={u.key}
              type="button"
              role="radio"
              aria-checked={u.key === row.key}
              className={`pos-unit__option${u.key === row.key ? " pos-unit__option--on" : ""}`}
              onClick={() => setRow(u)}
            >
              <span className="pos-unit__name">{u.unitCode}</span>
              <span className="pos-unit__price sting-mono">{formatMinor(u.unitPriceMinor)}</span>
              {u.isBase ? null : (
                <span className="pos-unit__factor">{u.unitLabel.slice(u.unitCode.length + 1)}</span>
              )}
            </button>
          ))}
        </div>
        <TextField
          ref={inputRef}
          label={`الكمية بال${row.unitName}`}
          mono
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error}
          required
        />
        <div className="pos-unit__value">
          <span>القيمة</span>
          {value && check?.ok ? (
            <span className="sting-mono">
              {formatQty(check.qtyMilli, row.decimalPlaces)} × {formatMinor(row.unitPriceMinor)} ={" "}
              {value}
            </span>
          ) : (
            <span className="acc-choice__note">— لا تُحسب قبل تصحيح الكمية</span>
          )}
        </div>
        <Button
          financial
          onClick={() => check?.ok && onConfirm(row, check.qtyMilli)}
          disabledReason={check?.ok ? undefined : "الزر معطّل حتى تصحيح الكمية"}
        >
          تأكيد الإضافة
        </Button>
      </div>
    </Sheet>
  );
}
