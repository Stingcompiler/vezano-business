/**
 * التهيئة الأولى من نسخة مادية ثابتة (§٨.١٠؛ ACC-05):
 * - تُحفظ الصفحات مرحلياً وتُستأنف من النسخة نفسها؛ صفحة مكررة أو خارج الترتيب لا تغيّر الحالة
 *   ولا تُرجع المؤشر (ACC-40).
 * - التفعيل عند اكتمال كل النطاقات فقط: اللقطة تصير نشطة، ومؤشرات مجموعات الحركات تتقدم إلى القطع.
 * - انتهاء الصلاحية يبدأ مرشحاً جديداً دون محو العمليات المحلية.
 * - الجاهزية قائمة قدرات لا نعم/لا (34-D26 partial): البيع يحتاج الكتالوج والإعدادات؛ الجرد الأرصدة.
 */
import type { StoragePort, StorageTransaction } from "@sting/platform";

import { ACTIVE_SNAPSHOT_KEY } from "./snapshots";

export const BOOTSTRAP_KEY = "bootstrap.progress";
export const DEVICE_SETUP_KEY = "device.setup";
export const DEVICE_SETUP_TENANTS_KEY = "device.setup.tenants";

export type BootstrapGroup = "catalog" | "parties" | "balances" | "settings";
export const BOOTSTRAP_GROUPS: readonly BootstrapGroup[] = [
  "catalog",
  "parties",
  "balances",
  "settings",
];

export interface BootstrapScope {
  readonly group: string;
  readonly total: number;
  readonly pages: number;
}

export interface BootstrapImage {
  readonly image_id: string;
  readonly sync_epoch: string;
  readonly snapshot_id: string;
  readonly cutoff_server_seq: string;
  readonly schema_version: number;
  readonly as_of: string;
  readonly expires_at: string;
  readonly page_size: number;
  readonly scopes: readonly BootstrapScope[];
  readonly balances: readonly Record<string, string>[];
}

export interface BootstrapEntity {
  readonly entity: string;
  readonly id: string;
  readonly payload: Record<string, unknown>;
}

export interface BootstrapProgress {
  readonly image: BootstrapImage;
  readonly tenantId: string;
  readonly branchId: string;
  /** صفحات مكتملة لكل نطاق — تتقدم واحدةً واحدة. */
  readonly pagesDone: Readonly<Record<string, number>>;
  /** كيانات وصلت لكل نطاق — لعرض «الأطراف ٨٨ من ٣٠٠». */
  readonly received: Readonly<Record<string, number>>;
  readonly startedAt: string;
  readonly activatedAt: string | null;
}

export async function readBootstrap(storage: StoragePort): Promise<BootstrapProgress | null> {
  const raw = await storage.read((tx) => tx.getMeta(BOOTSTRAP_KEY));
  return raw ? (JSON.parse(raw) as BootstrapProgress) : null;
}

async function write(tx: StorageTransaction, p: BootstrapProgress): Promise<void> {
  await tx.putMeta(BOOTSTRAP_KEY, JSON.stringify(p));
}

/**
 * يبدأ نسخة أو يستأنف الموجودة إن كانت النسخة نفسها. نسخة مختلفة تحلّ محل القديمة
 * («ما نُزِّل قديم — نبدأ من جديد») — العمليات المحلية لا تُمسّ.
 */
export async function beginBootstrap(
  storage: StoragePort,
  image: BootstrapImage,
  ids: { tenantId: string; branchId: string },
  now: () => Date = () => new Date(),
): Promise<BootstrapProgress> {
  return storage.transaction(async (tx) => {
    const raw = await tx.getMeta(BOOTSTRAP_KEY);
    const existing = raw ? (JSON.parse(raw) as BootstrapProgress) : null;
    if (existing && existing.image.image_id === image.image_id) return existing;
    const zero = Object.fromEntries(image.scopes.map((s) => [s.group, 0]));
    const p: BootstrapProgress = {
      image,
      tenantId: ids.tenantId,
      branchId: ids.branchId,
      pagesDone: { ...zero },
      received: { ...zero },
      startedAt: now().toISOString(),
      activatedAt: null,
    };
    await write(tx, p);
    return p;
  });
}

export type PageOutcome = "applied" | "duplicate" | "out_of_order" | "no_bootstrap";

/** يكتب كيانات الصفحة إسقاطاتٍ ويقدّم مؤشر النطاق — في معاملة واحدة (ACC-40: حالة واحدة). */
export async function applyBootstrapPage(
  storage: StoragePort,
  group: string,
  pageNo: number,
  entities: readonly BootstrapEntity[],
): Promise<{ outcome: PageOutcome; progress: BootstrapProgress | null }> {
  return storage.transaction(async (tx) => {
    const raw = await tx.getMeta(BOOTSTRAP_KEY);
    if (!raw) return { outcome: "no_bootstrap", progress: null };
    const p = JSON.parse(raw) as BootstrapProgress;
    const done = p.pagesDone[group] ?? 0;
    if (pageNo <= done) return { outcome: "duplicate", progress: p };
    if (pageNo !== done + 1) return { outcome: "out_of_order", progress: p };
    for (const e of entities) {
      await tx.putProjection({ key: `entity:${e.entity}:${e.id}`, value: e.payload });
    }
    const next: BootstrapProgress = {
      ...p,
      pagesDone: { ...p.pagesDone, [group]: pageNo },
      received: { ...p.received, [group]: (p.received[group] ?? 0) + entities.length },
    };
    await write(tx, next);
    return { outcome: "applied", progress: next };
  });
}

/** الخادم أعلن انتهاء النسخة (410) في منتصف الصفحات: تُوسم منتهية فيبدأ التشغيل التالي نسخة جديدة. */
export async function expireBootstrap(
  storage: StoragePort,
  now: () => Date = () => new Date(),
): Promise<void> {
  await storage.transaction(async (tx) => {
    const raw = await tx.getMeta(BOOTSTRAP_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as BootstrapProgress;
    await write(tx, { ...p, image: { ...p.image, expires_at: now().toISOString() } });
  });
}

/** ترتيب التنزيل: الإعدادات أولاً (صغيرة ولازمة للبيع) ثم الكتالوج فالأطراف فالأرصدة. */
export const DOWNLOAD_ORDER: readonly string[] = ["settings", "catalog", "parties", "balances"];

export function groupComplete(p: BootstrapProgress, group: string): boolean {
  const scope = p.image.scopes.find((s) => s.group === group);
  return scope ? (p.pagesDone[group] ?? 0) >= scope.pages : false;
}

export function isComplete(p: BootstrapProgress): boolean {
  return p.image.scopes.every((s) => groupComplete(p, s.group));
}

export function isExpired(p: BootstrapProgress, now: Date = new Date()): boolean {
  return new Date(p.image.expires_at).getTime() <= now.getTime();
}

/** الجاهزية قائمة قدرات: «تستطيع البيع الآن · الجرد يحتاج الأرصدة». */
export function capabilities(p: BootstrapProgress): { sell: boolean; inventory: boolean } {
  return {
    sell: groupComplete(p, "catalog") && groupComplete(p, "settings"),
    inventory: groupComplete(p, "balances"),
  };
}

/** نسبة الصفحات المكتملة إلى الكل — لعبارة «انقطع الاتصال عند N%». */
export function percentDone(p: BootstrapProgress): number {
  const total = p.image.scopes.reduce((n, s) => n + s.pages, 0);
  const done = p.image.scopes.reduce((n, s) => n + Math.min(p.pagesDone[s.group] ?? 0, s.pages), 0);
  return total === 0 ? 100 : Math.floor((done * 100) / total);
}

export const TRANSACTION_GROUPS = ["sales", "inventory", "shifts"] as const;

export type ActivateOutcome = "activated" | "incomplete" | "no_bootstrap" | "already_active";

/**
 * التفعيل بعد الاكتمال والتحقق (كل النطاقات بصفحاتها): اللقطة نشطة، مؤشرات الحركات عند القطع،
 * والجهاز مهيّأ لهذه المنشأة — كل ذلك في معاملة واحدة.
 */
export async function activateBootstrap(
  storage: StoragePort,
  now: () => Date = () => new Date(),
): Promise<{ outcome: ActivateOutcome; progress: BootstrapProgress | null }> {
  return storage.transaction(async (tx) => {
    const raw = await tx.getMeta(BOOTSTRAP_KEY);
    if (!raw) return { outcome: "no_bootstrap", progress: null };
    const p = JSON.parse(raw) as BootstrapProgress;
    if (p.activatedAt) return { outcome: "already_active", progress: p };
    if (!isComplete(p)) return { outcome: "incomplete", progress: p };
    await tx.putSnapshot({
      snapshotId: p.image.snapshot_id,
      syncEpoch: p.image.sync_epoch,
      cutoffServerSeq: p.image.cutoff_server_seq,
      state: "active",
      balances: p.image.balances,
      localFrontier: await tx.currentLocalSeq(),
    });
    await tx.putMeta(ACTIVE_SNAPSHOT_KEY, p.image.snapshot_id);
    await tx.putMeta("sync_epoch", p.image.sync_epoch);
    for (const group of TRANSACTION_GROUPS) {
      await tx.advanceCursor({
        scope: "branch",
        scopeId: p.branchId,
        entityGroup: group,
        serverSeq: p.image.cutoff_server_seq,
      });
    }
    const tenantsRaw = await tx.getMeta(DEVICE_SETUP_TENANTS_KEY);
    const tenants = new Set<string>(tenantsRaw ? (JSON.parse(tenantsRaw) as string[]) : []);
    tenants.add(p.tenantId);
    await tx.putMeta(DEVICE_SETUP_TENANTS_KEY, JSON.stringify([...tenants]));
    await tx.putMeta(DEVICE_SETUP_KEY, "done");
    const next: BootstrapProgress = { ...p, activatedAt: now().toISOString() };
    await write(tx, next);
    return { outcome: "activated", progress: next };
  });
}
