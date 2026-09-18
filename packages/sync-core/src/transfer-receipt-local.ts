/**
 * خط حفظ استلام التحويل (INV-10؛ §١٠.٢، ACC-18): عملية `transfer_receipt` — إشعار الاستلام وسطوره
 * وحركات الدخول إلى فرع الوجهة (`transfer_in` = المستلم فعلاً) — في معاملة محلية واحدة مع رقم الإشعار
 * والإسقاط وزيادة رصيد الجهاز. الفرق يبقى في الطريق محجوزاً بسبب مكتوب؛ الإشعار نفسه مرتين = استلام واحد
 * (المعرّف ثابت للإشعار).
 *
 * تنبيه Dexie: كل `await` داخل المُسقِط على المعاملة مباشرةً.
 */
import type { StoragePort, StoredOperation } from "@sting/platform";

import { saveOperation } from "./local-save";
import { BALANCE_PREFIX } from "./pos-local";
import { TRANSFER_PREFIX } from "./transfer-local";
import type { OperationDraft } from "./types";

export const TRANSFER_RECEIPT_PREFIX = "entity:inventory.TransferReceipt:";
export const TRANSFER_RECEIPT_SEQ_META = "transfer_receipt_seq";

export interface ReceiptLineInput {
  readonly lineId: string;
  readonly movementId: string;
  readonly transferLineId: string;
  readonly itemId: string;
  readonly sentBaseMilli: string;
  readonly receivedBaseMilli: string;
}

export interface TransferReceiptInput {
  readonly operationId: string;
  readonly receiptId: string;
  readonly transferId: string;
  readonly transferOperationId?: string | undefined;
  readonly branchId: string;
  readonly branchCode: string;
  readonly devicePrefix: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly userName: string;
  readonly reason: string;
  readonly lines: readonly ReceiptLineInput[];
  readonly receivedAt: string;
}

export interface LocalTransferReceipt {
  readonly id: string;
  readonly receipt_number: string;
  readonly transfer_id: string;
  readonly branch_id: string;
  readonly user_name: string;
  readonly reason: string;
  readonly lines: readonly {
    readonly id: string;
    readonly transfer_line_id: string;
    readonly item_id: string;
    readonly sent_base_milli: string;
    readonly received_base_milli: string;
  }[];
  readonly received_at: string;
  readonly operation_id: string;
}

const CODE = /^[A-Z0-9]{1,6}$/;

/** `TRR-<فرع>-<جهاز>-<سنة>-<تسلسل>` — عدّاد مستقل (§٨.٢). */
export function formatTransferReceiptNumber(
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
  return `TRR-${parts.branchCode}-${parts.devicePrefix}-${parts.yearTwoDigits}-${String(seq).padStart(6, "0")}`;
}

export function hasVariance(lines: readonly ReceiptLineInput[]): boolean {
  return lines.some((l) => BigInt(l.receivedBaseMilli) !== BigInt(l.sentBaseMilli));
}

export function transferReceiptDraft(input: TransferReceiptInput, number: string): OperationDraft {
  if (input.lines.length === 0) throw new Error("lines_required");
  for (const l of input.lines) if (BigInt(l.receivedBaseMilli) < 0n) throw new Error("qty_invalid");
  if (hasVariance(input.lines) && !input.reason.trim()) throw new Error("reason_required");
  return {
    operationId: input.operationId,
    kind: "transfer_receipt",
    opVersion: 1,
    dependencies: input.transferOperationId ? [input.transferOperationId] : [],
    members: [
      {
        entity: "inventory.TransferReceipt",
        id: input.receiptId,
        schemaVersion: 1,
        payload: {
          receipt_id: input.receiptId,
          receipt_number: number,
          transfer_id: input.transferId,
          branch_id: input.branchId,
          device_id: input.deviceId,
          user_id: input.userId,
          reason: input.reason.trim(),
          received_at: input.receivedAt,
        },
      },
      ...input.lines.map((l) => ({
        entity: "inventory.TransferReceiptLine",
        id: l.lineId,
        schemaVersion: 1,
        payload: {
          line_id: l.lineId,
          receipt_id: input.receiptId,
          transfer_line_id: l.transferLineId,
          item_id: l.itemId,
          sent_base_milli: l.sentBaseMilli,
          received_base_milli: l.receivedBaseMilli,
        },
      })),
      ...input.lines
        .filter((l) => BigInt(l.receivedBaseMilli) > 0n)
        .map((l) => ({
          entity: "inventory.StockMovement",
          id: l.movementId,
          schemaVersion: 1,
          payload: {
            movement_id: l.movementId,
            branch_id: input.branchId,
            item_id: l.itemId,
            delta_base_qty_milli: l.receivedBaseMilli,
            reason: "transfer_in",
            source_entity: "inventory.TransferReceipt",
            source_id: input.receiptId,
            occurred_at: input.receivedAt,
          },
        })),
    ],
  };
}

/** يحفظ الاستلام محلياً: العملية + رقمه + إسقاطه + زيادة رصيد الوجهة على الجهاز، وتحديث «المستلم»
 * على إسقاط التحويل إن وُجد محلياً. إعادة الضغط لا تنشئ هوية جديدة ولا تضاعف. */
export async function saveTransferReceiptLocally(
  storage: StoragePort,
  input: TransferReceiptInput,
): Promise<{ receipt: LocalTransferReceipt; alreadySaved: boolean }> {
  const parts = {
    branchCode: input.branchCode,
    devicePrefix: input.devicePrefix,
    yearTwoDigits: input.receivedAt.slice(2, 4),
  };
  const provisional = transferReceiptDraft(input, formatTransferReceiptNumber(parts, 0));
  const out = await saveOperation(storage, provisional, async (tx, op) => {
    const seq = Number((await tx.getMeta(TRANSFER_RECEIPT_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(TRANSFER_RECEIPT_SEQ_META, String(seq));
    const number = formatTransferReceiptNumber(parts, seq);
    const fixed: StoredOperation = {
      ...op,
      members: op.members.map((m) =>
        m.entity === "inventory.TransferReceipt"
          ? { ...m, payload: { ...m.payload, receipt_number: number } }
          : m,
      ),
    };
    await tx.putOperation(fixed);
    const receipt: LocalTransferReceipt = {
      id: input.receiptId,
      receipt_number: number,
      transfer_id: input.transferId,
      branch_id: input.branchId,
      user_name: input.userName,
      reason: input.reason.trim(),
      lines: input.lines.map((l) => ({
        id: l.lineId,
        transfer_line_id: l.transferLineId,
        item_id: l.itemId,
        sent_base_milli: l.sentBaseMilli,
        received_base_milli: l.receivedBaseMilli,
      })),
      received_at: input.receivedAt,
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: TRANSFER_RECEIPT_PREFIX + receipt.id, value: { ...receipt } });
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
    const tRow = await tx.getProjection(TRANSFER_PREFIX + input.transferId);
    if (tRow) {
      const t = tRow.value as {
        status?: string;
        lines?: { id: string; base_qty_milli: string; received_base_milli: string }[];
      };
      const got = new Map(input.lines.map((l) => [l.transferLineId, l.receivedBaseMilli]));
      const lines = (t.lines ?? []).map((l) => ({
        ...l,
        received_base_milli: got.get(l.id) ?? l.received_base_milli,
      }));
      const full = lines.every((l) => l.received_base_milli === l.base_qty_milli);
      await tx.putProjection({
        key: TRANSFER_PREFIX + input.transferId,
        value: { ...t, lines, status: full ? "received" : "partially_received" },
      });
    }
  });
  const row = await storage.read((tx) =>
    tx.getProjection(TRANSFER_RECEIPT_PREFIX + input.receiptId),
  );
  return { receipt: row!.value as unknown as LocalTransferReceipt, alreadySaved: out.alreadySaved };
}
