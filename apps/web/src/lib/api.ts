"use client";

/**
 * عميل الخادم المكتوب الأنواع (@sting/contracts) — لبيانات الخادم فقط (§٤.٥).
 * العنوان من NEXT_PUBLIC_API_URL؛ الافتراضي خادم التطوير المحلي.
 */
import { type ContractsClient, createContractsClient } from "@sting/contracts";

let client: ContractsClient | null = null;
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function api(): ContractsClient {
  client ??= createContractsClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
    getAccessToken: () => accessToken,
  });
  return client;
}
