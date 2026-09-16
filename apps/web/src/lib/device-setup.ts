"use client";

/**
 * هل هذا الجهاز مهيّأ (ACC-05 سجّله ونزّل نسخته)؟ يقرّر ACC-01/ACC-02 قبل الرسم:
 * «وجود تهيئة محلية يغيّر الشاشة لا نصّها» (34-D26). المفتاح يكتبه ACC-05 (T1.3).
 */
import { getStorage } from "@/lib/storage";

export const DEVICE_SETUP_KEY = "device.setup";

export async function hasLocalSetup(): Promise<boolean> {
  try {
    const value = await getStorage().read((tx) => tx.getMeta(DEVICE_SETUP_KEY));
    return value === "done";
  } catch {
    return false;
  }
}
