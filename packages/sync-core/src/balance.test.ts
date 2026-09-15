import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryStorage } from "@sting/platform/memory";
import type { StoredOperation } from "@sting/platform";
import { describe, expect, it } from "vitest";

import {
  accountKey,
  computeBalance,
  snapshotFromRow,
  type AccountEffect,
  type EffectExtractor,
} from "./balance";
import { adoptEpoch, isStaleEpoch } from "./epoch";
import { saveOperation } from "./local-save";
import { pruneVerdict } from "./pruning";
import { applyPullPage, type PullPage } from "./pull-apply";
import { applyResults } from "./pusher";
import {
  ACTIVE_SNAPSHOT_KEY,
  activateCandidate,
  frozenAccounts,
  recordCandidate,
} from "./snapshots";

interface VOp {
  id: string;
  state: StoredOperation["state"];
  serverSeq?: string;
  createdLocalSeq: number;
  relation: StoredOperation["snapshotRelation"];
  effects: { entry: string; direction: "debit" | "credit"; amount: string }[];
}
interface VCase {
  id: string;
  snapshot: { cutoff: string; frontier: number; balance: string } | null;
  ops: VOp[];
  expect: { server: string; local: string; total: string; trusted: boolean };
  note: string;
}
const vectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../domain/vectors/balance.json"), "utf8"),
) as {
  $key: string;
  cases: VCase[];
};
const KEY = vectors.$key;

const effectsOf = new Map<string, AccountEffect[]>();
const extract: EffectExtractor = (op) => effectsOf.get(op.operationId) ?? [];

const toStored = (v: VOp): StoredOperation => {
  effectsOf.set(
    v.id,
    v.effects.map((e) => ({
      accountKey: KEY,
      entryId: e.entry,
      direction: e.direction,
      amountMinor: e.amount,
    })),
  );
  return {
    operationId: v.id,
    kind: "probe",
    opVersion: 1,
    dependencies: [],
    members: [
      {
        entity: "probe.Head",
        id: `${v.id}-h`,
        schemaVersion: 1,
        payload: {},
        serverSeq: v.serverSeq ?? null,
      },
    ],
    state: v.state,
    createdLocalSeq: v.createdLocalSeq,
    snapshotRelation: v.relation,
  };
};

describe("معادلة الرصيد ①②③ — vectors/balance.json (§٨.٨)", () => {
  it.each(vectors.cases)("$id", (c) => {
    const snapshot = c.snapshot
      ? snapshotFromRow({
          snapshotId: "s",
          syncEpoch: "e",
          cutoffServerSeq: c.snapshot.cutoff,
          state: "active",
          balances: [
            {
              party_id: "c1",
              account_role: "customer",
              currency: "SDG",
              amount_minor: c.snapshot.balance,
            },
          ],
          localFrontier: c.snapshot.frontier,
        })
      : null;
    const b = computeBalance(KEY, snapshot, c.ops.map(toStored), extract);
    expect({
      server: b.serverMinor.toString(),
      local: b.localPendingMinor.toString(),
      total: b.totalMinor.toString(),
      trusted: b.trusted,
    }).toEqual(c.expect);
  });

  it("الرصيد المركّب: خادمي X + معلّق هذا الجهاز Y = Z (القاعدة 5 من الأمر)", () => {
    const b = computeBalance(
      KEY,
      null,
      [
        toStored({
          id: "x",
          state: "local",
          createdLocalSeq: 1,
          relation: "none",
          effects: [{ entry: "e", direction: "debit", amount: "6000" }],
        }),
      ],
      extract,
    );
    expect(
      `خادمي ${b.serverMinor} + معلّق هذا الجهاز ${b.localPendingMinor} = ${b.totalMinor}`,
    ).toBe("خادمي 0 + معلّق هذا الجهاز 6000 = 6000");
  });
});

const draft = (id: string, amount: string, direction: "debit" | "credit" = "debit") => {
  effectsOf.set(id, [{ accountKey: KEY, entryId: `${id}-entry`, direction, amountMinor: amount }]);
  return {
    operationId: id,
    kind: "probe",
    opVersion: 1,
    dependencies: [],
    members: [{ entity: "probe.Head", id: `${id}-h`, schemaVersion: 1, payload: { value: "1" } }],
  };
};
const candidate = (id: string, cutoff: string, balance: string, epoch = "epoch-A") => ({
  sync_epoch: epoch,
  snapshot_id: id,
  cutoff_server_seq: cutoff,
  schema_version: 1,
  as_of: "2026-09-15T10:30:00Z",
  balances: [{ party_id: "c1", account_role: "customer", currency: "SDG", amount_minor: balance }],
});

describe("اللقطة أثناء استمرار البيع (§٨.٩)", () => {
  it("المرشح يسجل local_frontier ومجموعة الفحص؛ الجديد بعده after_candidate؛ التفعيل بعد حسم الفحص فقط (ACC-07/48)", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft("old", "5000")); // seq 1 — غير مؤكد وقت المرشح
    expect(await recordCandidate(storage, candidate("s1", "120", "10000"), "epoch-A")).toBe(
      "recorded",
    );
    await saveOperation(storage, draft("new", "7000")); // seq 2 — بعد المرشح
    const ops = await storage.read(async (tx) => [
      await tx.getOperation("old"),
      await tx.getOperation("new"),
    ]);
    expect(ops[0]!.snapshotRelation).toBe("before_candidate");
    expect(ops[1]!.snapshotRelation).toBe("after_candidate");
    expect((await storage.read((tx) => tx.getSnapshot("s1")))!.localFrontier).toBe(1);

    // لا تفعيل والقديم غامض
    const blocked = await activateCandidate(storage, "s1", extract);
    expect(blocked).toEqual({ activated: false, unresolved: ["old"], frozenAccounts: [] });

    // المصالحة عبر PUSH: duplicate برقم ≤ S → موضعه ① ؛ ثم التفعيل
    await applyResults(storage, [
      {
        operation_id: "old",
        status: "duplicate",
        member_receipts: [{ entity: "probe.Head", id: "old-h", server_seq: "100" }],
      },
    ]);
    const done = await activateCandidate(storage, "s1", extract);
    expect(done).toEqual({ activated: true, unresolved: [], frozenAccounts: [] });
    expect(await storage.read((tx) => tx.getMeta(ACTIVE_SNAPSHOT_KEY))).toBe("s1");

    // الرصيد بعد التفعيل: ① 100 (يشمل old) + ③ new 70 = 170 — لا مضاعفة ولا اختفاء
    const all = await storage.read(async (tx) => [
      ...(await tx.listOperationsByState("synced")),
      ...(await tx.listOperationsByState("local")),
    ]);
    const snap = snapshotFromRow((await storage.read((tx) => tx.getSnapshot("s1")))!);
    const b = computeBalance(KEY, snap, all, extract);
    expect({
      server: b.serverMinor,
      local: b.localPendingMinor,
      total: b.totalMinor,
      trusted: b.trusted,
    }).toEqual({ server: 10000n, local: 7000n, total: 17000n, trusted: true });
  });

  it("مرشح أقدم من النشط يُلغى، ومن جيل آخر يُلغى، والقطع لا يتراجع (ACC-47)", async () => {
    const storage = new MemoryStorage();
    await recordCandidate(storage, candidate("s2", "200", "0"), "epoch-A");
    await activateCandidate(storage, "s2", extract);
    expect(await recordCandidate(storage, candidate("s1", "100", "0"), "epoch-A")).toBe(
      "discarded_older",
    );
    expect(await recordCandidate(storage, candidate("s9", "300", "0", "epoch-B"), "epoch-A")).toBe(
      "discarded_epoch",
    );
    expect(await recordCandidate(storage, candidate("s2", "200", "0"), "epoch-A")).toBe(
      "already_known",
    );
    expect((await storage.read((tx) => tx.listSnapshots())).map((s) => s.snapshotId)).toEqual([
      "s2",
    ]);
  });

  it("تعارض حساب واحد يجمّده وحده وتستمر البقية (ACC-49)", async () => {
    const storage = new MemoryStorage();
    const other = accountKey("c2", "customer", "SDG");
    await saveOperation(storage, draft("ok", "100"));
    await saveOperation(storage, draft("bad", "999"));
    effectsOf.set("bad", [
      { accountKey: other, entryId: "bad-e", direction: "debit", amountMinor: "999" },
    ]);
    await applyResults(storage, [
      {
        operation_id: "ok",
        status: "accepted",
        member_receipts: [{ entity: "probe.Head", id: "ok-h", server_seq: "1" }],
      },
      { operation_id: "bad", status: "conflicted", code: "content_mismatch" },
    ]);
    await recordCandidate(storage, candidate("s1", "1", "100"), "epoch-A");
    const r = await activateCandidate(storage, "s1", extract);
    expect(r).toEqual({ activated: true, unresolved: [], frozenAccounts: [other] });
    expect(await frozenAccounts(storage)).toEqual([other]);
    const ops = await storage.read(async (tx) => [
      ...(await tx.listOperationsByState("synced")),
      ...(await tx.listOperationsByState("conflict")),
    ]);
    const snap = snapshotFromRow((await storage.read((tx) => tx.getSnapshot("s1")))!);
    expect(computeBalance(KEY, snap, ops, extract).trusted).toBe(true);
    expect(computeBalance(other, snap, ops, extract).trusted).toBe(false);
  });
});

describe("تطبيق PULL (§٨.٧)", () => {
  const page = (over: Partial<PullPage> = {}): PullPage => ({
    protocol_version: 1,
    sync_epoch: "epoch-A",
    request_id: "p",
    entities: [],
    operation_projections: [],
    tombstones: [],
    access_manifest_version: "1",
    cursors: [{ scope: "enterprise", entity_group: "probe", server_seq: "0" }],
    has_more: false,
    snapshot_candidates: [],
    ...over,
  });

  it("النسخة الأحدث تُطبَّق، الأقدم تُتجاهل، التساوي مع اختلاف المحتوى شذوذ (ACC-40)", async () => {
    const storage = new MemoryStorage();
    const e = (seq: string, v: string) => ({
      entity: "catalog.Item",
      id: "i1",
      schema_version: 1,
      payload: { v },
      server_seq: seq,
      operation_id: "op",
    });
    const r1 = await applyPullPage(
      storage,
      page({
        entities: [e("10", "a")],
        cursors: [{ scope: "enterprise", entity_group: "probe", server_seq: "10" }],
      }),
      "epoch-A",
    );
    const r2 = await applyPullPage(storage, page({ entities: [e("5", "old")] }), "epoch-A");
    const r3 = await applyPullPage(storage, page({ entities: [e("10", "b")] }), "epoch-A");
    expect([r1.applied, r2.skippedOlder, r3.anomalies]).toEqual([1, 1, ["catalog.Item:i1@10"]]);
    const cur = await storage.read((tx) => tx.getCursor("enterprise", "", "probe"));
    expect(cur!.serverSeq).toBe("10"); // لا تراجع
    expect(
      (await storage.read((tx) => tx.getProjection("entity:catalog.Item:i1")))!.value.payload,
    ).toEqual({ v: "a" });
  });

  it("PULL يثبت قبول عملية محلية باكتمال جزئها المخوَّل — نفس انتقال ACK (ACC-06)", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft("mine", "100"));
    await applyPullPage(
      storage,
      page({
        entities: [
          {
            entity: "probe.Head",
            id: "mine-h",
            schema_version: 1,
            payload: { value: "1" },
            server_seq: "77",
            operation_id: "mine",
          },
        ],
        operation_projections: [
          {
            operation_id: "mine",
            kind: "probe",
            op_version: 1,
            members: [{ entity: "probe.Head", id: "mine-h" }],
            authorized_complete: true,
            members_hash: "x",
          },
        ],
      }),
      "epoch-A",
    );
    const op = await storage.read((tx) => tx.getOperation("mine"));
    expect(op!.state).toBe("synced");
    expect(op!.members[0]!.serverSeq).toBe("77");
    // ACK لاحق لا يغيّر شيئاً (الحدث الواحد مرة)
    await applyResults(storage, [
      {
        operation_id: "mine",
        status: "accepted",
        member_receipts: [{ entity: "probe.Head", id: "mine-h", server_seq: "78" }],
      },
    ]);
    expect((await storage.read((tx) => tx.getOperation("mine")))!.members[0]!.serverSeq).toBe("77");
  });

  it("إسقاط ناقص يبقى staging ولا يُعرض؛ يكتمل عبر صفحتين (ACC-43)", async () => {
    const storage = new MemoryStorage();
    const proj = {
      operation_id: "big",
      kind: "probe",
      op_version: 1,
      members: [
        { entity: "probe.Head", id: "h" },
        { entity: "probe.Line", id: "l" },
      ],
      authorized_complete: true,
      members_hash: "x",
    };
    const r1 = await applyPullPage(
      storage,
      page({
        entities: [
          {
            entity: "probe.Head",
            id: "h",
            schema_version: 1,
            payload: {},
            server_seq: "1",
            operation_id: "big",
          },
        ],
        operation_projections: [proj],
        has_more: true,
      }),
      "epoch-A",
    );
    expect(r1.staged).toBe(1);
    expect(await storage.read((tx) => tx.getProjection("operation:big"))).toBeNull();
    const r2 = await applyPullPage(
      storage,
      page({
        entities: [
          {
            entity: "probe.Line",
            id: "l",
            schema_version: 1,
            payload: {},
            server_seq: "2",
            operation_id: "big",
          },
        ],
        operation_projections: [proj],
      }),
      "epoch-A",
    );
    expect(r2.activatedProjections).toBe(1);
    expect((await storage.read((tx) => tx.getProjection("operation:big")))!.value.complete).toBe(
      true,
    );
  });

  it("شاهد الحذف صريح، والمرشح يُسجَّل، وصفحة من جيل آخر تُرفض (ACC-45/56)", async () => {
    const storage = new MemoryStorage();
    const r = await applyPullPage(
      storage,
      page({
        tombstones: [{ entity: "catalog.Item", id: "gone", server_seq: "9" }],
        snapshot_candidates: [candidate("s1", "9", "0")],
      }),
      "epoch-A",
    );
    expect([r.tombstoned, r.candidates]).toEqual([1, 1]);
    expect(
      (await storage.read((tx) => tx.getProjection("entity:catalog.Item:gone")))!.value.deleted,
    ).toBe(true);
    await expect(
      applyPullPage(storage, page({ sync_epoch: "epoch-Z" }), "epoch-A"),
    ).rejects.toThrow("epoch_mismatch");
  });
});

describe("تبدّل الجيل (§٨.١٢)", () => {
  it("الجيل الجديد يعزل القديم ويعيد المؤكد للرفع بهويته؛ الرد القديم يُهمل (ACC-55/56/57)", async () => {
    const storage = new MemoryStorage();
    await saveOperation(storage, draft("a", "1"));
    await applyResults(storage, [
      {
        operation_id: "a",
        status: "accepted",
        member_receipts: [{ entity: "probe.Head", id: "a-h", server_seq: "5" }],
      },
    ]);
    await recordCandidate(storage, candidate("s1", "5", "1"), "epoch-A");
    await activateCandidate(storage, "s1", extract);
    expect(await adoptEpoch(storage, "epoch-A")).toMatchObject({
      changed: true,
      previousEpoch: null,
    });
    const change = await adoptEpoch(storage, "epoch-B");
    expect(change).toEqual({ changed: true, previousEpoch: "epoch-A", requeued: 1 });
    const a = await storage.read((tx) => tx.getOperation("a"));
    expect(a!.state).toBe("local");
    expect(a!.members[0]!.serverSeq).toBeNull();
    expect((await storage.read((tx) => tx.getSnapshot("s1")))!.state).toBe("discarded");
    expect(await storage.read((tx) => tx.getMeta("active_snapshot"))).toBe("");
    expect(isStaleEpoch("epoch-A", "epoch-B")).toBe(true);
    expect(isStaleEpoch("epoch-B", "epoch-B")).toBe(false);
  });
});

describe("التقليم الآمن (§٨.١١)", () => {
  const synced = (seq: string): StoredOperation =>
    toStored({
      id: "x",
      state: "synced",
      serverSeq: seq,
      createdLocalSeq: 1,
      relation: "none",
      effects: [],
    });
  const base = {
    currentEpoch: "e",
    operationEpoch: "e",
    requiredProjections: ["ledger", "stock", "cash"] as const,
    hasDependents: false,
    outsideDisplayWindow: true,
  };

  it("A عند S=50 وB عند S=100؛ حركة A رقم 70 لا تُقلَّم (ACC-50)", () => {
    expect(
      pruneVerdict(synced("70"), {
        ...base,
        coverage: { ledger: "50", stock: "100", cash: "100" },
      }),
    ).toEqual({ prune: false, reason: "uncovered" });
    expect(
      pruneVerdict(synced("70"), {
        ...base,
        coverage: { ledger: "100", stock: "100", cash: "100" },
      }),
    ).toEqual({ prune: true });
  });

  it("مؤكدة أحدث من لقطة المستهلك لا تُقلَّم ولو خرجت من النافذة (ACC-51)، وغير المؤكدة والمعتمد عليها لا تُقلَّم", () => {
    expect(
      pruneVerdict(synced("101"), {
        ...base,
        coverage: { ledger: "100", stock: "100", cash: "100" },
      }),
    ).toEqual({ prune: false, reason: "uncovered" });
    expect(
      pruneVerdict(synced("10"), {
        ...base,
        coverage: { ledger: "100", stock: "100", cash: "100" },
        hasDependents: true,
      }),
    ).toEqual({ prune: false, reason: "has_dependents" });
    expect(
      pruneVerdict(synced("10"), {
        ...base,
        coverage: { ledger: "100", stock: "100", cash: "100" },
        outsideDisplayWindow: false,
      }),
    ).toEqual({ prune: false, reason: "in_display_window" });
    expect(
      pruneVerdict(synced("10"), {
        ...base,
        coverage: { ledger: "100", stock: "100", cash: "100" },
        operationEpoch: "old",
      }),
    ).toEqual({ prune: false, reason: "stale_epoch" });
    expect(
      pruneVerdict(
        toStored({ id: "l", state: "local", createdLocalSeq: 1, relation: "none", effects: [] }),
        { ...base, coverage: { ledger: "100", stock: "100", cash: "100" } },
      ),
    ).toEqual({ prune: false, reason: "unconfirmed" });
  });
});
