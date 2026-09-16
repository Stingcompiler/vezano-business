/**
 * C-QTYUNIT — كمية بوحدة واحدة، بوحدتين (عبوة/حبة)، عشرية بوزن. الحالات: ready, validation_error,
 * disabled, partial (وحدة غير محسومة). التحويل يُعرض دائماً بصيغة صريحة «= 24 حبة» والمعامل يُثبَّت
 * على السطر لحظة الحفظ. الوزن يقبل ثلاث منازل. الوحدة جزء من الاسم المُعلن؛ تغييرها يُعلن أثره.
 * الكمية بأجزاء الألف كسلسلة؛ التحويل من @sting/domain (لا حساب في الواجهة).
 */
import { DomainError, parseQtyString, parseUnitFactor, toBaseQtyMilli } from "@sting/domain";
import { Minus, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "./Button";
import { formatQty } from "./format";

export interface UnitOption {
  readonly id: string;
  readonly label: string;
  readonly decimalPlaces: 0 | 1 | 2 | 3;
  /** معامل التحويل إلى الوحدة الأساسية num/den؛ الأساسية "1"/"1". */
  readonly factorNum: string;
  readonly factorDen?: string;
}

export interface QtyUnitProps {
  readonly label: string;
  readonly qtyMilli: string;
  readonly unitId: string;
  readonly units: readonly UnitOption[];
  readonly baseUnitLabel: string;
  readonly onChange: (next: { qtyMilli: string | null; unitId: string }) => void;
  readonly error?: string | undefined;
  readonly disabledReason?: string | undefined;
  /** وحدة غير محسومة (partial): تُعرض علامة ويُمنع الحفظ في الأعلى. */
  readonly unresolvedUnit?: boolean | undefined;
}

export function QtyUnit({
  label,
  qtyMilli,
  unitId,
  units,
  baseUnitLabel,
  onChange,
  error,
  disabledReason,
  unresolvedUnit,
}: QtyUnitProps) {
  const id = useId();
  // الوحدة المختارة تُحفظ محلياً وتُزامَن من الخاصية: تغيير الوحدة يسبق إعادة رسم الأب
  const [selectedId, setSelectedId] = useState(unitId);
  useEffect(() => setSelectedId(unitId), [unitId]);
  const unit = units.find((u) => u.id === selectedId) ?? units[0]!;
  const [raw, setRaw] = useState(() => formatQty(qtyMilli, unit.decimalPlaces));
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [announce, setAnnounce] = useState("");

  const commit = (text: string, u: UnitOption = unit) => {
    setRaw(text);
    try {
      const milli = parseQtyString(
        text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace("٫", "."),
      );
      const step = 10n ** BigInt(3 - u.decimalPlaces);
      if (milli % step !== 0n) {
        setLocalError(`هذه الوحدة تقبل ${u.decimalPlaces} منازل على الأكثر`);
        onChange({ qtyMilli: null, unitId: u.id });
        return;
      }
      setLocalError(undefined);
      onChange({ qtyMilli: milli.toString(), unitId: u.id });
    } catch (e) {
      setLocalError(
        e instanceof DomainError ? "اكتب كمية موجبة — مثل 2 أو 0.5" : "كمية غير مقبولة",
      );
      onChange({ qtyMilli: null, unitId: u.id });
    }
  };
  const step = (dir: 1n | -1n) => {
    const unitStep = 1000n;
    const current = BigInt(qtyMilli || "0");
    const next = current + dir * unitStep;
    if (next <= 0n) return;
    commit(formatQty(next, unit.decimalPlaces));
  };
  const changeUnit = (nextId: string) => {
    const u = units.find((x) => x.id === nextId)!;
    setSelectedId(u.id);
    setAnnounce(`الوحدة الآن ${u.label}`);
    commit(raw, u);
  };

  let conversion: string | null = null;
  if (qtyMilli && unit.factorNum !== "1") {
    try {
      const base = toBaseQtyMilli(
        BigInt(qtyMilli),
        parseUnitFactor(unit.factorNum, unit.factorDen ?? "1"),
      );
      conversion = `= ${formatQty(base, 3).replace(/\.?0+$/, "")} ${baseUnitLabel}`;
    } catch {
      conversion = "لا يمكن تحويل هذه الكمية بدقة";
    }
  }
  const shownError = error ?? localError;
  return (
    <div className={`c-field c-qtyunit${shownError ? " c-field--error" : ""}`}>
      <span id={`${id}-label`} className="c-field__label">
        {label}
      </span>
      <div className="c-qtyunit__row" role="group" aria-labelledby={`${id}-label`}>
        <Button
          variant="icon"
          iconLabel="إنقاص"
          icon={<Minus size={18} />}
          onClick={() => step(-1n)}
          disabledReason={disabledReason}
        />
        <input
          id={id}
          className="c-field__input sting-mono c-qtyunit__input"
          inputMode="decimal"
          value={raw}
          onChange={(e) => commit(e.target.value)}
          aria-label={`${label} بـ${unit.label}`}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? `${id}-error` : conversion ? `${id}-conv` : undefined}
          disabled={Boolean(disabledReason)}
          autoComplete="off"
        />
        <Button
          variant="icon"
          iconLabel="زيادة"
          icon={<Plus size={18} />}
          onClick={() => step(1n)}
          disabledReason={disabledReason}
        />
        <select
          className="c-field__input c-qtyunit__unit"
          aria-label="الوحدة"
          value={unit.id}
          onChange={(e) => changeUnit(e.target.value)}
          disabled={Boolean(disabledReason)}
        >
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
      {conversion ? (
        <p id={`${id}-conv`} className="c-field__hint c-qtyunit__conv">
          <span className="sting-mono">
            {conversion.split(" ")[0]} {conversion.split(" ")[1]}
          </span>{" "}
          {conversion.split(" ").slice(2).join(" ")}
        </p>
      ) : null}
      {unresolvedUnit ? (
        <p className="c-field__hint" role="status">
          وحدة غير محسومة — حدّد معامل التحويل قبل الحفظ
        </p>
      ) : null}
      {shownError ? (
        <p id={`${id}-error`} className="c-field__error" role="alert">
          {shownError}
        </p>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
