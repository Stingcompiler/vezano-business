/**
 * @sting/contracts — عميل API مكتوب الأنواع من OpenAPI (§٤.٤: مصدر الأنواع الوحيد).
 *
 * التوليد: `pnpm --filter @sting/contracts generate`
 *   1) drf-spectacular → openapi.json (OpenAPI 3.1)
 *   2) openapi-typescript → src/generated/schema.ts
 * فحص CI (contracts.test.ts) يفشل إن اختلف أيٌّ من المخرجين عن الخادم الحالي.
 *
 * العميل هنا للمسارات الخادمية (TanStack Query فوقـه في apps/*)؛ دفتر المبيعات المحلي
 * لا يمر من هنا (§٤.٥).
 */
import createClient from "openapi-fetch";

import type { paths } from "./generated/schema";

export type { components, operations, paths } from "./generated/schema";

export interface ContractsClientOptions {
  baseUrl: string;
  /** يُحقن رمز الوصول لكل طلب؛ إدارة التجديد في sync-core/التطبيق لا هنا. */
  getAccessToken?: () => string | null;
  fetch?: typeof fetch;
}

export function createContractsClient(options: ContractsClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch as (input: Request) => Promise<Response> } : {}),
  });
  client.use({
    onRequest({ request }) {
      const token = options.getAccessToken?.();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  });
  return client;
}

export type ContractsClient = ReturnType<typeof createContractsClient>;
