/**
 * خط حفظ استلام البضاعة (INV-04؛ §٣.٣، §١٤.٢): عملية `stock_receipt` — رأس الاستلام وسطوره
 * وحركات المخزون المشتقة منها (+الكمية بالوحدة الأساسية بسبب `receive`) — في معاملة محلية واحدة
 * مع رقم الاستلام والإسقاط وتحريك أرصدة الجهاز. المورد والمرجع والكمية مطلوبة، والتكلفة اختيارية —
 * لا نفرض وحدة تكلفة. يعمل بلا شبكة: «حُفظ على الجهاز — لم يُرفع بعد».
 *
 * تنبيه Dexie: كل `await` داخل المُسقِط على المعاملة مباشرةً.
 */
import type { StoragePort, StoredOperation } from "@sting/platform";

import { saveOperation } from "./local-save";
import { BALANCE_PREFIX } from "./pos-local";
import type { OperationDraft } from "./types";

export const GOODS_RECEIPT_PREFIX = "entity:inventory.GoodsReceipt:";
export const GOODS_RECEIPT_SEQ_META = "goods_receipt_seq";

export interface GoodsReceiptLineInput {
  readonly lineId: string;
  readonly movementId: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly unitName: string;
  /** معامل الوحدة المُدخلة إلى الأساسية — صفر أو فارغ = «كمية بوحدة غير معرَّفة» فتُرفض. */
  readonly factorMilli: string;
  readonly qtyMilli: string;
  readonly unitCostMinor?: string | undefined;
}

export interface GoodsReceiptInput {
  readonly operationId: string;
  readonly receiptId: string;
  readonly branchId: string;
  readonly branchCode: string;
  readonly devicePrefix: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly userName: string;
  readonly partyId?: string | undefined;
  readonly partyOperationId?: string | undefined;
  readonly supplierName: string;
  readonly reference: string;
  readonly note?: string | undefined;
  readonly lines: readonly GoodsReceiptLineInput[];
  readonly businessDate: string;
  readonly occurredAt: string;
}

export interface LocalGoodsReceiptLine {
  readonly id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly unit_code: string;
  readonly unit_name: string;
  readonly factor_milli: string;
  readonly qty_milli: string;
  readonly base_qty_milli: string;
  readonly unit_cost_minor: string;
}

export interface LocalGoodsReceipt {
  readonly id: string;
  readonly receipt_number: string;
  readonly branch_id: string;
  readonly party_id: string;
  readonly supplier_name: string;
  readonly reference: string;
  readonly user_name: string;
  readonly lines: readonly LocalGoodsReceiptLine[];
  readonly business_date: string;
  readonly occurred_at: string;
  readonly operation_id: string;
}

const CODE = /^[A-Z0-9]{1,6}$/;

/** `RCV-<فرع>-<جهاز>-<سنة>-<تسلسل>` — عدّاد مستقل (§٨.٢). */
export function formatGoodsReceiptNumber(
  parts: { branchCode: string; devicePrefix: string; yearTwoDigits: string },
  seq: number,
): string {
  if (
    !CODE.test(parts.branchCode) ||
    !CODE.test(parts.devicePrefix) ||
    !/^[0-9]{2}$/.test(parts.yearTwoDigits)
  ) {
    throw new Error("invalid receipt number parts");
  }
  return `RCV-${parts.branchCode}-${parts.devicePrefix}-${parts.yearTwoDigits}-${String(seq).padStart(6, "0")}`;
}

/** الكمية بالوحدة الأساسية: كمية × معامل ÷ 1000 — التحويل معروض صريحاً لا مخبَّأ. */
export function baseQtyMilli(qtyMilli: string, factorMilli: string): bigint {
  return (BigInt(qtyMilli) * BigInt(factorMilli)) / 1000n;
}

export function goodsReceiptDraft(input: GoodsReceiptInput, number: string): OperationDraft {
  if (!input.supplierName.trim()) throw new Error("supplier_required");
  if (!input.reference.trim()) throw new Error("reference_required");
  if (input.lines.length === 0) throw new Error("lines_required");
  for (const ln of input.lines) {
    if (BigInt(ln.qtyMilli || "0") <= 0n) throw new Error("qty_required");
    if (BigInt(ln.factorMilli || "0") <= 0n) throw new Error("unit_factor_undefined");
  }
  return {
    operationId: input.operationId,
    kind: "stock_receipt",
    opVersion: 1,
    dependencies: input.partyOperationId ? [input.partyOperationId] : [],
    members: [
      {
        entity: "inventory.GoodsReceipt",
        id: input.receiptId,
        schemaVersion: 1,
        payload: {
          receipt_id: input.receiptId,
          receipt_number: number,
          branch_id: input.branchId,
          device_id: input.deviceId,
          user_id: input.userId,
          party_id: input.partyId ?? "",
          supplier_name: input.supplierName.trim(),
          reference: input.reference.trim(),
          note: (input.note ?? "").trim(),
          business_date: input.businessDate,
          occurred_at: input.occurredAt,
        },
      },
      ...input.lines.map((ln) => ({
        entity: "inventory.GoodsReceiptLine",
        id: ln.lineId,
        schemaVersion: 1,
        payload: {
          line_id: ln.lineId,
          receipt_id: input.receiptId,
          item_id: ln.itemId,
          item_name: ln.itemName,
          unit_code: ln.unitCode,
          factor_milli: ln.factorMilli,
          qty_milli: ln.qtyMilli,
          base_qty_milli: baseQtyMilli(ln.qtyMilli, ln.factorMilli).toString(),
          unit_cost_minor: (ln.unitCostMinor ?? "").trim(),
        },
      })),
      ...input.lines.map((ln) => ({
        entity: "inventory.StockMovement",
        id: ln.movementId,
        schemaVersion: 1,
        payload: {
          movement_id: ln.movementId,
          branch_id: input.branchId,
          item_id: ln.itemId,
          delta_base_qty_milli: baseQtyMilli(ln.qtyMilli, ln.factorMilli).toString(),
          reason: "receive",
          source_entity: "inventory.GoodsReceipt",
          source_id: input.receiptId,
          occurred_at: input.occurredAt,
        },
      })),
    ],
  };
}

/** يحفظ الاستلام محلياً: العملية + رقمه + إسقاطه + تحريك أرصدة الجهاز (يُنشئ رصيداً لصنف بلا رصيد
 * معروف — الاستلام يُعرِّف الرصيد). إعادة الضغط لا تنشئ هوية جديدة. */
export async function saveGoodsReceiptLocally(
  storage: StoragePort,
  input: GoodsReceiptInput,
): Promise<{ receipt: LocalGoodsReceipt; alreadySaved: boolean }> {
  const parts = {
    branchCode: input.branchCode,
    devicePrefix: input.devicePrefix,
    yearTwoDigits: input.businessDate.slice(2, 4),
  };
  const provisional = goodsReceiptDraft(input, formatGoodsReceiptNumber(parts, 0));
  const out = await saveOperation(storage, provisional, async (tx, op) => {
    const seq = Number((await tx.getMeta(GOODS_RECEIPT_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(GOODS_RECEIPT_SEQ_META, String(seq));
    const number = formatGoodsReceiptNumber(parts, seq);
    const fixed: StoredOperation = {
      ...op,
      members: op.members.map((m) =>
        m.entity === "inventory.GoodsReceipt"
          ? { ...m, payload: { ...m.payload, receipt_number: number } }
          : m,
      ),
    };
    await tx.putOperation(fixed);
    const receipt: LocalGoodsReceipt = {
      id: input.receiptId,
      receipt_number: number,
      branch_id: input.branchId,
      party_id: input.partyId ?? "",
      supplier_name: input.supplierName.trim(),
      reference: input.reference.trim(),
      user_name: input.userName,
      lines: input.lines.map((ln) => ({
        id: ln.lineId,
        item_id: ln.itemId,
        item_name: ln.itemName,
        unit_code: ln.unitCode,
        unit_name: ln.unitName,
        factor_milli: ln.factorMilli,
        qty_milli: ln.qtyMilli,
        base_qty_milli: baseQtyMilli(ln.qtyMilli, ln.factorMilli).toString(),
        unit_cost_minor: (ln.unitCostMinor ?? "").trim(),
      })),
      business_date: input.businessDate,
      occurred_at: input.occurredAt,
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: GOODS_RECEIPT_PREFIX + receipt.id, value: { ...receipt } });
    // الرصيد المحلي يتحدّث فوراً؛ صنف بلا رصيد معروف يصير معروفاً بالاستلام
    for (const m of fixed.members) {
      if (m.entity !== "inventory.StockMovement") continue;
      const key = BALANCE_PREFIX + String(m.payload["item_id"]);
      const row = await tx.getProjection(key);
      const v = (row?.value ?? { item_id: m.payload["item_id"], as_of: "" }) as {
        qty_milli?: string;
        as_of?: string;
      };
      const next = BigInt(v.qty_milli ?? "0") + BigInt(String(m.payload["delta_base_qty_milli"]));
      await tx.putProjection({ key, value: { ...v, qty_milli: next.toString() } });
    }
  });
  const row = await storage.read((tx) => tx.getProjection(GOODS_RECEIPT_PREFIX + input.receiptId));
  return { receipt: row!.value as unknown as LocalGoodsReceipt, alreadySaved: out.alreadySaved };
}

export async function readGoodsReceipts(storage: StoragePort): Promise<LocalGoodsReceipt[]> {
  const rows = await storage.read((tx) => tx.listProjections(GOODS_RECEIPT_PREFIX));
  return rows
    .map((r) => r.value as unknown as LocalGoodsReceipt)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}
