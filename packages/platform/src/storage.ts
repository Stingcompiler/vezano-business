/**
 * عقد التخزين المحلي (§٤.٦ بند ٤، §٨.٢): معاملة ذرّية واحدة تشمل العمليات والأعضاء والمعلّق
 * والإسقاطات واللقطة والمؤشرات — لا واجهة CRUD عامة تفصل كتابات يجب أن تلتزم معاً.
 * المعاملة المحلية لا تنتظر HTTP ولا طابعة.
 *
 * كل المبالغ والأرقام الكبيرة سلاسل قانونية (§٦.١) — لا bigint في حدود التخزين لأن IndexedDB
 * لا يفهرسها؛ التحويل إلى bigint في `@sting/domain` وحدها.
 */

export type LocalOpState = "local" | "pending" | "synced" | "conflict" | "quarantined";

export interface StoredMember {
  readonly entity: string;
  readonly id: string;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
  /** رقم الخادم بعد التأكيد؛ null قبله. سلسلة قانونية. */
  readonly serverSeq: string | null;
}

export interface StoredOperation {
  readonly operationId: string;
  readonly kind: string;
  readonly opVersion: number;
  readonly dependencies: readonly string[];
  readonly members: readonly StoredMember[];
  readonly state: LocalOpState;
  /** رقم إنشاء محلي متزايد داخل المعاملة (§٨.٢) — ليس بديلاً عن رقم الخادم. */
  readonly createdLocalSeq: number;
  /** علاقة العملية باللقطة النشطة وقت إنشائها (§٨.٩ بند ٢–٣). */
  readonly snapshotRelation: "before_candidate" | "after_candidate" | "none";
}

export interface CursorRow {
  readonly scope: string;
  readonly scopeId: string;
  readonly entityGroup: string;
  readonly serverSeq: string;
}

export interface SnapshotRow {
  readonly snapshotId: string;
  readonly syncEpoch: string;
  readonly cutoffServerSeq: string;
  readonly state: "candidate" | "active" | "discarded";
  readonly balances: readonly Record<string, string>[];
  /** آخر رقم إنشاء محلي وقت استقبال المرشح (§٨.٩ بند ٢). */
  readonly localFrontier: number;
}

export interface ProjectionRow {
  readonly key: string;
  readonly value: Record<string, unknown>;
}

export interface MetaRow {
  readonly key: string;
  readonly value: string;
}

/** واجهة القراءة والكتابة داخل معاملة واحدة. */
export interface StorageTransaction {
  getOperation(operationId: string): Promise<StoredOperation | null>;
  putOperation(op: StoredOperation): Promise<void>;
  listOperationsByState(state: LocalOpState): Promise<StoredOperation[]>;
  /** التخصيص داخل المعاملة — إعادة الضغط لا تنشئ هوية جديدة لنفس الحفظ (§٨.٢). */
  nextLocalSeq(): Promise<number>;
  /** آخر رقم إنشاء محلي مخصَّص — يُسجَّل حدَّ استقبال مرشح اللقطة `local_frontier` (§٨.٩ بند ٢). */
  currentLocalSeq(): Promise<number>;
  getCursor(scope: string, scopeId: string, entityGroup: string): Promise<CursorRow | null>;
  /** يدمج تقدماً بلا تراجع داخل الجيل (§٨.٧). */
  advanceCursor(row: CursorRow): Promise<void>;
  getSnapshot(snapshotId: string): Promise<SnapshotRow | null>;
  putSnapshot(row: SnapshotRow): Promise<void>;
  listSnapshots(): Promise<SnapshotRow[]>;
  getProjection(key: string): Promise<ProjectionRow | null>;
  putProjection(row: ProjectionRow): Promise<void>;
  getMeta(key: string): Promise<string | null>;
  putMeta(key: string, value: string): Promise<void>;
}

export interface StoragePort {
  /**
   * ينفّذ `work` داخل معاملة ذرّية واحدة: إمّا يلتزم كل ما كتبته أو لا شيء.
   * رمي استثناء داخل `work` يتراجع عن الكل. لا انتظار شبكة/طابعة داخلها.
   */
  transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  /** للفحص والتشخيص خارج المعاملات (قراءة فقط). */
  read<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T>;
}
