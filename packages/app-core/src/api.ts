/**
 * عميل الخادم المكتوب الأنواع (@sting/contracts) مع الاستئناف الصامت وتسليم 401 — مشترك بين الويب
 * والجوال (خطة الجوال M0). الاختلاف بين المنصّتين محقون لا مكتوب هنا: من أين يأتي رمز الوصول، وكيف
 * يُستأنف (Cookie في الويب §١٢١، رمز تجديد في المخزن الآمن على الجوال §١٦٢)، وماذا يحدث عند انتهاء الجلسة.
 *
 * عند 401 على مسار مُصادَق: يُستأنف مرة ويُعاد الطلب نفسه بالرمز الجديد؛ فشل الاستئناف وحده يستدعي
 * `onUnauthorized` (ACC-08). مسارات الدخول والتحقق لا تعني 401 فيها انتهاء جلسة.
 */
import { type ContractsClient, createContractsClient } from "@sting/contracts";

export const PUBLIC_PATHS: readonly string[] = [
  "/api/auth/",
  "/api/tenants/sectors",
  "/api/health",
];

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly getAccessToken: () => string | null;
  /** يستأنف الجلسة ويعيد رمز وصول جديداً، أو `null` إن تعذّر. */
  readonly resume?: (() => Promise<{ access: string } | null>) | undefined;
  readonly onUnauthorized?: ((path: string) => void) | undefined;
  /** للاختبار وللمنصّات التي تحقن fetch خاصاً. */
  readonly fetch?: typeof fetch | undefined;
}

export function createApiClient(opts: ApiClientOptions): ContractsClient {
  const doFetch = opts.fetch ?? ((req: Request) => fetch(req));
  const client = createContractsClient({
    baseUrl: opts.baseUrl,
    getAccessToken: opts.getAccessToken,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const pending = new Map<string, Request>();
  client.use({
    onRequest({ request, id }) {
      // نسخة قبل الإرسال — الجسم يُستهلك بالإرسال، والإعادة تحتاج جسماً سليماً
      if (opts.getAccessToken() && opts.resume) pending.set(id, request.clone());
      return request;
    },
    async onResponse({ request, response, id }) {
      const original = pending.get(id);
      pending.delete(id);
      const path = new URL(request.url).pathname;
      if (
        response.status !== 401 ||
        !opts.getAccessToken() ||
        PUBLIC_PATHS.some((p) => path.startsWith(p))
      ) {
        return response;
      }
      const fresh = original && opts.resume ? await opts.resume() : null;
      if (fresh && original) {
        const headers = new Headers(original.headers);
        headers.set("Authorization", `Bearer ${fresh.access}`);
        const retried = await doFetch(new Request(original, { headers }));
        if (retried.status !== 401) return retried;
      }
      opts.onUnauthorized?.(path);
      return response;
    },
  });
  return client;
}
