/**
 * النسخة المحلية المشفّرة واستعادتها (SYS-05/SYS-06؛ §١٣.٣؛ ACC-73، 74، 81، 85، 99؛ قرار المالك على
 * 0002 س٤: كلمة حماية + AES-GCM افتراضاً).
 *
 * - الغلاف بنصّ واضح: الصيغة والإصدار والمنشأة والجهاز والوقت والعدّ — كي يُرفض ملف منشأة أخرى أو
 *   إصدار أحدث **قبل** فكّ التشفير وقبل أي كتابة، ولا يُعرض اسم المنشأة الأخرى.
 * - المحتوى: العمليات (بكل حالاتها — المعلّق مشمول وموسوم) والإسقاطات وعدّادات الترقيم فقط.
 *   لا رموز جلسات ولا تسجيل الجهاز ولا متحققات PIN (ACC-85، 99).
 * - المفتاح مشتقّ من كلمة الحماية بـPBKDF2-SHA256 ثم AES-GCM 256؛ وسم GCM هو تحقق السلامة؛ ولا
 *   استرداد للكلمة من النظام.
 * - الاستعادة دمجٌ بالهويات لا إحلال: العملية الموجودة محلياً لا تُستبدل، والإسقاط يُحدَّث إن كان
 *   الوارد أحدث؛ على دفعات قابلة للاستئناف؛ الفواتير التي تشير إلى صنف غير موجود تُحجز للمالك.
 *   الاستعادة مرتين = لا تكرار (المعرّفات نفسها).
 */
import type { ProjectionRow, StoragePort, StoredOperation } from "@sting/platform";

export const BACKUP_FORMAT = "sting-backup";
/** إصدار مخطط النسخة — ملف بإصدار أحدث يُرفض بـ`newer_version` («حدّث التطبيق ثم أعد المحاولة») */
export const BACKUP_VERSION = 2;
export const PBKDF2_ITERATIONS = 250_000;
export const RESTORE_BATCH = 50;
export const RESTORE_PROGRESS_META = "restore.progress";
export const RESTORE_HELD_META = "restore.held";

export interface BackupEnvelope {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: number;
  readonly tenant_id: string;
  readonly device_id: string;
  readonly exported_at: string;
  readonly sync_epoch: string;
  readonly counts: BackupCounts;
  readonly kdf: {
    readonly name: "PBKDF2-SHA256";
    readonly iterations: number;
    readonly salt: string;
  };
  readonly iv: string;
  readonly ciphertext: string;
}

export interface BackupCounts {
  readonly operations: number;
  readonly pending: number;
  readonly parties: number;
  readonly items: number;
  readonly projections: number;
}

export interface BackupContent {
  readonly operations: readonly StoredOperation[];
  readonly projections: readonly ProjectionRow[];
  /** عدّادات الترقيم `*_seq` فقط */
  readonly counters: Readonly<Record<string, string>>;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  encode: (bytes: Uint8Array): string => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  },
  decode: (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export const COUNTER_KEYS = [
  "invoice_seq",
  "return_seq",
  "receipt_seq",
  "cash_movement_seq",
  "goods_receipt_seq",
  "count_seq",
  "transfer_seq",
  "transfer_receipt_seq",
] as const;

/** يجمع محتوى النسخة من التخزين — بلا أسرار. */
export async function collectBackup(storage: StoragePort): Promise<BackupContent> {
  return storage.read(async (tx) => {
    const operations: StoredOperation[] = [];
    for (const st of ["local", "pending", "synced", "conflict", "quarantined"] as const)
      operations.push(...(await tx.listOperationsByState(st)));
    operations.sort((a, b) => a.createdLocalSeq - b.createdLocalSeq);
    const projections = await tx.listProjections("entity:");
    const counters: Record<string, string> = {};
    for (const k of COUNTER_KEYS) {
      const v = await tx.getMeta(k);
      if (v) counters[k] = v;
    }
    return { operations, projections, counters };
  });
}

export function backupCounts(content: BackupContent): BackupCounts {
  return {
    operations: content.operations.length,
    pending: content.operations.filter((o) => o.state === "local" || o.state === "pending").length,
    parties: content.projections.filter((p) => p.key.startsWith("entity:parties.Party:")).length,
    items: content.projections.filter((p) => p.key.startsWith("entity:catalog.Item:")).length,
    projections: content.projections.length,
  };
}

/** حجم النص قبل التشفير بالبايت — «نحسب قبل البدء لا في منتصفه». */
export function backupSizeBytes(content: BackupContent): number {
  return enc.encode(JSON.stringify(content)).length;
}

export interface SealInput {
  readonly content: BackupContent;
  readonly password: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly syncEpoch: string;
  readonly exportedAt: string;
  readonly iterations?: number;
}

export async function sealBackup(input: SealInput): Promise<BackupEnvelope> {
  if (input.password.length < 6) throw new Error("password_short");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = input.iterations ?? PBKDF2_ITERATIONS;
  const key = await deriveKey(input.password, salt, iterations);
  const plain = enc.encode(JSON.stringify(input.content));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plain),
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    tenant_id: input.tenantId,
    device_id: input.deviceId,
    exported_at: input.exportedAt,
    sync_epoch: input.syncEpoch,
    counts: backupCounts(input.content),
    kdf: { name: "PBKDF2-SHA256", iterations, salt: b64.encode(salt) },
    iv: b64.encode(iv),
    ciphertext: b64.encode(cipher),
  };
}

export type InspectOutcome =
  | { readonly ok: true; readonly envelope: BackupEnvelope }
  | { readonly ok: false; readonly reason: "corrupt" | "other_tenant" | "newer_version" };

/** يفحص الغلاف قبل فكّ التشفير: تالف، أو لمنشأة أخرى (بلا كشف اسمها)، أو من إصدار أحدث. */
export function inspectBackup(raw: string, tenantId: string): InspectOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "corrupt" };
  const e = parsed as Partial<BackupEnvelope>;
  if (
    e.format !== BACKUP_FORMAT ||
    typeof e.version !== "number" ||
    typeof e.tenant_id !== "string" ||
    typeof e.ciphertext !== "string" ||
    typeof e.iv !== "string" ||
    !e.kdf ||
    typeof e.kdf.salt !== "string"
  )
    return { ok: false, reason: "corrupt" };
  if (e.version > BACKUP_VERSION) return { ok: false, reason: "newer_version" };
  if (e.tenant_id !== tenantId) return { ok: false, reason: "other_tenant" };
  return { ok: true, envelope: e as BackupEnvelope };
}

export type OpenOutcome =
  | { readonly ok: true; readonly content: BackupContent }
  | { readonly ok: false; readonly reason: "wrong_password" | "corrupt" };

export async function openBackup(envelope: BackupEnvelope, password: string): Promise<OpenOutcome> {
  try {
    const key = await deriveKey(password, b64.decode(envelope.kdf.salt), envelope.kdf.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64.decode(envelope.iv) as BufferSource },
      key,
      b64.decode(envelope.ciphertext) as BufferSource,
    );
    const content = JSON.parse(dec.decode(plain)) as BackupContent;
    if (!Array.isArray(content.operations) || !Array.isArray(content.projections))
      return { ok: false, reason: "corrupt" };
    return { ok: true, content };
  } catch {
    // GCM يفشل بالوسم لكلمة خاطئة وللملف الممسوس على السواء — نعرضهما ككلمة خاطئة أولاً
    return { ok: false, reason: "wrong_password" };
  }
}

export interface RestorePreview {
  /** «ستُضاف N فاتورة» — عمليات ليست على الجهاز */
  readonly addOperations: number;
  /** منها معلّق غير مرفوع داخل النسخة */
  readonly addPending: number;
  /** «ستُحدَّث N أرصدة» — إسقاطات أحدث في النسخة */
  readonly updateProjections: number;
  readonly addProjections: number;
  /** عمليات مبيعات تشير إلى صنف غير موجود محلياً ولا في النسخة — تُحجز */
  readonly heldOperations: number;
  /** لا يُحذف شيء أبداً */
  readonly deletes: 0;
  /** معلّق على هذا الجهاز لم يُرفع — الاستعادة لا تمسّه لكنها تُعلن */
  readonly localPending: readonly StoredOperation[];
}

const projSeq = (row: ProjectionRow | null | undefined): bigint => {
  const v = row?.value["server_seq"];
  return typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : -1n;
};

function referencedItems(op: StoredOperation): string[] {
  return op.members
    .filter((m) => m.entity === "inventory.StockMovement" || m.entity === "sales.SaleLine")
    .map((m) => m.payload["item_id"])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** «الفرق لا المحتوى»: ما سيتغيّر مقارنةً بالحالي، دون كتابة حرف. */
export async function previewRestore(
  storage: StoragePort,
  content: BackupContent,
): Promise<RestorePreview> {
  return storage.read(async (tx) => {
    let addOperations = 0;
    let addPending = 0;
    let held = 0;
    const itemsInBackup = new Set(
      content.projections
        .filter((p) => p.key.startsWith("entity:catalog.Item:"))
        .map((p) => p.key.slice("entity:catalog.Item:".length)),
    );
    for (const op of content.operations) {
      if (await tx.getOperation(op.operationId)) continue;
      addOperations += 1;
      if (op.state === "local" || op.state === "pending") addPending += 1;
      for (const item of referencedItems(op)) {
        if (itemsInBackup.has(item)) continue;
        if (await tx.getProjection(`entity:catalog.Item:${item}`)) continue;
        held += 1;
        break;
      }
    }
    let updateProjections = 0;
    let addProjections = 0;
    for (const p of content.projections) {
      const cur = await tx.getProjection(p.key);
      if (!cur) addProjections += 1;
      else if (projSeq(p) > projSeq(cur)) updateProjections += 1;
    }
    const localPending = [
      ...(await tx.listOperationsByState("local")),
      ...(await tx.listOperationsByState("pending")),
    ];
    return {
      addOperations,
      addPending,
      updateProjections,
      addProjections,
      heldOperations: held,
      deletes: 0,
      localPending,
    };
  });
}

export interface RestoreProgress {
  readonly fileId: string;
  readonly nextBatch: number;
  readonly totalBatches: number;
  readonly added: number;
  readonly updated: number;
  readonly held: readonly string[];
}

export interface RestoreOutcome {
  readonly done: boolean;
  readonly progress: RestoreProgress;
}

/** معرّف الملف لاستئناف الدفعات: الوقت والمنشأة والعدّ كافية للتمييز. */
export const backupFileId = (e: BackupEnvelope): string =>
  `${e.tenant_id}:${e.exported_at}:${e.counts.operations}`;

export async function readRestoreProgress(storage: StoragePort): Promise<RestoreProgress | null> {
  const raw = await storage.read((tx) => tx.getMeta(RESTORE_PROGRESS_META));
  return raw ? (JSON.parse(raw) as RestoreProgress) : null;
}

/**
 * يطبّق الاستعادة على دفعات قابلة للاستئناف: كل دفعة معاملة واحدة تُسجّل تقدّمها في النهاية — ما
 * اكتمل يبقى وما انقطع يُلغى كاملاً. `stopAfter` للاختبار: يقف بعد عدد دفعات (محاكاة الانقطاع).
 */
export async function applyRestore(
  storage: StoragePort,
  fileId: string,
  content: BackupContent,
  opts: { stopAfter?: number } = {},
): Promise<RestoreOutcome> {
  const totalBatches = Math.max(1, Math.ceil(content.operations.length / RESTORE_BATCH));
  const prior = await readRestoreProgress(storage);
  let progress: RestoreProgress =
    prior && prior.fileId === fileId
      ? prior
      : { fileId, nextBatch: 0, totalBatches, added: 0, updated: 0, held: [] };
  let batches = 0;
  const itemsInBackup = new Set(
    content.projections
      .filter((p) => p.key.startsWith("entity:catalog.Item:"))
      .map((p) => p.key.slice("entity:catalog.Item:".length)),
  );
  while (progress.nextBatch < totalBatches) {
    if (opts.stopAfter !== undefined && batches >= opts.stopAfter) return { done: false, progress };
    const start = progress.nextBatch * RESTORE_BATCH;
    const slice = content.operations.slice(start, start + RESTORE_BATCH);
    const isFirst = progress.nextBatch === 0;
    const next = await storage.transaction(async (tx) => {
      let added = progress.added;
      let updated = progress.updated;
      const held = [...progress.held];
      if (isFirst) {
        // الإسقاطات والعدّادات في الدفعة الأولى — الأحدث يفوز، ولا حذف
        for (const p of content.projections) {
          const cur = await tx.getProjection(p.key);
          if (!cur) {
            await tx.putProjection(p);
          } else if (projSeq(p) > projSeq(cur)) {
            await tx.putProjection(p);
            updated += 1;
          }
        }
        for (const [k, v] of Object.entries(content.counters)) {
          const cur = Number((await tx.getMeta(k)) ?? "0");
          if (Number(v) > cur) await tx.putMeta(k, v);
        }
      }
      for (const op of slice) {
        if (await tx.getOperation(op.operationId)) continue; // دمج بالهويات — لا استبدال
        let missing = false;
        for (const item of referencedItems(op)) {
          if (itemsInBackup.has(item)) continue;
          if (await tx.getProjection(`entity:catalog.Item:${item}`)) continue;
          missing = true;
        }
        await tx.putOperation({ ...op });
        added += 1;
        if (missing) held.push(op.operationId);
      }
      const p: RestoreProgress = {
        fileId,
        nextBatch: progress.nextBatch + 1,
        totalBatches,
        added,
        updated,
        held,
      };
      await tx.putMeta(RESTORE_PROGRESS_META, JSON.stringify(p));
      await tx.putMeta(RESTORE_HELD_META, JSON.stringify(held));
      return p;
    });
    progress = next;
    batches += 1;
  }
  await storage.transaction((tx) => tx.putMeta(RESTORE_PROGRESS_META, ""));
  return { done: true, progress };
}
