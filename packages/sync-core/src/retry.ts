/**
 * تراجع أُسّي مع jitter وحدّ أقصى للفاصل (§٨.٣): «دون إسقاط العملية بعد عدد محاولات».
 */

export interface RetryPolicy {
  readonly baseMs: number;
  readonly capMs: number;
  readonly factor: number;
}

export const DEFAULT_RETRY: RetryPolicy = { baseMs: 1_000, capMs: 5 * 60_000, factor: 2 };

/** الفاصل قبل المحاولة `attempt` (تبدأ من 1)؛ `random` في [0,1) قابلة للاستبدال في الاختبار. */
export function retryDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.capMs, policy.baseMs * policy.factor ** Math.max(0, attempt - 1));
  // jitter «كامل»: بين نصف القيمة وكاملها حتى لا تتزامن الأجهزة بعد انقطاع عام
  const half = exp / 2;
  return Math.round(half + random() * half);
}
