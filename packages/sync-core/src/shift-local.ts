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
  readonly kind: "opening" | "deposit" | "withdrawal" | "expense" | "sale" | "receipt" | "refund";
  readonly note: string;
  /** يدخل الصندوق (موجب) أو يخرج منه (سالب) — بالوحدة الصغرى؛ null = لا نقد. */
  readonly inCashMinor: string | null;
  /** خارج الصندوق (آجل/تحويل) — لا يُحتسب في المتوقَّع. */
  readonly outCashMinor: string | null;
  readonly sync: CashRowSync;
  /** حركة عكسٍ لحركة سابقة. */
  readonly reversal?: boolean | undefined;
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
    const kind: CashRow["kind"] =
      m.payload["kind"] === "withdrawal"
        ? "withdrawal"
        : m.payload["kind"] === "expense"
          ? "expense"
          : "deposit";
    // الإشارة تحكم (العكس بالإشارة المضادّة)
    if (amount > 0n) deposits += amount;
    else withdrawals += -amount;
    const number = typeof m.payload["number"] === "string" ? m.payload["number"] : "";
    rows.push({
      doc: number || String(m.payload["movement_id"]).slice(0, 8).toUpperCase(),
      time: typeof m.payload["occurred_at"] === "string" ? m.payload["occurred_at"] : "",
      kind,
      note: typeof m.payload["reason"] === "string" ? m.payload["reason"] : "",
      inCashMinor: amount.toString(),
      outCashMinor: null,
      sync: syncOf(op),
      reversal: typeof m.payload["reverses_movement_id"] === "string",
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

// ─── حركة صندوق (SHIFT-03) ────────────────────────────────────────────────

export type CashMovementKind = "deposit" | "withdrawal" | "expense";
const MOVEMENT_SEQ_META = "cash_movement_seq";

export interface CashMovementInput {
  readonly movementId: string;
  readonly operationId: string;
  readonly shift: LocalShift;
  readonly kind: CashMovementKind;
  /** المبلغ موجب بالوحدة الصغرى؛ الإشارة تُشتق من النوع (والعكس يقلبها). */
  readonly amountMinor: string;
  readonly reason: string;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly authorizedByUserId?: string | undefined;
  /** عكس حركة سابقة: حركة مضادّة تشير إليها — لا حذف ولا تعديل. */
  readonly reversesMovementId?: string | undefined;
  readonly occurredAt: string;
}

export interface LocalCashMovement {
  readonly id: string;
  readonly number: string;
  readonly shift_id: string;
  readonly kind: CashMovementKind;
  readonly signed_amount_minor: string;
  readonly reason: string;
  readonly actor_user_id: string;
  readonly actor_name: string;
  readonly reverses_movement_id: string;
  readonly occurred_at: string;
  readonly operation_id: string;
}

export const MOVEMENT_PREFIX = "entity:shifts.CashMovement:";

/** الإشارة: الإيداع موجب، السحب والمصروف سالبان؛ العكس بالإشارة المضادّة لإشارة الأصل. */
export function signedAmount(
  kind: CashMovementKind,
  amountMinor: string,
  reversal: boolean,
): string {
  const v = BigInt(amountMinor);
  const base = kind === "deposit" ? v : -v;
  return (reversal ? -base : base).toString();
}

export async function saveCashMovement(
  storage: StoragePort,
  input: CashMovementInput,
): Promise<{ movement: LocalCashMovement; alreadySaved: boolean }> {
  const signed = signedAmount(input.kind, input.amountMinor, Boolean(input.reversesMovementId));
  const draft: OperationDraft = {
    operationId: input.operationId,
    kind: "cash_movement",
    opVersion: 1,
    dependencies: [input.shift.operation_id],
    members: [
      {
        entity: "shifts.CashMovement",
        id: input.movementId,
        schemaVersion: 1,
        payload: {
          movement_id: input.movementId,
          shift_id: input.shift.id,
          kind: input.kind,
          signed_amount_minor: signed,
          reason: input.reason,
          actor_user_id: input.actorUserId,
          ...(input.authorizedByUserId ? { authorized_by_user_id: input.authorizedByUserId } : {}),
          ...(input.reversesMovementId ? { reverses_movement_id: input.reversesMovementId } : {}),
          occurred_at: input.occurredAt,
        },
      },
    ],
  };
  const out = await saveOperation(storage, draft, async (tx, op) => {
    // كل await على المعاملة مباشرةً (Dexie)
    const seq = Number((await tx.getMeta(MOVEMENT_SEQ_META)) ?? "100") + 1;
    await tx.putMeta(MOVEMENT_SEQ_META, String(seq));
    const row: LocalCashMovement = {
      id: input.movementId,
      number: String(seq),
      shift_id: input.shift.id,
      kind: input.kind,
      signed_amount_minor: signed,
      reason: input.reason,
      actor_user_id: input.actorUserId,
      actor_name: input.actorName,
      reverses_movement_id: input.reversesMovementId ?? "",
      occurred_at: input.occurredAt,
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: MOVEMENT_PREFIX + row.id, value: { ...row } });
    // الرقم يُثبَّت في الحدث نفسه ليصل الأجهزة الأخرى
    await tx.putOperation({
      ...op,
      members: op.members.map((m) => ({ ...m, payload: { ...m.payload, number: String(seq) } })),
    });
  });
  const row = await storage.read((tx) => tx.getProjection(MOVEMENT_PREFIX + input.movementId));
  return { movement: row!.value as unknown as LocalCashMovement, alreadySaved: out.alreadySaved };
}

export async function readMovements(
  storage: StoragePort,
  shiftId: string,
): Promise<LocalCashMovement[]> {
  const rows = await storage.read((tx) => tx.listProjections(MOVEMENT_PREFIX));
  return rows
    .map((r) => r.value as unknown as LocalCashMovement)
    .filter((m) => m.shift_id === shiftId)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

// ─── الإقفال بالعدّ (SHIFT-04) ───────────────────────────────────────────

export interface Denomination {
  readonly face_minor: string;
  readonly count: number;
}

export interface CloseShiftInput {
  readonly operationId: string;
  readonly countId: string;
  readonly closeId: string;
  readonly shift: LocalShift;
  /** المعدود بالوحدة الصغرى؛ null = إقفال بلا عدّ («بلا عدّ» يُعلن والفرق غير معروف). */
  readonly countedCashMinor: string | null;
  readonly denominations: readonly Denomination[];
  /** المتوقَّع لحظة الإقفال — لقطة ثابتة من بيانات الجهاز (قد تنقصها مبيعات أجهزة أخرى). */
  readonly expectedCashAtCloseMinor: string;
  readonly actorUserId: string;
  readonly actorName: string;
  readonly witnessUserId?: string | undefined;
  readonly occurredAt: string;
}

export const SHIFT_CLOSED_LOCAL_META = "shift.closed_local";

/**
 * يقفل الوردية محلياً: عملية `shift_close` (ShiftClosed + CashCounted) في معاملة واحدة مع تحديث
 * الإسقاط (`state=closed`، اللقطة، المعدود) ومسح meta `shift.open`. الشهادة وقائع لا تحتاج شبكة؛
 * الفارق وحده يُعاد حسابه بعد المزامنة.
 */
export async function closeShiftLocally(
  storage: StoragePort,
  input: CloseShiftInput,
): Promise<{ shift: LocalShift; alreadySaved: boolean }> {
  const counted = input.countedCashMinor !== null;
  const draft: OperationDraft = {
    operationId: input.operationId,
    kind: "shift_close",
    opVersion: 1,
    dependencies: [input.shift.operation_id],
    members: [
      {
        entity: "shifts.ShiftClosed",
        id: input.closeId,
        schemaVersion: 1,
        payload: {
          shift_id: input.shift.id,
          expected_cash_at_close_minor: input.expectedCashAtCloseMinor,
          count_status: counted ? "counted" : "not_counted",
          expected_source: "device",
          actor_user_id: input.actorUserId,
          occurred_at: input.occurredAt,
        },
      },
      ...(counted
        ? [
            {
              entity: "shifts.CashCounted",
              id: input.countId,
              schemaVersion: 1,
              payload: {
                count_id: input.countId,
                shift_id: input.shift.id,
                counted_cash_minor: input.countedCashMinor,
                denominations: input.denominations.map((d) => ({ ...d })),
                actor_user_id: input.actorUserId,
                ...(input.witnessUserId ? { witness_user_id: input.witnessUserId } : {}),
                occurred_at: input.occurredAt,
              },
            },
          ]
        : []),
    ],
  };
  const out = await saveOperation(storage, draft, async (tx, op) => {
    const closed = {
      ...input.shift,
      state: "closed" as const,
      closed_at: input.occurredAt,
      close_operation_id: op.operationId,
      expected_cash_at_close_minor: input.expectedCashAtCloseMinor,
      counted_cash_minor: input.countedCashMinor ?? "",
      count_status: counted ? "counted" : "not_counted",
      counted_by_name: input.actorName,
      denominations: input.denominations.map((d) => ({ ...d })),
    };
    await tx.putProjection({ key: SHIFT_PREFIX + input.shift.id, value: closed });
    await tx.putMeta(SHIFT_OPEN_META, "");
    await tx.putMeta(
      SHIFT_CLOSED_LOCAL_META,
      JSON.stringify({ shift_id: input.shift.id, closed_at: input.occurredAt }),
    );
  });
  const row = await storage.read((tx) => tx.getProjection(SHIFT_PREFIX + input.shift.id));
  return { shift: row!.value as unknown as LocalShift, alreadySaved: out.alreadySaved };
}

/** وردية مقفلة محلياً وحدث إقفالها غير مؤكد بعد (SHIFT-02 stale). */
export interface ClosedShift extends LocalShift {
  readonly close_operation_id: string;
  readonly expected_cash_at_close_minor: string;
  readonly counted_cash_minor: string;
  readonly count_status: "counted" | "not_counted";
  readonly counted_by_name: string;
  readonly denominations: readonly Denomination[];
}

/**
 * الورديات المقفلة على هذا الجهاز وحدث إقفالها لم يصل الخادم بعد (SHIFT-05 stale: «وردية أُقفلت
 * على جهازٍ لم يرفع بعد، فرقمها هنا ناقص» — تُسمّى وتُستثنى من المجموع). القراءة من الإسقاط
 * والطابور معاً؛ الحالة `synced` وحدها تُخرج الوردية من هذه القائمة.
 */
export async function readPendingClosedShifts(storage: StoragePort): Promise<ClosedShift[]> {
  return storage.read(async (tx) => {
    const rows = await tx.listProjections(SHIFT_PREFIX);
    const out: ClosedShift[] = [];
    for (const row of rows) {
      const s = row.value as unknown as Partial<ClosedShift>;
      if (s.state !== "closed" || !s.close_operation_id) continue;
      const op = await tx.getOperation(s.close_operation_id);
      if (op && op.state === "synced") continue;
      out.push(s as ClosedShift);
    }
    out.sort((a, b) => b.closed_at.localeCompare(a.closed_at));
    return out;
  });
}
