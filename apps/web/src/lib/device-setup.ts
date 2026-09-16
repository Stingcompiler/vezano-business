"use client";

/**
 * هل هذا الجهاز مهيّأ (ACC-05 سجّله ونزّل نسخته)؟ يقرّر ACC-01/ACC-02 قبل الرسم:
 * «وجود تهيئة محلية يغيّر الشاشة لا نصّها» (34-D26). المفتاح يكتبه ACC-05 (T1.3).
 * لكل منشأة مهيّأة على الجهاز إدخال في `device.setup.tenants` (ACC-03 offline: «المنشآت التي هُيّئت
 * على هذا الجهاز وحدها قابلة للفتح»).
 */
import { getStorage } from "@/lib/storage";

export const DEVICE_SETUP_KEY = "device.setup";
export const DEVICE_SETUP_TENANTS_KEY = "device.setup.tenants";

export async function hasLocalSetup(): Promise<boolean> {
  try {
    const value = await getStorage().read((tx) => tx.getMeta(DEVICE_SETUP_KEY));
    return value === "done";
  } catch {
    return false;
  }
}

export async function localSetupTenants(): Promise<readonly string[]> {
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(DEVICE_SETUP_TENANTS_KEY));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
