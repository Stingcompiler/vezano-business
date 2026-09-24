"use client";

/**
 * استعادة الجلسة بعد إعادة التحميل (0005 §١٢١).
 *
 * - يسجّل «المستأنِف» لعميل الخادم: 401 أثناء العمل (انتهاء رمز الوصول بعد 15 دقيقة) يُستأنف
 *   صامتاً من الـCookie بدل السقوط إلى ACC-08.
 * - عند بدء التطبيق بلا جلسة وله سياق محفوظ:
 *   - جهاز مُجهَّز بـPIN → القفل (`/lock?next=الشاشة`) — الرمز يفتح، ثم يُستأنف أو يُعمل محلياً.
 *   - بلا PIN (حاسوب المالك) → استئناف مباشر إن كان الـCookie صالحاً.
 * - وضع محلي بلا شبكة (`expired` مع سياق): عند عودة الاتصال يُستأنف تلقائياً.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { setResumer } from "@/lib/api";
import { type AppContextValue, useApp } from "@/lib/app-context";
import { hasLocalSetup } from "@/lib/device-setup";
import { isExempt } from "@/lib/idle-lock";
import { loadContext, type Resumed, resumeSession } from "@/lib/session-store";

/** يطبّق رموزاً مستأنَفة على السياق — مع السياق المحفوظ إن طابق المستخدم. */
export async function adoptResumed(app: AppContextValue, r: Resumed): Promise<boolean> {
  const ctx = await loadContext();
  if (!ctx || ctx.userId !== r.user_id || !r.tenant_id || ctx.tenantId !== r.tenant_id) {
    return false;
  }
  app.setTokens({ access: r.access, refresh: r.refresh, sessionId: r.session_id });
  app.setSession(ctx);
  return true;
}

export function SessionRestore() {
  const app = useApp();
  const router = useRouter();
  const appRef = useRef(app);
  appRef.current = app;
  const started = useRef(false);

  // المستأنِف لعميل الخادم: يحدّث الرموز في السياق أيضاً
  useEffect(() => {
    setResumer(async () => {
      const r = await resumeSession();
      if (!r) return null;
      const a = appRef.current;
      a.setTokens({ access: r.access, refresh: r.refresh, sessionId: r.session_id });
      return { access: r.access };
    });
    return () => setResumer(null);
  }, []);

  // بدء التطبيق: مرة واحدة
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const a = appRef.current;
    if (a.tokens) return;
    void (async () => {
      const ctx = await loadContext();
      if (!ctx) return;
      const here = `${location.pathname}${location.search}`;
      if (await hasLocalSetup()) {
        // الجهاز المُجهَّز لا يُفتح بلا رمز — القفل يستأنف بعد الفتح
        if (!isExempt(location.pathname) || location.pathname === "/") {
          router.replace(`/lock?next=${encodeURIComponent(here)}`);
        }
        return;
      }
      const r = await resumeSession();
      if (r) await adoptResumed(appRef.current, r);
    })();
  }, [router]);

  // الوضع المحلي: عودة الاتصال تستأنف
  useEffect(() => {
    const onOnline = () => {
      const a = appRef.current;
      if (a.tokens || !a.expired || !a.session.tenantId) return;
      void resumeSession().then((r) => (r ? adoptResumed(appRef.current, r) : false));
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  return null;
}
