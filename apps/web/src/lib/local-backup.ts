"use client";

/**
 * «صدّر نسخة محلية» (SYS-05؛ يعمل بلا اتصال): ملف JSON بكل العمليات المحلية غير المؤكدة وبيانات
 * الجهاز — ليُحمل إلى جهاز آخر أو الدعم. بلا تشفير حتى قرار G-17 (0005 §٦).
 */
import type { StoredOperation } from "@sting/platform";

import { getStorage } from "@/lib/storage";

export interface LocalBackup {
  readonly format: "sting-local-backup";
  readonly version: 1;
  readonly exported_at: string;
  readonly operations: readonly StoredOperation[];
}

export async function buildLocalBackup(): Promise<LocalBackup> {
  const storage = getStorage();
  const operations = await storage.read(async (tx) => [
    ...(await tx.listOperationsByState("local")),
    ...(await tx.listOperationsByState("pending")),
    ...(await tx.listOperationsByState("conflict")),
  ]);
  return {
    format: "sting-local-backup",
    version: 1,
    exported_at: new Date().toISOString(),
    operations,
  };
}

export async function downloadLocalBackup(): Promise<number> {
  const backup = await buildLocalBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sting-backup-${backup.exported_at.replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return backup.operations.length;
}
