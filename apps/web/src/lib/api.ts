"use client";

/**
 * عميل الخادم المكتوب الأنواع (@sting/contracts) — لبيانات الخادم فقط (§٤.٥).
 * العنوان من NEXT_PUBLIC_API_URL؛ الافتراضي خادم التطوير المحلي.
 * 401 على مسار مُصادَق = جلسة منتهية أو مُبطَلة → ACC-08 (لا يمنع الحفظ المحلي).
 */
import { type ContractsClient, createContractsClient } from "@sting/contracts";

let client: ContractsClient | null = null;
let accessToken: string | null = null;
let onUnauthorized: ((path: string) => void) | null = null;

/** مسارات لا تعني 401 فيها انتهاء جلسة (دخول، تحقق، تجديد). */
const PUBLIC_PATHS = ["/api/auth/", "/api/tenants/sectors", "/api/health"];

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** للرفع بتقدّم (XMLHttpRequest) حيث لا يعطي fetch نسبةً — CAT-02 «رفع الصورة 60%». */
export function getAccessToken(): string | null {
  return accessToken;
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export function setUnauthorizedHandler(handler: ((path: string) => void) | null): void {
  onUnauthorized = handler;
}

export function api(): ContractsClient {
  if (!client) {
    client = createContractsClient({
      baseUrl: apiBaseUrl(),
      getAccessToken: () => accessToken,
    });
    client.use({
      onResponse({ request, response }) {
        const path = new URL(request.url).pathname;
        if (
          response.status === 401 &&
          accessToken &&
          !PUBLIC_PATHS.some((p) => path.startsWith(p))
        ) {
          onUnauthorized?.(path);
        }
        return response;
      },
    });
  }
  return client;
}
