/**
 * خط حفظ التحويل بين فرعين (INV-09؛ §١٠.٢): عملية `stock_transfer` — رأس التحويل وسطوره وحركات
 * الخروج من فرع المصدر (`transfer_out`) — في معاملة محلية واحدة مع رقم التحويل والإسقاط وخصم رصيد
 * الجهاز. البضاعة تصبح «في الطريق» — لا تُضاف للمستقبِل حتى استلام مستقلّ (INV-10). بلا شبكة:
 * محفوظ محلياً والفرع المستقبل لا يعلم حتى تعود الشبكة.
 *
 * تنبيه Dexie: كل `await` داخل المُسقِط على المعاملة مباشرةً.
 */
import type { StoragePort, StoredOperation } from "@sting/platform";

import { saveOperation } from "./local-save";
import { BALANCE_PREFIX } from "./pos-local";
import type { OperationDraft } from "./types";

export const TRANSFER_PREFIX = "entity:inventory.StockTransfer:";
export const TRANSFER_SEQ_META = "transfer_seq";

export interface TransferLineInput {
  readonly lineId: string;
  readonly movementId: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly unitName: string;
  readonly factorMilli: string;
  readonly qtyMilli: string;
  /** المتاح بالمصدر وقت الإرسال — لا نسمح بتحويل ما ليس موجوداً */
  readonly availableMilli: string;
}

export interface TransferInput {
  readonly operationId: string;
  readonly transferId: string;
  readonly branchFromId: string;
  readonly branchFromName: string;
  readonly branchToId: string;
  readonly branchToName: string;
  readonly branchCode: string;
  readonly devicePrefix: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly userName: string;
  readonly note?: string | undefined;
  readonly lines: readonly TransferLineInput[];
  readonly sentAt: string;
}

export interface LocalTransferLine {
  readonly id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly unit_name: string;
  readonly factor_milli: string;
  readonly qty_milli: string;
  readonly base_qty_milli: string;
  readonly received_base_milli: string;
}

export interface LocalTransfer {
  readonly id: string;
  readonly transfer_number: string;
  readonly branch_from_id: string;
  readonly branch_from_name: string;
  readonly branch_to_id: string;
  readonly branch_to_name: string;
  readonly status: "sent" | "partially_received" | "received" | "cancelled";
  readonly user_name: string;
  readonly note: string;
  readonly lines: readonly LocalTransferLine[];
  readonly sent_at: string;
  readonly operation_id: string;
}

const CODE = /^[A-Z0-9]{1,6}$/;

/** `TRF-<فرع>-<جهاز>-<سنة>-<تسلسل>` — عدّاد مستقل (§٨.٢). */
export function formatTransferNumber(
  parts: { branchCode: string; devicePrefix: string; yearTwoDigits: string },
  seq: number,
): string {
  if (
    !CODE.test(parts.branchCode) ||
    !CODE.test(parts.devicePrefix) ||
    !/^[0-9]{2}$/.test(parts.yearTwoDigits)
  ) {
    throw new Error("invalid transfer number parts");
  }
  return `TRF-${parts.branchCode}-${parts.devicePrefix}-${parts.yearTwoDigits}-${String(seq).padStart(6, "0")}`;
}

const base = (ln: TransferLineInput): bigint =>
  (BigInt(ln.qtyMilli) * BigInt(ln.factorMilli)) / 1000n;

export function transferDraft(input: TransferInput, number: string): OperationDraft {
  if (input.branchFromId === input.branchToId) throw new Error("same_branch");
  if (input.lines.length === 0) throw new Error("lines_required");
  for (const ln of input.lines) {
    if (BigInt(ln.qtyMilli || "0") <= 0n) throw new Error("qty_required");
    if (BigInt(ln.factorMilli || "0") <= 0n) throw new Error("unit_factor_undefined");
    if (base(ln) > BigInt(ln.availableMilli || "0")) throw new Error("exceeds_available");
  }
  return {
    operationId: input.operationId,
    kind: "stock_transfer",
    opVersion: 1,
    dependencies: [],
    members: [
      {
        entity: "inventory.StockTransfer",
        id: input.transferId,
        schemaVersion: 1,
        payload: {
          transfer_id: input.transferId,
          transfer_number: number,
          branch_from_id: input.branchFromId,
          branch_to_id: input.branchToId,
          device_id: input.deviceId,
          user_id: input.userId,
          note: (input.note ?? "").trim(),
          sent_at: input.sentAt,
        },
      },
      ...input.lines.map((ln) => ({
        entity: "inventory.StockTransferLine",
        id: ln.lineId,
        schemaVersion: 1,
        payload: {
          line_id: ln.lineId,
          transfer_id: input.transferId,
          item_id: ln.itemId,
          item_name: ln.itemName,
          unit_code: ln.unitCode,
          unit_name: ln.unitName,
          factor_milli: ln.factorMilli,
          qty_milli: ln.qtyMilli,
          base_qty_milli: base(ln).toString(),
        },
      })),
      ...input.lines.map((ln) => ({
        entity: "inventory.StockMovement",
        id: ln.movementId,
        schemaVersion: 1,
        payload: {
          movement_id: ln.movementId,
          branch_id: input.branchFromId,
          item_id: ln.itemId,
          delta_base_qty_milli: (-base(ln)).toString(),
          reason: "transfer_out",
          source_entity: "inventory.StockTransfer",
          source_id: input.transferId,
          occurred_at: input.sentAt,
        },
      })),
    ],
  };
}

/** يحفظ التحويل محلياً: العملية + رقمه + إسقاطه + خصم رصيد المصدر على الجهاز. لا إضافة للمستقبِل. */
export async function saveTransferLocally(
  storage: StoragePort,
  input: TransferInput,
): Promise<{ transfer: LocalTransfer; alreadySaved: boolean }> {
  const parts = {
    branchCode: input.branchCode,
    devicePrefix: input.devicePrefix,
    yearTwoDigits: input.sentAt.slice(2, 4),
  };
  const provisional = transferDraft(input, formatTransferNumber(parts, 0));
  const out = await saveOperation(storage, provisional, async (tx, op) => {
    const seq = Number((await tx.getMeta(TRANSFER_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(TRANSFER_SEQ_META, String(seq));
    const number = formatTransferNumber(parts, seq);
    const fixed: StoredOperation = {
      ...op,
      members: op.members.map((m) =>
        m.entity === "inventory.StockTransfer"
          ? { ...m, payload: { ...m.payload, transfer_number: number } }
          : m,
      ),
    };
    await tx.putOperation(fixed);
    const transfer: LocalTransfer = {
      id: input.transferId,
      transfer_number: number,
      branch_from_id: input.branchFromId,
      branch_from_name: input.branchFromName,
      branch_to_id: input.branchToId,
      branch_to_name: input.branchToName,
      status: "sent",
      user_name: input.userName,
      note: (input.note ?? "").trim(),
      lines: input.lines.map((ln) => ({
        id: ln.lineId,
        item_id: ln.itemId,
        item_name: ln.itemName,
        unit_name: ln.unitName,
        factor_milli: ln.factorMilli,
        qty_milli: ln.qtyMilli,
        base_qty_milli: base(ln).toString(),
        received_base_milli: "0",
      })),
      sent_at: input.sentAt,
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: TRANSFER_PREFIX + transfer.id, value: { ...transfer } });
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
  const row = await storage.read((tx) => tx.getProjection(TRANSFER_PREFIX + input.transferId));
  return { transfer: row!.value as unknown as LocalTransfer, alreadySaved: out.alreadySaved };
}

export async function readLocalTransfers(storage: StoragePort): Promise<LocalTransfer[]> {
  const rows = await storage.read((tx) => tx.listProjections(TRANSFER_PREFIX));
  return rows
    .map((r) => r.value as unknown as LocalTransfer)
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at));
}
