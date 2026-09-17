/**
 * جلسة الجرد محلياً (INV-05؛ §٣.٣، القاعدة 9): العدّ يُحفظ بعد كل صنف لا في النهاية ويُستأنف بعد
 * الانقطاع؛ المتوقَّع (رصيد النظام) محجوب حتى يُدخل المعدود؛ الإغلاق يوثّق ما عُدّ بعملية
 * `count_session` (لا حركات مخزون) — التسوية قرار تالٍ مخوَّل في INV-06.
 *
 * تنبيه Dexie: كل `await` داخل المُسقِط على المعاملة مباشرةً.
 */
import type { StoragePort, StoredOperation } from "@sting/platform";

import { saveOperation } from "./local-save";
import type { OperationDraft } from "./types";

export const COUNT_SESSION_META = "inventory.count_session";
export const COUNT_SESSION_PREFIX = "entity:inventory.CountSession:";
export const COUNT_SEQ_META = "count_seq";

export interface CountEntry {
  readonly countedMilli: string;
  /** لقطة رصيد الجهاز وقت العدّ — فارغة إن لم يكن معروفاً */
  readonly systemMilli: string;
  readonly countedAt: string;
}

/** جلسة مفتوحة على هذا الجهاز — تُحفظ بعد كل صنف. */
export interface OpenCountSession {
  readonly sessionId: string;
  readonly operationId: string;
  readonly branchId: string;
  readonly startedAt: string;
  readonly userName: string;
  readonly counts: Readonly<Record<string, CountEntry>>;
}

export async function readOpenCountSession(storage: StoragePort): Promise<OpenCountSession | null> {
  const raw = await storage.read((tx) => tx.getMeta(COUNT_SESSION_META));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OpenCountSession;
  } catch {
    return null;
  }
}

export async function startCountSession(
  storage: StoragePort,
  input: { branchId: string; userName: string; startedAt: string },
): Promise<OpenCountSession> {
  const existing = await readOpenCountSession(storage);
  if (existing && existing.branchId === input.branchId) return existing;
  const session: OpenCountSession = {
    sessionId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    branchId: input.branchId,
    startedAt: input.startedAt,
    userName: input.userName,
    counts: {},
  };
  await storage.transaction((tx) => tx.putMeta(COUNT_SESSION_META, JSON.stringify(session)));
  return session;
}

/** يحفظ عدّ صنف واحد فوراً — «يُحفظ بعد كل صنف لا في النهاية». */
export async function saveCountEntry(
  storage: StoragePort,
  itemId: string,
  entry: CountEntry,
): Promise<OpenCountSession | null> {
  const session = await readOpenCountSession(storage);
  if (!session) return null;
  const next: OpenCountSession = { ...session, counts: { ...session.counts, [itemId]: entry } };
  await storage.transaction((tx) => tx.putMeta(COUNT_SESSION_META, JSON.stringify(next)));
  return next;
}

export async function clearCountEntry(
  storage: StoragePort,
  itemId: string,
): Promise<OpenCountSession | null> {
  const session = await readOpenCountSession(storage);
  if (!session) return null;
  const counts = { ...session.counts };
  delete counts[itemId];
  const next: OpenCountSession = { ...session, counts };
  await storage.transaction((tx) => tx.putMeta(COUNT_SESSION_META, JSON.stringify(next)));
  return next;
}

export interface CloseCountInput {
  readonly branchCode: string;
  readonly devicePrefix: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly totalItems: number;
  readonly itemNames: Readonly<Record<string, { readonly name: string; readonly unit: string }>>;
  readonly closedAt: string;
}

export interface LocalCountSession {
  readonly id: string;
  readonly session_number: string;
  readonly branch_id: string;
  readonly user_name: string;
  readonly total_items: number;
  readonly started_at: string;
  readonly closed_at: string;
  readonly lines: readonly {
    readonly item_id: string;
    readonly item_name: string;
    readonly unit_name: string;
    readonly counted_qty_milli: string;
    readonly system_qty_milli: string;
    readonly counted_at: string;
  }[];
  readonly operation_id: string;
}

const CODE = /^[A-Z0-9]{1,6}$/;

export function formatCountNumber(
  parts: { branchCode: string; devicePrefix: string; yearTwoDigits: string },
  seq: number,
): string {
  if (
    !CODE.test(parts.branchCode) ||
    !CODE.test(parts.devicePrefix) ||
    !/^[0-9]{2}$/.test(parts.yearTwoDigits)
  ) {
    throw new Error("invalid count number parts");
  }
  return `CNT-${parts.branchCode}-${parts.devicePrefix}-${parts.yearTwoDigits}-${String(seq).padStart(6, "0")}`;
}

export function countSessionDraft(
  session: OpenCountSession,
  input: CloseCountInput,
  number: string,
): OperationDraft {
  const entries = Object.entries(session.counts);
  if (entries.length === 0) throw new Error("no_counts");
  return {
    operationId: session.operationId,
    kind: "count_session",
    opVersion: 1,
    dependencies: [],
    members: [
      {
        entity: "inventory.CountSession",
        id: session.sessionId,
        schemaVersion: 1,
        payload: {
          session_id: session.sessionId,
          session_number: number,
          branch_id: session.branchId,
          device_id: input.deviceId,
          user_id: input.userId,
          total_items: String(input.totalItems),
          started_at: session.startedAt,
          closed_at: input.closedAt,
        },
      },
      ...entries.map(([itemId, e]) => ({
        entity: "inventory.CountLine",
        id: `${session.sessionId}:${itemId}`,
        schemaVersion: 1,
        payload: {
          line_id: `${session.sessionId}:${itemId}`,
          session_id: session.sessionId,
          item_id: itemId,
          item_name: input.itemNames[itemId]?.name ?? "",
          unit_name: input.itemNames[itemId]?.unit ?? "",
          counted_qty_milli: e.countedMilli,
          system_qty_milli: e.systemMilli,
          counted_at: e.countedAt,
        },
      })),
    ],
  };
}

/** إغلاق الجلسة: العملية + رقمها + إسقاطها، ثم تُمحى الجلسة المفتوحة — بلا حركة مخزون. */
export async function closeCountSession(
  storage: StoragePort,
  input: CloseCountInput,
): Promise<{ session: LocalCountSession; alreadySaved: boolean } | null> {
  const open = await readOpenCountSession(storage);
  if (!open) return null;
  const parts = {
    branchCode: input.branchCode,
    devicePrefix: input.devicePrefix,
    yearTwoDigits: input.closedAt.slice(2, 4),
  };
  const provisional = countSessionDraft(open, input, formatCountNumber(parts, 0));
  const out = await saveOperation(storage, provisional, async (tx, op) => {
    const seq = Number((await tx.getMeta(COUNT_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(COUNT_SEQ_META, String(seq));
    const number = formatCountNumber(parts, seq);
    const fixed: StoredOperation = {
      ...op,
      members: op.members.map((m) =>
        m.entity === "inventory.CountSession"
          ? { ...m, payload: { ...m.payload, session_number: number } }
          : m,
      ),
    };
    await tx.putOperation(fixed);
    const local: LocalCountSession = {
      id: open.sessionId,
      session_number: number,
      branch_id: open.branchId,
      user_name: open.userName,
      total_items: input.totalItems,
      started_at: open.startedAt,
      closed_at: input.closedAt,
      lines: Object.entries(open.counts).map(([itemId, e]) => ({
        item_id: itemId,
        item_name: input.itemNames[itemId]?.name ?? "",
        unit_name: input.itemNames[itemId]?.unit ?? "",
        counted_qty_milli: e.countedMilli,
        system_qty_milli: e.systemMilli,
        counted_at: e.countedAt,
      })),
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: COUNT_SESSION_PREFIX + local.id, value: { ...local } });
    await tx.putMeta(COUNT_SESSION_META, "");
  });
  const row = await storage.read((tx) => tx.getProjection(COUNT_SESSION_PREFIX + open.sessionId));
  return { session: row!.value as unknown as LocalCountSession, alreadySaved: out.alreadySaved };
}

export async function readLocalCountSession(
  storage: StoragePort,
  id: string,
): Promise<LocalCountSession | null> {
  const row = await storage.read((tx) => tx.getProjection(COUNT_SESSION_PREFIX + id));
  return row ? (row.value as unknown as LocalCountSession) : null;
}
