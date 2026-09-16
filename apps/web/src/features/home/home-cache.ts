"use client";

import { getStorage } from "@/lib/storage";

import type { HomeSummary } from "./types";

const KEY = "home.cache";

export interface HomeCache {
  readonly savedAt: string;
  readonly summary: HomeSummary;
}

/** آخر ملخّص معروف — للأرقام «من آخر مطابقة» بلا اتصال أو حين تتعثّر المطابقة (stale). */
export async function readHomeCache(): Promise<HomeCache | null> {
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(KEY));
    return raw ? (JSON.parse(raw) as HomeCache) : null;
  } catch {
    return null;
  }
}

export async function writeHomeCache(summary: HomeSummary): Promise<void> {
  try {
    await getStorage().transaction((tx) =>
      tx.putMeta(KEY, JSON.stringify({ savedAt: new Date().toISOString(), summary })),
    );
  } catch {
    /* التخزين غير متاح */
  }
}

export async function countLocalPending(): Promise<number> {
  try {
    return await getStorage().read(
      async (tx) =>
        (await tx.listOperationsByState("local")).length +
        (await tx.listOperationsByState("pending")).length,
    );
  } catch {
    return 0;
  }
}
