/**
 * خط حفظ المرتجع (POS-10؛ §٧.٢–٧.٣، القاعدة 8): عملية `sale_return` بأعضائها — رأس المرتجع وسطوره
 * وحركة المخزون (صالح) أو الحجر (تالف) — مستند مستقل يشير إلى أصله والأصل باقٍ كما كان (ACC-09).
 * السقف التراكمي عبر كل مرتجعات الفاتورة (ACC-11) يُعرض ويُفحص محلياً، ويُكشف التجاوز مركزياً.
 *
 * تنبيه Dexie: كل `await` داخل المُسقِط على المعاملة مباشرةً.
 */
import { lineTotalMinor, parseUnitFactor, toBaseQtyMilli } from "@sting/domain";
import type { StoragePort, StoredOperation } from "@sting/platform";

import { saveOperation } from "./local-save";
import { BALANCE_PREFIX } from "./pos-local";
import type { LocalSale } from "./sale-local";
import type { CashRow, LocalShift } from "./shift-local";
import type { OperationDraft } from "./types";

export const RETURN_PREFIX = "entity:sales.SaleReturn:";
export const RETURN_SEQ_META = "return_seq";

export type ReturnCondition = "good" | "damaged";
export type ReturnDestination = "cash" | "credit";

export interface ReturnLineInput {
  /** سطر البيع الأصلي. */
  readonly saleLineId: string;
  readonly qtyMilli: string;
}

export interface ReturnInput {
  readonly operationId: string;
  readonly returnId: string;
  readonly sale: LocalSale;
  /** عملية البيع الأصلية (محلية) لتُعتمَد عليها؛ فاتورة خادمية بلا عملية محلية → لا تبعية. */
  readonly saleOperationId?: string | undefined;
  readonly lines: readonly ReturnLineInput[];
  readonly condition: ReturnCondition;
  readonly destination: ReturnDestination;
  readonly shift: LocalShift;
  readonly branchCode: string;
  readonly devicePrefix: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly userName: string;
  readonly businessDate: string;
  readonly occurredAt: string;
  /** معرّفات ثابتة للأعضاء — تُولَّد مرة واحدة على الشاشة. */
  readonly memberIds: {
    readonly lines: readonly string[];
    readonly movements: readonly string[];
  };
}

/** إسقاط المرتجع المحلي — الأرقام سلاسل بالوحدة الصغرى. */
export interface LocalReturn {
  readonly id: string;
  readonly return_number: string;
  readonly sale_id: string;
  readonly invoice_number: string;
  readonly shift_id: string;
  readonly branch_id: string;
  readonly user_name: string;
  readonly party_id: string;
  readonly party_name: string;
  readonly condition: ReturnCondition;
  readonly destination: ReturnDestination;
  readonly total_minor: string;
  readonly cash_minor: string;
  readonly credit_minor: string;
  readonly lines: readonly {
    readonly id: string;
    readonly sale_line_id: string;
    readonly item_id: string;
    readonly item_name: string;
    readonly unit_code: string;
    readonly qty_milli: string;
    readonly decimal_places: number;
    readonly line_total_minor: string;
  }[];
  readonly business_date: string;
  readonly occurred_at: string;
  readonly operation_id: string;
}

const CODE = /^[A-Z0-9]{1,6}$/;

/** `RET-<فرع>-<جهاز>-<سنة>-<تسلسل>` — عدّاد مستقل عن الفواتير (§٨.٢). */
export function formatReturnNumber(
  parts: { branchCode: string; devicePrefix: string; yearTwoDigits: string },
  seq: number,
): string {
  if (
    !CODE.test(parts.branchCode) ||
    !CODE.test(parts.devicePrefix) ||
    !/^[0-9]{2}$/.test(parts.yearTwoDigits)
  ) {
    throw new Error("invalid return number parts");
  }
  return `RET-${parts.branchCode}-${parts.devicePrefix}-${parts.yearTwoDigits}-${String(seq).padStart(6, "0")}`;
}

/** قيمة المرتجع من سطوره: الكمية × سعر السطر الأصلي بتقريب المجال — لا تُعاد تسعير البضاعة. */
export function returnTotals(
  sale: LocalSale,
  lines: readonly ReturnLineInput[],
): { readonly lineTotals: Map<string, bigint>; readonly totalMinor: bigint } {
  const lineTotals = new Map<string, bigint>();
  let total = 0n;
  for (const l of lines) {
    const orig = sale.lines.find((x) => x.id === l.saleLineId);
    if (!orig) throw new Error("unknown_sale_line");
    const t = lineTotalMinor(BigInt(l.qtyMilli), BigInt(orig.unit_price_minor));
    lineTotals.set(l.saleLineId, t);
    total += t;
  }
  return { lineTotals, totalMinor: total };
}

/** يبني أعضاء العملية: الحركات مشتقة من حالة البضاعة (صالح → مخزون، تالف → حجر). */
export function returnDraft(input: ReturnInput, returnNumber: string): OperationDraft {
  const active = input.lines.filter((l) => BigInt(l.qtyMilli) > 0n);
  if (active.length === 0) throw new Error("empty_return");
  if (input.memberIds.lines.length < active.length) throw new Error("member ids must match lines");
  if (input.memberIds.movements.length < active.length)
    throw new Error("member ids must match movements");
  if (input.destination === "credit" && !input.sale.party_id) throw new Error("party_required");
  const { lineTotals, totalMinor } = returnTotals(input.sale, active);
  const head = {
    return_id: input.returnId,
    return_number: returnNumber,
    sale_id: input.sale.id,
    branch_id: input.shift.branch_id,
    device_id: input.deviceId,
    shift_id: input.shift.id,
    user_id: input.userId,
    ...(input.sale.party_id ? { party_id: input.sale.party_id } : {}),
    condition: input.condition,
    destination: input.destination,
    total_minor: totalMinor.toString(),
    business_date: input.businessDate,
    occurred_at: input.occurredAt,
  };
  const dependencies = [
    input.shift.operation_id,
    ...(input.saleOperationId ? [input.saleOperationId] : []),
  ];
  return {
    operationId: input.operationId,
    kind: "sale_return",
    opVersion: 1,
    dependencies: [...new Set(dependencies)],
    members: [
      { entity: "sales.SaleReturn", id: input.returnId, schemaVersion: 1, payload: head },
      ...active.map((l, i) => {
        const orig = input.sale.lines.find((x) => x.id === l.saleLineId)!;
        return {
          entity: "sales.SaleReturnLine",
          id: input.memberIds.lines[i]!,
          schemaVersion: 1,
          payload: {
            line_id: input.memberIds.lines[i]!,
            return_id: input.returnId,
            sale_line_id: l.saleLineId,
            item_id: orig.item_id,
            factor_milli: orig.factor_milli ?? "1000",
            qty_milli: l.qtyMilli,
            unit_price_minor: orig.unit_price_minor,
            line_total_minor: (lineTotals.get(l.saleLineId) ?? 0n).toString(),
          },
        };
      }),
      ...active.map((l, i) => {
        const orig = input.sale.lines.find((x) => x.id === l.saleLineId)!;
        const base = toBaseQtyMilli(
          BigInt(l.qtyMilli),
          parseUnitFactor(orig.factor_milli ?? "1000", "1000"),
        );
        return input.condition === "good"
          ? {
              entity: "inventory.StockMovement",
              id: input.memberIds.movements[i]!,
              schemaVersion: 1,
              payload: {
                movement_id: input.memberIds.movements[i]!,
                branch_id: input.shift.branch_id,
                item_id: orig.item_id,
                delta_base_qty_milli: base.toString(),
                reason: "return",
                source_entity: "sales.SaleReturn",
                source_id: input.returnId,
                occurred_at: input.occurredAt,
              },
            }
          : {
              entity: "inventory.QuarantineMovement",
              id: input.memberIds.movements[i]!,
              schemaVersion: 1,
              payload: {
                movement_id: input.memberIds.movements[i]!,
                branch_id: input.shift.branch_id,
                item_id: orig.item_id,
                base_qty_milli: base.toString(),
                reason: "return_damaged",
                source_entity: "sales.SaleReturn",
                source_id: input.returnId,
                occurred_at: input.occurredAt,
              },
            };
      }),
    ],
  };
}

/**
 * يحفظ المرتجع محلياً في معاملة واحدة: العملية بأعضائها + رقمه (عدّاد داخل المعاملة) + إسقاطه +
 * إعادة الرصيد المحلي للصالح فقط (التالف إلى الحجر لا المتاح). إعادة الضغط بالمعرّف نفسه لا تنشئ
 * هوية جديدة.
 */
export async function saveReturnLocally(
  storage: StoragePort,
  input: ReturnInput,
): Promise<{ ret: LocalReturn; alreadySaved: boolean }> {
  const parts = {
    branchCode: input.branchCode,
    devicePrefix: input.devicePrefix,
    yearTwoDigits: input.businessDate.slice(2, 4),
  };
  const provisional = returnDraft(input, formatReturnNumber(parts, 0));
  const active = input.lines.filter((l) => BigInt(l.qtyMilli) > 0n);
  const { lineTotals, totalMinor } = returnTotals(input.sale, active);
  const out = await saveOperation(storage, provisional, async (tx, op) => {
    const seq = Number((await tx.getMeta(RETURN_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(RETURN_SEQ_META, String(seq));
    const number = formatReturnNumber(parts, seq);
    const fixed: StoredOperation = {
      ...op,
      members: op.members.map((m) =>
        m.entity === "sales.SaleReturn"
          ? { ...m, payload: { ...m.payload, return_number: number } }
          : m,
      ),
    };
    await tx.putOperation(fixed);
    const ret: LocalReturn = {
      id: input.returnId,
      return_number: number,
      sale_id: input.sale.id,
      invoice_number: input.sale.invoice_number,
      shift_id: input.shift.id,
      branch_id: input.shift.branch_id,
      user_name: input.userName,
      party_id: input.sale.party_id,
      party_name: input.sale.party_name,
      condition: input.condition,
      destination: input.destination,
      total_minor: totalMinor.toString(),
      cash_minor: input.destination === "cash" ? totalMinor.toString() : "0",
      credit_minor: input.destination === "credit" ? totalMinor.toString() : "0",
      lines: active.map((l, i) => {
        const orig = input.sale.lines.find((x) => x.id === l.saleLineId)!;
        return {
          id: input.memberIds.lines[i]!,
          sale_line_id: l.saleLineId,
          item_id: orig.item_id,
          item_name: orig.item_name,
          unit_code: orig.unit_code,
          qty_milli: l.qtyMilli,
          decimal_places: orig.decimal_places,
          line_total_minor: (lineTotals.get(l.saleLineId) ?? 0n).toString(),
        };
      }),
      business_date: input.businessDate,
      occurred_at: input.occurredAt,
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: RETURN_PREFIX + ret.id, value: { ...ret } });
    for (const m of fixed.members) {
      if (m.entity !== "inventory.StockMovement") continue;
      const key = BALANCE_PREFIX + String(m.payload["item_id"]);
      const row = await tx.getProjection(key);
      if (!row) continue;
      const v = row.value as { qty_milli?: string; as_of?: string };
      const next = BigInt(v.qty_milli ?? "0") + BigInt(String(m.payload["delta_base_qty_milli"]));
      await tx.putProjection({ key, value: { ...v, qty_milli: next.toString() } });
    }
  });
  const row = await storage.read((tx) => tx.getProjection(RETURN_PREFIX + input.returnId));
  return { ret: row!.value as unknown as LocalReturn, alreadySaved: out.alreadySaved };
}

export async function readReturn(storage: StoragePort, id: string): Promise<LocalReturn | null> {
  const row = await storage.read((tx) => tx.getProjection(RETURN_PREFIX + id));
  return row ? (row.value as unknown as LocalReturn) : null;
}

/** المُرتجَع سابقاً محلياً لكل سطر بيع — السقف التراكمي «المُباع ناقص المُرتجَع سابقاً» (ACC-11). */
export async function readReturnedQty(
  storage: StoragePort,
  saleId: string,
): Promise<Map<string, bigint>> {
  const rows = await storage.read((tx) => tx.listProjections(RETURN_PREFIX));
  const out = new Map<string, bigint>();
  for (const r of rows.map((x) => x.value as unknown as LocalReturn)) {
    if (r.sale_id !== saleId) continue;
    for (const l of r.lines)
      out.set(l.sale_line_id, (out.get(l.sale_line_id) ?? 0n) + BigInt(l.qty_milli));
  }
  return out;
}

/** سطور المرتجع النقدي لدرج الوردية (SHIFT-02): «المرتجع يُخرج نقداً من الصندوق» لحظتها محلياً. */
export async function readReturnCashRows(
  storage: StoragePort,
  shiftId: string,
): Promise<CashRow[]> {
  const [rets, ops] = await storage.read(async (tx) => {
    const rows = (await tx.listProjections(RETURN_PREFIX))
      .map((r) => r.value as unknown as LocalReturn)
      .filter((r) => r.shift_id === shiftId);
    const opById = new Map<string, StoredOperation>();
    for (const r of rows) {
      const op = await tx.getOperation(r.operation_id);
      if (op) opById.set(r.operation_id, op);
    }
    return [rows, opById] as const;
  });
  const syncOf = (op: StoredOperation | undefined): CashRow["sync"] =>
    !op
      ? "pending"
      : op.state === "synced"
        ? "synced"
        : op.state === "conflict"
          ? "conflict"
          : op.state === "quarantined"
            ? "quarantined"
            : "pending";
  return rets.map((r) => ({
    doc: r.return_number,
    time: r.occurred_at,
    kind: "refund",
    note: `على ${r.invoice_number}`,
    inCashMinor: BigInt(r.cash_minor) > 0n ? (-BigInt(r.cash_minor)).toString() : null,
    outCashMinor: BigInt(r.credit_minor) > 0n ? r.credit_minor : null,
    sync: syncOf(ops.get(r.operation_id)),
  }));
}

/** فاتورة لمرتجع: من الإسقاط المحلي أو من صف خادمي (`GET /api/sales/{id}`) بنفس الشكل. */
export function saleFromServer(row: {
  readonly id: string;
  readonly invoice_number: string;
  readonly shift_id?: string;
  readonly branch_id: string;
  readonly device_id: string;
  readonly user_name: string;
  readonly party_id: string;
  readonly party_name: string;
  readonly subtotal_minor: string;
  readonly discount_minor: string;
  readonly total_minor: string;
  readonly cash_minor: string;
  readonly bank_minor: string;
  readonly credit_minor: string;
  readonly business_date: string;
  readonly occurred_at: string;
  readonly lines: readonly {
    readonly id: string;
    readonly item_id: string;
    readonly item_name: string;
    readonly unit_code: string;
    readonly factor_milli?: string;
    readonly qty_milli: string;
    readonly unit_price_minor: string;
    readonly line_total_minor: string;
    readonly manual_price: boolean;
  }[];
}): LocalSale {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    shift_id: row.shift_id ?? "",
    branch_id: row.branch_id,
    device_id: row.device_id,
    user_id: "",
    user_name: row.user_name,
    party_id: row.party_id,
    party_name: row.party_name,
    subtotal_minor: row.subtotal_minor,
    discount_minor: row.discount_minor,
    total_minor: row.total_minor,
    cash_minor: row.cash_minor,
    bank_minor: row.bank_minor,
    credit_minor: row.credit_minor,
    received_minor: "",
    change_minor: "",
    lines: row.lines.map((l) => ({
      id: l.id,
      item_id: l.item_id,
      item_name: l.item_name,
      unit_code: l.unit_code,
      factor_milli: l.factor_milli ?? "1000",
      qty_milli: l.qty_milli,
      decimal_places: 3,
      unit_price_minor: l.unit_price_minor,
      line_total_minor: l.line_total_minor,
      manual_price: l.manual_price,
    })),
    business_date: row.business_date,
    occurred_at: row.occurred_at,
    operation_id: "",
  };
}
