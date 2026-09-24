"use client";

/**
 * بقاء الجلسة بعد إعادة التحميل (0005 §١٢١).
 *
 * - **السرّ لا يُخزَّن هنا** (§٩.٤): رمز التجديد في Cookie `HttpOnly` يضعه الخادم (`/api/auth/remember`)
 *   ولا تقرؤه الشيفرة؛ الاستئناف (`/api/auth/resume`) يدوّره ويعيد رموزاً جديدة.
 * - **السياق غير السرّي** وحده في التخزين المحلي: المنشأة، المستخدم، الفرع، الجهاز، الاسم — كي يعرف
 *   الجهاز لمن يفتح القفل ويعمل على بياناته المحلية بلا شبكة.
 * - إعادة التحميل على جهاز مُجهَّز تمرّ بقفل الـPIN أولاً؛ جهاز بلا PIN (حاسوب المالك مثلاً) يُستأنف
 *   مباشرة إن كان الـCookie صالحاً.
 */
import { apiBaseUrl } from "@/lib/api";
import { getStorage } from "@/lib/storage";

/** شكل `AppSession` (app-context) — مكرَّر هنا عمداً كي لا تنشأ حلقة استيراد. */
export interface StoredSession {
  readonly userId: string | null;
  readonly tenantId: string | null;
  readonly branchId: string | null;
  readonly deviceId: string | null;
  readonly displayName: string | null;
}
type AppSession = StoredSession;

export const SESSION_CONTEXT_KEY = "session.context";

export interface Resumed {
  readonly access: string;
  readonly refresh: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly tenant_id: string | null;
}

export async function saveContext(s: AppSession): Promise<void> {
  if (!s.tenantId || !s.userId) return;
  try {
    await getStorage().transaction((tx) => tx.putMeta(SESSION_CONTEXT_KEY, JSON.stringify(s)));
  } catch {
    /* التخزين المحلي غير متاح (تصفّح خاص) — الجلسة تبقى في الذاكرة كما كانت */
  }
}

export async function loadContext(): Promise<AppSession | null> {
  try {
    const raw = await getStorage().read((tx) => tx.getMeta(SESSION_CONTEXT_KEY));
    if (!raw) return null;
    const v = JSON.parse(raw) as AppSession;
    return v.tenantId && v.userId ? v : null;
  } catch {
    return null;
  }
}

export async function clearContext(): Promise<void> {
  try {
    await getStorage().transaction((tx) => tx.putMeta(SESSION_CONTEXT_KEY, ""));
  } catch {
    /* لا شيء محفوظ */
  }
}

const post = (path: string, body?: unknown) =>
  fetch(
    `${apiBaseUrl()}${path}`,
    body === undefined
      ? { method: "POST", credentials: "same-origin" }
      : {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );

/** يسلّم رمز التجديد للخادم ليحفظه في Cookie `HttpOnly` — فشله لا يوقف شيئاً (يبقى سلوك الذاكرة). */
export async function rememberRefresh(refresh: string): Promise<void> {
  try {
    await post("/api/auth/remember", { refresh });
  } catch {
    /* بلا شبكة: يُعاد الحفظ مع أول رموز تالية */
  }
}

let inflight: Promise<Resumed | null> | null = null;

/** استئناف من الـCookie — طلب واحد متزامن مهما تعدّد الطالبون (التدوير يحظر القديم). */
export function resumeSession(): Promise<Resumed | null> {
  inflight ??= (async () => {
    try {
      const r = await post("/api/auth/resume");
      if (!r.ok) return null;
      return (await r.json()) as Resumed;
    } catch {
      return null;
    } finally {
      setTimeout(() => {
        inflight = null;
      }, 0);
    }
  })();
  return inflight;
}

export async function forgetSession(): Promise<void> {
  await clearContext();
  try {
    await post("/api/auth/forget");
  } catch {
    /* يُمسح الـCookie بانتهاء عمره أو مع أول خروج متصل */
  }
}
