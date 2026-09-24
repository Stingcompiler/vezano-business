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
let deviceRefresh: string | null = null;

/** رمز تجديد الجهاز — للاعتماد المقيّد وحده (SYS-07: تسليم عمل جهاز مسحوب إلى الحجر). */
export function setDeviceRefresh(token: string | null): void {
  deviceRefresh = token;
}

export function getDeviceRefresh(): string | null {
  return deviceRefresh;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export function setUnauthorizedHandler(handler: ((path: string) => void) | null): void {
  onUnauthorized = handler;
}

/**
 * 0005 §١٢١ — الاستئناف الصامت: رمز الوصول يعيش 15 دقيقة ولم يكن يُجدَّد، فكانت الجلسة تسقط إلى
 * ACC-08 أثناء العمل. عند 401 على مسار مُصادَق: يُستأنف من الـCookie مرة (طلب واحد مهما تعدّد)،
 * ويُعاد الطلب نفسه بالرمز الجديد؛ فشل الاستئناف وحده يقود إلى ACC-08.
 */
type Resumer = () => Promise<{ access: string } | null>;
let resumer: Resumer | null = null;

export function setResumer(fn: Resumer | null): void {
  resumer = fn;
}

const pending = new Map<string, Request>();

export function api(): ContractsClient {
  if (!client) {
    client = createContractsClient({
      baseUrl: apiBaseUrl(),
      getAccessToken: () => accessToken,
    });
    client.use({
      onRequest({ request, id }) {
        // نسخة قبل الإرسال — الجسم يُستهلك بالإرسال، والإعادة تحتاج جسماً سليماً
        if (accessToken && resumer) pending.set(id, request.clone());
        return request;
      },
      async onResponse({ request, response, id }) {
        const original = pending.get(id);
        pending.delete(id);
        const path = new URL(request.url).pathname;
        if (
          response.status !== 401 ||
          !accessToken ||
          PUBLIC_PATHS.some((p) => path.startsWith(p))
        ) {
          return response;
        }
        const fresh = original && resumer ? await resumer() : null;
        if (fresh && original) {
          const headers = new Headers(original.headers);
          headers.set("Authorization", `Bearer ${fresh.access}`);
          const retried = await fetch(new Request(original, { headers }));
          if (retried.status !== 401) return retried;
        }
        onUnauthorized?.(path);
        return response;
      },
    });
  }
  return client;
}
