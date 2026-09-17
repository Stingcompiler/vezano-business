"use client";

/**
 * سياق الوردية على هذا الجهاز: الفرع والجهاز والمسؤول — من تسجيل الجهاز (`device.registration`)
 * والجلسة، ويُخزَّن آخر ما أكّده الخادم في meta `shift.context` ليعمل الفتح بلا اتصال.
 */
import type { StoragePort } from "@sting/platform";
import type { DiscountCaps } from "@sting/sync-core";

import type { AppContextValue } from "@/lib/app-context";

export const SHIFT_CONTEXT_META = "shift.context";
const DEVICE_META = "device.registration";

export interface ShiftContext {
  readonly branchId: string;
  readonly branchName: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly userId: string;
  readonly userName: string;
  readonly roleName: string;
  /** السحب للمالك وحده (SHIFT-03) — كما قاله الخادم آخر مرة. */
  readonly canWithdraw?: boolean | undefined;
  readonly ownerName?: string | undefined;
  /** رمز الدور وسقوف الخصم (POS-03؛ G-09 مؤقتاً) — كما قالها الخادم آخر مرة، للعمل بلا اتصال. */
  readonly roleCode?: string | undefined;
  readonly discountCaps?: DiscountCaps | undefined;
}

export async function readShiftContext(
  storage: StoragePort,
  app: Pick<AppContextValue, "device" | "session">,
): Promise<ShiftContext | null> {
  const [ctxRaw, devRaw] = await storage.read(async (tx) => [
    await tx.getMeta(SHIFT_CONTEXT_META),
    await tx.getMeta(DEVICE_META),
  ]);
  const cached = ctxRaw ? (JSON.parse(ctxRaw) as Partial<ShiftContext>) : {};
  const dev = devRaw ? (JSON.parse(devRaw) as { deviceId?: string; branchId?: string }) : {};
  const deviceId = app.device?.deviceId ?? dev.deviceId ?? cached.deviceId ?? "";
  const branchId = app.device?.branchId ?? dev.branchId ?? cached.branchId ?? "";
  if (!deviceId && !branchId && !cached.branchName) return null;
  return {
    branchId,
    branchName: cached.branchName ?? "",
    deviceId,
    deviceName: cached.deviceName ?? "",
    userId: app.session.userId ?? cached.userId ?? "",
    userName: app.session.displayName ?? cached.userName ?? "",
    roleName: cached.roleName ?? "",
    canWithdraw: cached.canWithdraw,
    ownerName: cached.ownerName,
    roleCode: cached.roleCode,
    discountCaps: cached.discountCaps,
  };
}

export async function storeShiftContext(storage: StoragePort, ctx: ShiftContext): Promise<void> {
  await storage.transaction((tx) => tx.putMeta(SHIFT_CONTEXT_META, JSON.stringify(ctx)));
}
