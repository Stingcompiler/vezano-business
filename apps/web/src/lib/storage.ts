"use client";

/**
 * تخزين الجهاز: Dexie عبر عقد @sting/platform؛ قاعدة واحدة لكل نسخة تشغيل مسجلة (§٨.١٣).
 * الاسم يُثبَّت بعد التسجيل (ACC-05)؛ قبله قاعدة تمهيد.
 */
import { DexieStorage, type StoragePort } from "@sting/platform/dexie";

let instance: StoragePort | null = null;

export function getStorage(databaseName = "sting-bootstrap"): StoragePort {
  if (typeof indexedDB === "undefined")
    throw new Error("IndexedDB غير متاح — التخزين المحلي مطلوب لوضع البيع (§١٣.١)");
  instance ??= new DexieStorage({ databaseName });
  return instance;
}
