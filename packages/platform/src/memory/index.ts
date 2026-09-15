/**
 * محوّل ذاكري لعقد التخزين — مرجع الدلالة للاختبار (§٤.٦ بند ٦: نجاحه لا يغني عن التخزين الحقيقي).
 * يطبّق الذرّية بنسخ الحالة والالتزام عند النجاح فقط، ويسلسل المعاملات (كاتب واحد §٨.٢).
 */

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

interface State {
  ops: Map<string, StoredOperation>;
  cursors: Map<string, CursorRow>;
  snapshots: Map<string, SnapshotRow>;
  projections: Map<string, ProjectionRow>;
  meta: Map<string, MetaRow>;
  localSeq: number;
}

const emptyState = (): State => ({
  ops: new Map(),
  cursors: new Map(),
  snapshots: new Map(),
  projections: new Map(),
  meta: new Map(),
  localSeq: 0,
});

const cloneState = (s: State): State => ({
  ops: new Map(s.ops),
  cursors: new Map(s.cursors),
  snapshots: new Map(s.snapshots),
  projections: new Map(s.projections),
  meta: new Map(s.meta),
  localSeq: s.localSeq,
});

const cursorKey = (scope: string, scopeId: string, group: string) => `${scope}|${scopeId}|${group}`;

class MemoryTx implements StorageTransaction {
  constructor(private readonly draft: State) {}

  getOperation(id: string): Promise<StoredOperation | null> {
    return Promise.resolve(this.draft.ops.get(id) ?? null);
  }

  putOperation(op: StoredOperation): Promise<void> {
    this.draft.ops.set(op.operationId, op);
    return Promise.resolve();
  }

  listOperationsByState(state: LocalOpState): Promise<StoredOperation[]> {
    const out = [...this.draft.ops.values()]
      .filter((o) => o.state === state)
      .sort((a, b) => a.createdLocalSeq - b.createdLocalSeq);
    return Promise.resolve(out);
  }

  nextLocalSeq(): Promise<number> {
    this.draft.localSeq += 1;
    return Promise.resolve(this.draft.localSeq);
  }

  getCursor(scope: string, scopeId: string, group: string): Promise<CursorRow | null> {
    return Promise.resolve(this.draft.cursors.get(cursorKey(scope, scopeId, group)) ?? null);
  }

  advanceCursor(row: CursorRow): Promise<void> {
    const key = cursorKey(row.scope, row.scopeId, row.entityGroup);
    const current = this.draft.cursors.get(key);
    // لا تراجع داخل الجيل (§٨.٧)
    if (current === undefined || BigInt(row.serverSeq) > BigInt(current.serverSeq)) {
      this.draft.cursors.set(key, row);
    }
    return Promise.resolve();
  }

  getSnapshot(id: string): Promise<SnapshotRow | null> {
    return Promise.resolve(this.draft.snapshots.get(id) ?? null);
  }

  putSnapshot(row: SnapshotRow): Promise<void> {
    this.draft.snapshots.set(row.snapshotId, row);
    return Promise.resolve();
  }

  listSnapshots(): Promise<SnapshotRow[]> {
    return Promise.resolve([...this.draft.snapshots.values()]);
  }

  getProjection(key: string): Promise<ProjectionRow | null> {
    return Promise.resolve(this.draft.projections.get(key) ?? null);
  }

  putProjection(row: ProjectionRow): Promise<void> {
    this.draft.projections.set(row.key, row);
    return Promise.resolve();
  }

  getMeta(key: string): Promise<string | null> {
    return Promise.resolve(this.draft.meta.get(key)?.value ?? null);
  }

  putMeta(key: string, value: string): Promise<void> {
    this.draft.meta.set(key, { key, value });
    return Promise.resolve();
  }
}

export class MemoryStorage implements StoragePort {
  private state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const draft = cloneState(this.state);
      const result = await work(new MemoryTx(draft));
      this.state = draft; // الالتزام عند النجاح فقط
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  read<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    return work(new MemoryTx(cloneState(this.state)));
  }
}
