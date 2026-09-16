/**
 * محوّل Dexie/IndexedDB لعقد التخزين (§٨.١٣) — تنفيذ الويب.
 *
 * - الذرّية: معاملة Dexie `rw` واحدة على كل الجداول؛ رمي استثناء داخلها يتراجع عن الكل.
 * - الأرقام الكبيرة سلاسل قانونية أصلاً في العقد؛ لا يمر شيء عبر Number (§٦.١، ACC-97).
 *   `createdLocalSeq` رقم محلي صغير (عداد جهاز) ويبقى number للفهرسة.
 * - التنسيق بين التبويبات (كاتب واحد §٨.٢) عبر Web Locks في T0.12 مع sync-core —
 *   معاملات IndexedDB نفسها ذرّية عبر التبويبات، والقفل يخص تخصيص الهوية/الترقيم.
 */

import Dexie, { type Table } from "dexie";

import type {
  CursorRow,
  LocalOpState,
  MetaRow,
  ProjectionRow,
  SnapshotRow,
  StoragePort,
  StorageTransaction,
  StoredOperation,
} from "../storage";

interface OpRow extends StoredOperation {
  /** مفتاح الجدول */
  readonly operationId: string;
}

interface CursorTableRow extends CursorRow {
  readonly key: string;
}

const cursorKey = (scope: string, scopeId: string, group: string) => `${scope}|${scopeId}|${group}`;
const LOCAL_SEQ_KEY = "local_seq";

class StingDatabase extends Dexie {
  operations!: Table<OpRow, string>;
  cursors!: Table<CursorTableRow, string>;
  snapshots!: Table<SnapshotRow, string>;
  projections!: Table<ProjectionRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    // الهجرات المحلية إضافية فقط (§١٣.٢): نسخة جديدة تضيف جداول/فهارس ولا تعيد تسمية أو حذف
    this.version(1).stores({
      operations: "operationId, state, createdLocalSeq",
      cursors: "key",
      snapshots: "snapshotId, state",
      projections: "key",
      meta: "key",
    });
  }
}

class DexieTx implements StorageTransaction {
  constructor(private readonly db: StingDatabase) {}

  async getOperation(operationId: string): Promise<StoredOperation | null> {
    return (await this.db.operations.get(operationId)) ?? null;
  }

  async putOperation(op: StoredOperation): Promise<void> {
    await this.db.operations.put({ ...op });
  }

  async listOperationsByState(state: LocalOpState): Promise<StoredOperation[]> {
    const rows = await this.db.operations.where("state").equals(state).toArray();
    return rows.sort((a, b) => a.createdLocalSeq - b.createdLocalSeq);
  }

  async nextLocalSeq(): Promise<number> {
    const current = await this.db.meta.get(LOCAL_SEQ_KEY);
    const next = (current ? Number(current.value) : 0) + 1;
    await this.db.meta.put({ key: LOCAL_SEQ_KEY, value: String(next) });
    return next;
  }

  async currentLocalSeq(): Promise<number> {
    const current = await this.db.meta.get(LOCAL_SEQ_KEY);
    return current ? Number(current.value) : 0;
  }

  async getCursor(scope: string, scopeId: string, entityGroup: string): Promise<CursorRow | null> {
    const row = await this.db.cursors.get(cursorKey(scope, scopeId, entityGroup));
    if (!row) return null;
    return {
      scope: row.scope,
      scopeId: row.scopeId,
      entityGroup: row.entityGroup,
      serverSeq: row.serverSeq,
    };
  }

  async advanceCursor(row: CursorRow): Promise<void> {
    const key = cursorKey(row.scope, row.scopeId, row.entityGroup);
    const current = await this.db.cursors.get(key);
    // لا تراجع داخل الجيل (§٨.٧) — المقارنة بـ BigInt على السلاسل القانونية
    if (current === undefined || BigInt(row.serverSeq) > BigInt(current.serverSeq)) {
      await this.db.cursors.put({ key, ...row });
    }
  }

  async getSnapshot(snapshotId: string): Promise<SnapshotRow | null> {
    return (await this.db.snapshots.get(snapshotId)) ?? null;
  }

  async putSnapshot(row: SnapshotRow): Promise<void> {
    await this.db.snapshots.put({ ...row });
  }

  async listSnapshots(): Promise<SnapshotRow[]> {
    return this.db.snapshots.toArray();
  }

  async getProjection(key: string): Promise<ProjectionRow | null> {
    return (await this.db.projections.get(key)) ?? null;
  }

  async putProjection(row: ProjectionRow): Promise<void> {
    await this.db.projections.put({ ...row });
  }

  async getMeta(key: string): Promise<string | null> {
    return (await this.db.meta.get(key))?.value ?? null;
  }

  async putMeta(key: string, value: string): Promise<void> {
    await this.db.meta.put({ key, value });
  }
}

export interface DexieStorageOptions {
  /** اسم قاعدة البيانات — لكل نسخة تشغيل مسجلة هوية وتخزين مستقلان (§٨.١٣). */
  databaseName: string;
  /** حقن indexedDB بديل (fake-indexeddb في اختبارات Node). */
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export class DexieStorage implements StoragePort {
  private readonly db: StingDatabase;

  constructor(options: DexieStorageOptions) {
    if (options.indexedDB) {
      Dexie.dependencies.indexedDB = options.indexedDB;
      if (options.IDBKeyRange) Dexie.dependencies.IDBKeyRange = options.IDBKeyRange;
    }
    this.db = new StingDatabase(options.databaseName);
  }

  transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    const tables = [
      this.db.operations,
      this.db.cursors,
      this.db.snapshots,
      this.db.projections,
      this.db.meta,
    ];
    return this.db.transaction("rw", tables, () => work(new DexieTx(this.db)));
  }

  read<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    const tables = [
      this.db.operations,
      this.db.cursors,
      this.db.snapshots,
      this.db.projections,
      this.db.meta,
    ];
    return this.db.transaction("r", tables, () => work(new DexieTx(this.db)));
  }

  /** لاختبارات الترقية والفحص. */
  async close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }

  async deleteDatabase(): Promise<void> {
    await this.db.delete();
  }
}

export * from "./coordination";
