/**
 * الوردية محلياً (§١٠.٣؛ SHIFT-01/02): `ShiftOpened` حدث ثابت يُحفظ محلياً كعملية `shift_open`
 * ويُزامَن بنطاق الفرع فور إنشائه — البيع يرفق تبعية فتح الوردية غير المؤكدة ولا ينتظر إغلاقها
 * (ACC-34). الإسقاط محلي مشتق: `entity:shifts.Shift:{id}` + meta `shift.open` (تقرؤه الرئيسية
 * وACC-08). أرقام الوردية محلية أصلاً — ما بيع على هذا الجهاز معروفٌ له.
 */
import { type CashTotals, expectedCashMinor } from "@sting/domain";
import type { StoragePort, StoredOperation } from "@sting/platform";

import { saveOperation } from "./local-save";
import type { OperationDraft } from "./types";

export const SHIFT_PREFIX = "entity:shifts.Shift:";
export const SHIFT_OPEN_META = "shift.open";
const SHIFT_SEQ_META = "shift_seq";

export interface LocalShift {
  readonly id: string;
  /** رقم العرض «OPEN-0091» — التسلسل محلي لكل جهاز؛ UUID هو الهوية. */
  readonly number: string;
  readonly branch_id: string;
  readonly branch_name: string;
  readonly device_id: string;
  readonly device_name: string;
  readonly user_id: string;
  readonly user_name: string;
  readonly opening_float_minor: string;
  readonly business_date: string;
  readonly opened_at: string;
  readonly state: "open" | "closed";
  readonly closed_at: string;
  readonly operation_id: string;
}

export interface OpenShiftInput {
  readonly shiftId: string;
  readonly operationId: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly userId: string;
  readonly userName: string;
  /** المعدود الافتتاحي — سلسلة قانونية بالوحدة الصغرى؛ الصفر يُدخَل صراحةً. */
  readonly openingFloatMinor: string;
  readonly businessDate: string;
  readonly occurredAt: string;
}

export function shiftOpenDraft(i: OpenShiftInput): OperationDraft {
  return {
    operationId: i.operationId,
    kind: "shift_open",
    opVersion: 1,
    dependencies: [],
    members: [
      {
        entity: "shifts.ShiftOpened",
        id: i.shiftId,
        schemaVersion: 1,
        payload: {
          shift_id: i.shiftId,
          branch_id: i.branchId,
          device_id: i.deviceId,
          user_id: i.userId,
          opening_float_minor: i.openingFloatMinor,
          business_date: i.businessDate,
          occurred_at: i.occurredAt,
        },
      },
    ],
  };
}

/**
 * يحفظ فتح الوردية محلياً في معاملة واحدة (العملية + الإسقاط + meta) — لا نجاح قبل اكتمالها.
 * تنبيه Dexie: كل `await` داخل المُسقِط على المعاملة مباشرةً — استدعاء دالة async مساعدة يُقفل
 * المعاملة قبل أوانها (PrematureCommitError).
 */
export async function openShiftLocally(
  storage: StoragePort,
  input: OpenShiftInput,
): Promise<{ shift: LocalShift; alreadySaved: boolean }> {
  const out = await saveOperation(storage, shiftOpenDraft(input), async (tx, op) => {
    const seq = Number((await tx.getMeta(SHIFT_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(SHIFT_SEQ_META, String(seq));
    const shift: LocalShift = {
      id: input.shiftId,
      number: `OPEN-${String(seq).padStart(4, "0")}`,
      branch_id: input.branchId,
      branch_name: input.branchName,
      device_id: input.deviceId,
      device_name: input.deviceName,
      user_id: input.userId,
      user_name: input.userName,
      opening_float_minor: input.openingFloatMinor,
      business_date: input.businessDate,
      opened_at: input.occurredAt,
      state: "open",
      closed_at: "",
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: SHIFT_PREFIX + shift.id, value: { ...shift } });
    await tx.putMeta(
      SHIFT_OPEN_META,
      JSON.stringify({ shift_id: shift.id, opened_at: shift.opened_at }),
    );
  });
  const row = await storage.read((tx) => tx.getProjection(SHIFT_PREFIX + input.shiftId));
  return { shift: row!.value as unknown as LocalShift, alreadySaved: out.alreadySaved };
}

/** الوردية المفتوحة على هذا الجهاز (من meta `shift.open`) أو null. */
export async function readOpenShift(storage: StoragePort): Promise<LocalShift | null> {
  return storage.read(async (tx) => {
    const meta = await tx.getMeta(SHIFT_OPEN_META);
    if (!meta) return null;
    const { shift_id } = JSON.parse(meta) as { shift_id: string };
    const row = await tx.getProjection(SHIFT_PREFIX + shift_id);
    return row ? (row.value as unknown as LocalShift) : null;
  });
}

export async function readShift(storage: StoragePort, shiftId: string): Promise<LocalShift | null> {
  const row = await storage.read((tx) => tx.getProjection(SHIFT_PREFIX + shiftId));
  return row ? (row.value as unknown as LocalShift) : null;
}

export type CashRowSync = "synced" | "pending" | "conflict" | "quarantined";

/** صف في جدول الوردية (SHIFT-02): الوقت والمستند، البيان، داخل/خارج الصندوق، المزامنة. */
export interface CashRow {
  readonly doc: string;
  readonly time: string;
  readonly kind: "opening" | "deposit" | "withdrawal" | "sale" | "receipt" | "refund";
  readonly note: string;
  /** يدخل الصندوق (موجب) أو يخرج منه (سالب) — بالوحدة الصغرى؛ null = لا نقد. */
  readonly inCashMinor: string | null;
  /** خارج الصندوق (آجل/تحويل) — لا يُحتسب في المتوقَّع. */
  readonly outCashMinor: string | null;
  readonly sync: CashRowSync;
}

export interface ShiftCash {
  readonly rows: readonly CashRow[];
  readonly totals: CashTotals;
  readonly expectedCashMinor: bigint;
  /** عدد الحركات غير المؤكدة من هذا الجهاز — «يشمل حركتين معلقتين من هذا الجهاز». */
  readonly pendingCount: number;
  readonly openingSync: CashRowSync;
}

const syncOf = (op: StoredOperation | null): CashRowSync =>
  !op
    ? "synced"
    : op.state === "synced"
      ? "synced"
      : op.state === "conflict"
        ? "conflict"
        : op.state === "quarantined"
          ? "quarantined"
          : "pending";

/**
 * حركات الوردية النقدية من عمليات هذا الجهاز: الافتتاح وحركات الصندوق (SHIFT-03) — والبيع والسداد
 * والمرتجع تُضاف مع POS/PTY عبر `extraRows`. المتوقَّع من المجال (لا حساب في الواجهة).
 */
export async function readShiftCash(
  storage: StoragePort,
  shift: LocalShift,
  extraRows: readonly CashRow[] = [],
): Promise<ShiftCash> {
  const ops = await storage.read(async (tx) => {
    const all: StoredOperation[] = [];
    for (const st of ["local", "pending", "synced", "conflict", "quarantined"] as const)
      all.push(...(await tx.listOperationsByState(st)));
    return all;
  });
  const openOp = ops.find((o) => o.operationId === shift.operation_id) ?? null;
  const rows: CashRow[] = [
    {
      doc: shift.number,
      time: shift.opened_at,
      kind: "opening",
      note: shift.user_name,
      inCashMinor: shift.opening_float_minor,
      outCashMinor: null,
      sync: syncOf(openOp),
    },
  ];
  let deposits = 0n;
  let withdrawals = 0n;
  for (const op of ops) {
    if (op.kind !== "cash_movement") continue;
    const m = op.members[0];
    if (!m || m.payload["shift_id"] !== shift.id) continue;
    const amount = BigInt(String(m.payload["signed_amount_minor"]));
    const kind = m.payload["kind"] === "withdrawal" ? "withdrawal" : "deposit";
    if (kind === "deposit") deposits += amount;
    else withdrawals += -amount;
    rows.push({
      doc: String(m.payload["movement_id"]).slice(0, 8).toUpperCase(),
      time: typeof m.payload["occurred_at"] === "string" ? m.payload["occurred_at"] : "",
      kind,
      note: typeof m.payload["reason"] === "string" ? m.payload["reason"] : "",
      inCashMinor: amount.toString(),
      outCashMinor: null,
      sync: syncOf(op),
    });
  }
  let sales = 0n;
  let receipts = 0n;
  let refunds = 0n;
  for (const r of extraRows) {
    const v = r.inCashMinor ? BigInt(r.inCashMinor) : 0n;
    if (r.kind === "sale") sales += v;
    else if (r.kind === "receipt") receipts += v;
    else if (r.kind === "refund") refunds += -v;
    rows.push(r);
  }
  const totals: CashTotals = {
    openingFloatMinor: BigInt(shift.opening_float_minor),
    cashSalesMinor: sales,
    cashDebtReceiptsMinor: receipts,
    cashDepositsMinor: deposits,
    cashRefundsMinor: refunds,
    cashWithdrawalsMinor: withdrawals,
  };
  rows.sort((a, b) => a.time.localeCompare(b.time));
  return {
    rows,
    totals,
    expectedCashMinor: expectedCashMinor(totals),
    pendingCount: rows.filter((r) => r.sync === "pending").length,
    openingSync: syncOf(openOp),
  };
}
