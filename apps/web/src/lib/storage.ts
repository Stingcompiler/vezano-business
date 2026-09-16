"use client";

/**
 * تخزين الجهاز: Dexie عبر عقد @sting/platform؛ قاعدة واحدة لكل نسخة تشغيل مسجلة (§٨.١٣).
 * الاسم يُثبَّت بعد التسجيل (ACC-05)؛ قبله قاعدة تمهيد.
 */
import { DexieStorage, type StoragePort } from "@sting/platform/dexie";

let instance: DexieStorage | null = null;
let currentName = "sting-bootstrap";

export function getStorage(databaseName = currentName): StoragePort {
  if (typeof indexedDB === "undefined")
    throw new Error("IndexedDB غير متاح — التخزين المحلي مطلوب لوضع البيع (§١٣.١)");
  if (instance && databaseName !== currentName) {
    instance = null;
  }
  currentName = databaseName;
  instance ??= new DexieStorage({ databaseName });
  return instance;
}

/**
 * تبديل الحساب/المنشأة يُفرّغ الذاكرة المحلية للحساب السابق (28-D21 ACC-03؛ معيار §١٨ ACC-138):
 * «قوائم الأسعار والسلال والكتالوج المخزَّن كلها تُمحى من الجهاز قبل تحميل الحساب الجديد».
 */
export async function wipeLocalStorage(): Promise<void> {
  const s = getStorage();
  await (s as DexieStorage).deleteDatabase();
  instance = null;
}
