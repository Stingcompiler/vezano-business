"use client";

/**
 * آخر قائمة عضويات معروفة على هذا الجهاز (34-D26 ACC-03): للهياكل في loading بعددها، وللعرض في
 * offline وstale مع وقت حفظها. تعيش في meta التخزين المحلي لا في localStorage (§٨.٢).
 */
import { getStorage } from "@/lib/storage";

export interface MembershipRow {
  readonly user_id: string;
  readonly tenant_id: string;
  readonly tenant_name: string;
  readonly role_name: string;
  readonly scope: string;
  readonly status: "active" | "suspended";
}

export interface MembershipsCache {
  readonly savedAt: string;
  readonly items: readonly MembershipRow[];
}

const KEY = "memberships.cache";

export async function readMembershipsCache(): Promise<MembershipsCache | null> {
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(KEY));
    if (!raw) return null;
    return JSON.parse(raw) as MembershipsCache;
  } catch {
    return null;
  }
}

export async function writeMembershipsCache(items: readonly MembershipRow[]): Promise<void> {
  const cache: MembershipsCache = { savedAt: new Date().toISOString(), items };
  try {
    await getStorage().transaction((tx) => tx.putMeta(KEY, JSON.stringify(cache)));
  } catch {
    /* التخزين غير متاح — القائمة تُعرض من الشبكة فقط */
  }
}
