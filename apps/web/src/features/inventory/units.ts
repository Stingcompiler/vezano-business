import { parseQtyString } from "@sting/domain";
import type { LocalItem } from "@sting/sync-core";

export type Dp = 0 | 1 | 2 | 3;

/** وحدة إدخال: الأساسية بمعامل 1000، أو وحدة الصنف بمعاملها المعلن (صفر = «غير محدَّد»). */
export interface UnitOption {
  readonly key: string;
  readonly code: string;
  readonly name: string;
  readonly factorMilli: string;
  readonly decimalPlaces: Dp;
}

export function unitOptions(item: LocalItem): UnitOption[] {
  const base: UnitOption = {
    key: `base:${item.base_unit_id}`,
    code: item.base_unit_code,
    name: item.base_unit_name,
    factorMilli: "1000",
    decimalPlaces: item.base_unit_decimal_places ?? 0,
  };
  const extra = item.units
    .filter((u) => u.unit_id !== item.base_unit_id)
    .map((u): UnitOption => ({
      key: `unit:${u.id ?? u.unit_id}`,
      code: u.code,
      name: u.name,
      factorMilli: u.factor_milli || "0",
      decimalPlaces: u.decimal_places ?? 0,
    }));
  return [base, ...extra];
}

/** كمية مُدخلة (أرقام عربية أو لاتينية، حتى 3 منازل) → أجزاء الألف؛ غير الرقمي = null («لا نقبل تقديراً»). */
export function parseQtyInput(text: string): bigint | null {
  const t = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("٫", ".")
    .replace(/,/g, "");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/.test(t)) return null;
  try {
    return parseQtyString(t);
  } catch {
    return null;
  }
}
