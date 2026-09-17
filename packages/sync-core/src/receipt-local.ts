/**
 * خط حفظ سند القبض/الردّ (PTY-06؛ §٧.٤، §٧.٦): عملية `payment_receipt` بعضو واحد في معاملة محلية
 * واحدة مع رقم السند والإسقاط — «بحث ثم مبلغ ثم حفظ» (§١٤.١). النقد يدخل درج الوردية فوراً
 * (SHIFT-02)؛ التحويل «مسجَّل» لا يُسقط الذمّة حتى «مطابق» (ACC-133). يخفض التراكمي دون توزيع على
 * فواتير (ACC-79).
 *
 * تنبيه Dexie: كل `await` داخل المُسقِط على المعاملة مباشرةً.
 */
import type { StoragePort, StoredOperation } from "@sting/platform";

import { saveOperation } from "./local-save";
import type { CashRow, LocalShift } from "./shift-local";
import type { OperationDraft } from "./types";

export const RECEIPT_PREFIX = "entity:parties.PaymentReceipt:";
export const RECEIPT_SEQ_META = "receipt_seq";

export type ReceiptKind = "receipt" | "refund";
export type ReceiptMethod = "cash" | "bank";

export interface ReceiptInput {
  readonly operationId: string;
  readonly receiptId: string;
  readonly partyId: string;
  readonly partyName: string;
  /** عملية إنشاء الطرف المحلية إن لم تُؤكَّد بعد. */
  readonly partyOperationId?: string | undefined;
  readonly kind: ReceiptKind;
  readonly method: ReceiptMethod;
  readonly amountMinor: string;
  readonly reference?: string | undefined;
  readonly reason?: string | undefined;
  readonly shift: LocalShift;
  readonly branchCode: string;
  readonly devicePrefix: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly userName: string;
  readonly businessDate: string;
  readonly occurredAt: string;
}

/** إسقاط السند المحلي — الأرقام سلاسل بالوحدة الصغرى. */
export interface LocalReceipt {
  readonly id: string;
  readonly receipt_number: string;
  readonly party_id: string;
  readonly party_name: string;
  readonly kind: ReceiptKind;
  readonly method: ReceiptMethod;
  readonly amount_minor: string;
  readonly reference: string;
  readonly reason: string;
  readonly shift_id: string;
  readonly branch_id: string;
  readonly user_name: string;
  readonly business_date: string;
  readonly occurred_at: string;
  readonly operation_id: string;
}

const CODE = /^[A-Z0-9]{1,6}$/;

/** `REC-<فرع>-<جهاز>-<سنة>-<تسلسل>` — عدّاد مستقل (§٨.٢). */
export function formatReceiptNumber(
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
  return `REC-${parts.branchCode}-${parts.devicePrefix}-${parts.yearTwoDigits}-${String(seq).padStart(6, "0")}`;
}

export function receiptDraft(input: ReceiptInput, receiptNumber: string): OperationDraft {
  if (BigInt(input.amountMinor) <= 0n) throw new Error("amount_required");
  if (input.method === "bank" && !(input.reference ?? "").trim())
    throw new Error("reference_required");
  if (input.kind === "refund" && !(input.reason ?? "").trim()) throw new Error("reason_required");
  return {
    operationId: input.operationId,
    kind: "payment_receipt",
    opVersion: 1,
    dependencies: [
      ...new Set([
        input.shift.operation_id,
        ...(input.partyOperationId ? [input.partyOperationId] : []),
      ]),
    ],
    members: [
      {
        entity: "parties.PaymentReceipt",
        id: input.receiptId,
        schemaVersion: 1,
        payload: {
          receipt_id: input.receiptId,
          receipt_number: receiptNumber,
          party_id: input.partyId,
          branch_id: input.shift.branch_id,
          device_id: input.deviceId,
          shift_id: input.shift.id,
          user_id: input.userId,
          kind: input.kind,
          method: input.method,
          amount_minor: input.amountMinor,
          reference: (input.reference ?? "").trim(),
          reason: (input.reason ?? "").trim(),
          business_date: input.businessDate,
          occurred_at: input.occurredAt,
        },
      },
    ],
  };
}

/** يحفظ السند محلياً: العملية + رقمه (عدّاد داخل المعاملة) + إسقاطه. إعادة الضغط لا تنشئ هوية جديدة. */
export async function saveReceiptLocally(
  storage: StoragePort,
  input: ReceiptInput,
): Promise<{ receipt: LocalReceipt; alreadySaved: boolean }> {
  const parts = {
    branchCode: input.branchCode,
    devicePrefix: input.devicePrefix,
    yearTwoDigits: input.businessDate.slice(2, 4),
  };
  const provisional = receiptDraft(input, formatReceiptNumber(parts, 0));
  const out = await saveOperation(storage, provisional, async (tx, op) => {
    const seq = Number((await tx.getMeta(RECEIPT_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(RECEIPT_SEQ_META, String(seq));
    const number = formatReceiptNumber(parts, seq);
    const fixed: StoredOperation = {
      ...op,
      members: op.members.map((m) => ({
        ...m,
        payload: { ...m.payload, receipt_number: number },
      })),
    };
    await tx.putOperation(fixed);
    const receipt: LocalReceipt = {
      id: input.receiptId,
      receipt_number: number,
      party_id: input.partyId,
      party_name: input.partyName,
      kind: input.kind,
      method: input.method,
      amount_minor: input.amountMinor,
      reference: (input.reference ?? "").trim(),
      reason: (input.reason ?? "").trim(),
      shift_id: input.shift.id,
      branch_id: input.shift.branch_id,
      user_name: input.userName,
      business_date: input.businessDate,
      occurred_at: input.occurredAt,
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: RECEIPT_PREFIX + receipt.id, value: { ...receipt } });
  });
  const row = await storage.read((tx) => tx.getProjection(RECEIPT_PREFIX + input.receiptId));
  return { receipt: row!.value as unknown as LocalReceipt, alreadySaved: out.alreadySaved };
}

export async function readReceipts(storage: StoragePort): Promise<LocalReceipt[]> {
  const rows = await storage.read((tx) => tx.listProjections(RECEIPT_PREFIX));
  return rows
    .map((r) => r.value as unknown as LocalReceipt)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

/**
 * السندات المحلية غير المغطّاة بالرصيد الخادمي لطرف (غير المؤكَّدة أو بعد `balance_as_of`)، مع
 * أثرها الفعلي: النقد يخفّض الذمّة فوراً؛ التحويل غير المطابق لا أثر له (ACC-133).
 */
export async function readPendingReceiptsByParty(
  storage: StoragePort,
): Promise<Map<string, { readonly signedMinor: bigint; readonly rows: LocalReceipt[] }>> {
  return storage.read(async (tx) => {
    const out = new Map<string, { signedMinor: bigint; rows: LocalReceipt[] }>();
    const rows = (await tx.listProjections(RECEIPT_PREFIX)).map(
      (r) => r.value as unknown as LocalReceipt,
    );
    const asOfByParty = new Map<string, string>();
    for (const r of rows) {
      if (asOfByParty.has(r.party_id)) continue;
      const p = await tx.getProjection(`entity:parties.Party:${r.party_id}`);
      asOfByParty.set(
        r.party_id,
        (p?.value as { balance_as_of?: string } | undefined)?.balance_as_of ?? "",
      );
    }
    for (const r of rows) {
      const op = await tx.getOperation(r.operation_id);
      const asOf = asOfByParty.get(r.party_id) ?? "";
      const covered = op?.state === "synced" && (!asOf || r.occurred_at <= asOf);
      if (covered) continue;
      const cur = out.get(r.party_id) ?? { signedMinor: 0n, rows: [] };
      const effect =
        r.method === "bank"
          ? 0n
          : r.kind === "receipt"
            ? -BigInt(r.amount_minor)
            : BigInt(r.amount_minor);
      out.set(r.party_id, { signedMinor: cur.signedMinor + effect, rows: [...cur.rows, r] });
    }
    return out;
  });
}

/** سطور السند النقدي لدرج الوردية (SHIFT-02): السداد يدخل والردّ يخرج؛ التحويل خارج الصندوق. */
export async function readReceiptCashRows(
  storage: StoragePort,
  shiftId: string,
): Promise<CashRow[]> {
  const [rows, ops] = await storage.read(async (tx) => {
    const list = (await tx.listProjections(RECEIPT_PREFIX))
      .map((r) => r.value as unknown as LocalReceipt)
      .filter((r) => r.shift_id === shiftId);
    const opById = new Map<string, StoredOperation>();
    for (const r of list) {
      const op = await tx.getOperation(r.operation_id);
      if (op) opById.set(r.operation_id, op);
    }
    return [list, opById] as const;
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
  return rows.map((r) => {
    const amount = BigInt(r.amount_minor);
    const cash = r.method === "cash";
    return {
      doc: r.receipt_number,
      time: r.occurred_at,
      kind: r.kind === "receipt" ? "receipt" : "refund",
      note: r.kind === "receipt" ? `سداد من ${r.party_name}` : `ردّ إلى ${r.party_name}`,
      inCashMinor: cash ? (r.kind === "receipt" ? amount : -amount).toString() : null,
      outCashMinor: cash ? null : amount.toString(),
      sync: syncOf(ops.get(r.operation_id)),
    };
  });
}
