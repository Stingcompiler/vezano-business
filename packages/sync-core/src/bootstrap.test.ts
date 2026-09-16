import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import {
  activateBootstrap,
  applyBootstrapPage,
  beginBootstrap,
  type BootstrapImage,
  capabilities,
  DEVICE_SETUP_KEY,
  DEVICE_SETUP_TENANTS_KEY,
  isComplete,
  isExpired,
  percentDone,
  readBootstrap,
} from "./bootstrap";
import { ACTIVE_SNAPSHOT_KEY } from "./snapshots";

const image = (over: Partial<BootstrapImage> = {}): BootstrapImage => ({
  image_id: "img-1",
  sync_epoch: "E1",
  snapshot_id: "snap-1",
  cutoff_server_seq: "42",
  schema_version: 1,
  as_of: "2026-09-16T08:00:00Z",
  expires_at: "2026-09-17T08:00:00Z",
  page_size: 2,
  scopes: [
    { group: "catalog", total: 3, pages: 2 },
    { group: "parties", total: 0, pages: 1 },
    { group: "balances", total: 1, pages: 1 },
    { group: "settings", total: 2, pages: 1 },
  ],
  balances: [{ party_id: "p1", account_role: "customer", currency: "SDG", amount_minor: "500" }],
  ...over,
});
const ids = { tenantId: "t1", branchId: "b1" };
const ent = (id: string) => ({ entity: "catalog.Item", id, payload: { name: id } });

describe("التهيئة من نسخة مادية (§٨.١٠)", () => {
  it("تُستأنف من النسخة نفسها؛ صفحة مكررة أو خارج الترتيب لا تغيّر الحالة (ACC-40)", async () => {
    const s = new MemoryStorage();
    await beginBootstrap(s, image(), ids);
    expect((await applyBootstrapPage(s, "catalog", 2, [ent("c")])).outcome).toBe("out_of_order");
    expect((await applyBootstrapPage(s, "catalog", 1, [ent("a"), ent("b")])).outcome).toBe(
      "applied",
    );
    expect((await applyBootstrapPage(s, "catalog", 1, [ent("a"), ent("b")])).outcome).toBe(
      "duplicate",
    );
    const p = await readBootstrap(s);
    expect(p?.pagesDone.catalog).toBe(1);
    expect(p?.received.catalog).toBe(2);
    // الاستئناف: beginBootstrap بالنسخة نفسها لا يصفّر التقدّم
    const resumed = await beginBootstrap(s, image(), ids);
    expect(resumed.pagesDone.catalog).toBe(1);
    expect(await s.read((tx) => tx.getProjection("entity:catalog.Item:a"))).toEqual({
      key: "entity:catalog.Item:a",
      value: { name: "a" },
    });
  });

  it("القدرات قائمة لا نعم/لا: البيع بالكتالوج والإعدادات، الجرد بالأرصدة (34-D26 partial)", async () => {
    const s = new MemoryStorage();
    await beginBootstrap(s, image(), ids);
    await applyBootstrapPage(s, "catalog", 1, [ent("a"), ent("b")]);
    await applyBootstrapPage(s, "catalog", 2, [ent("c")]);
    await applyBootstrapPage(s, "settings", 1, [ent("u1"), ent("u2")]);
    const p = (await readBootstrap(s))!;
    expect(capabilities(p)).toEqual({ sell: true, inventory: false });
    expect(isComplete(p)).toBe(false);
    expect(percentDone(p)).toBe(60);
    expect((await activateBootstrap(s)).outcome).toBe("incomplete");
  });

  it("التفعيل عند الاكتمال: لقطة نشطة ومؤشرات الحركات عند القطع والجهاز مهيّأ للمنشأة", async () => {
    const s = new MemoryStorage();
    await beginBootstrap(s, image(), ids);
    await applyBootstrapPage(s, "catalog", 1, [ent("a"), ent("b")]);
    await applyBootstrapPage(s, "catalog", 2, [ent("c")]);
    await applyBootstrapPage(s, "parties", 1, []);
    await applyBootstrapPage(s, "balances", 1, [ent("bal")]);
    await applyBootstrapPage(s, "settings", 1, [ent("u1"), ent("u2")]);
    const r = await activateBootstrap(s, () => new Date("2026-09-16T09:00:00Z"));
    expect(r.outcome).toBe("activated");
    expect(r.progress?.activatedAt).toBe("2026-09-16T09:00:00.000Z");
    await s.read(async (tx) => {
      expect(await tx.getMeta(ACTIVE_SNAPSHOT_KEY)).toBe("snap-1");
      expect((await tx.getSnapshot("snap-1"))?.state).toBe("active");
      expect((await tx.getCursor("branch", "b1", "sales"))?.serverSeq).toBe("42");
      expect(await tx.getMeta(DEVICE_SETUP_KEY)).toBe("done");
      expect(await tx.getMeta(DEVICE_SETUP_TENANTS_KEY)).toBe('["t1"]');
    });
    expect((await activateBootstrap(s)).outcome).toBe("already_active");
  });

  it("النسخة المنتهية تُستبدل بنسخة جديدة دون مسّ العمليات المحلية (ACC-53)", async () => {
    const s = new MemoryStorage();
    await beginBootstrap(s, image({ expires_at: "2026-09-16T07:00:00Z" }), ids);
    await applyBootstrapPage(s, "catalog", 1, [ent("a"), ent("b")]);
    await s.transaction((tx) => tx.putMeta("local-op-marker", "kept"));
    expect(isExpired((await readBootstrap(s))!, new Date("2026-09-16T08:00:00Z"))).toBe(true);
    const fresh = await beginBootstrap(s, image({ image_id: "img-2", snapshot_id: "snap-2" }), ids);
    expect(fresh.pagesDone.catalog).toBe(0);
    expect(await s.read((tx) => tx.getMeta("local-op-marker"))).toBe("kept");
  });
});
