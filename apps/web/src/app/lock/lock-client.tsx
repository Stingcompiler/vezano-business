"use client";

import {
  attemptUnlock,
  type DeviceVerifiers,
  PIN_LOCK_POLICY,
  readPinLock,
  readVerifiers,
  storeVerifiers,
} from "@sting/sync-core";
import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import { useCountdown } from "@/features/acc/use-countdown";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { safeNext } from "@/lib/idle-lock";
import { adoptResumed } from "@/lib/session-restore";
import { loadContext, resumeSession } from "@/lib/session-store";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "validation_error" | "offline" | "permission_denied";

/**
 * ACC-07. الشاشة من `28-D21#ACC-07` (ready · validation_error)؛ `offline` و`permission_denied` من
 * `34-D26#ACC-07`. القفل محلي والتحقق محلي — لا جلسة خادمية جديدة؛ الفرق الوحيد بلا اتصال مؤشّرٌ
 * في الشريط. السحب المؤجَّل يُطبَّق عند أول اتصال (قائمة المتحققات كاملة كل مرة).
 *
 * مراجعة 0005 §١٢٠:
 * - مع جلسة حيّة (قفل الخمول): الفتح لصاحب الجلسة وحده ويعود إلى `?next=` — رمز مستخدم آخر لا يفتح
 *   جلسته (كان يضع اسمه على جلسة غيره)؛ التبديل بين المستخدمين يمر بتسليم الوردية.
 * - بلا جلسة (أُعيد تحميل الصفحة — الرموز في الذاكرة فقط §٩.٤): الرمز الصحيح يقود إلى الدخول بكلمة
 *   المرور مرة واحدة بدل الصفحة العامة التي كانت تعيد إلى القفل (حلقة).
 * - جهاز بلا متحققات منزَّلة: يُقال ذلك ويُعرض الدخول بكلمة المرور بدل لوحة معطَّلة بلا تفسير.
 */
export function LockClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [device, setDevice] = useState<DeviceVerifiers | null>(null);
  const [pin, setPin] = useState("");
  const [failed, setFailed] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [otherUser, setOtherUser] = useState("");
  // الرمز صحيح بلا جلسة وبلا اتصال: لا شيء يُفتح — يُقال ذلك بدل الانتقال إلى صفحة لا تُحمَّل
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const lock = useCountdown();
  // صاحب الجلسة الحيّة إن وُجدت — الفتح له وحده
  const sessionUserId = app.tokens ? app.session.userId : null;

  // المتحققات: المحلية أولاً (تعمل بلا شبكة)، ثم تحديث خادمي عند الاتصال بجلسة جهاز
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storage = getStorage();
      const local = await readVerifiers(storage);
      if (!cancelled && local) setDevice(local);
      if (!cancelled) setLoaded(true);
      const state = await readPinLock(storage);
      if (!cancelled && state.lockedUntil) {
        const left = Math.ceil((new Date(state.lockedUntil).getTime() - Date.now()) / 1000);
        if (left > 0) lock.startFrom(left);
      }
      if (!online || !app.device) return;
      try {
        const { data, response } = await api().GET("/api/devices/verifiers");
        if (cancelled || !response.ok || !data) return;
        const fresh: DeviceVerifiers = { ...data, fetched_at: new Date().toISOString() };
        await storeVerifiers(storage, fresh);
        setDevice(fresh);
      } catch {
        /* بلا اتصال فعلي: المحلي يكفي */
      }
    })();
    return () => {
      cancelled = true;
    };
    // lock ثابت المرجع؛ التحديث الخادمي عند تغيّر الاتصال أو جلسة الجهاز
  }, [online, app.device]);

  const pinLength = device?.pin_length ?? 6;
  // المستخدم المعروض: صاحب الجلسة الحيّة إن وُجد، وإلا الأول؛ المسحوب يبقى ظاهراً ليُعلَن له السحب
  const user =
    (sessionUserId ? device?.verifiers.find((v) => v.user_id === sessionUserId) : undefined) ??
    device?.verifiers[0] ??
    null;
  const next = () =>
    safeNext(
      typeof window === "undefined" ? null : new URLSearchParams(location.search).get("next"),
    );

  const submit = useCallback(
    async (candidate: string) => {
      if (busy || lock.remaining > 0) return;
      setBusy(true);
      try {
        const r = await attemptUnlock(getStorage(), candidate);
        if (r.kind === "unlocked") {
          if (app.tokens) {
            // جلسة حيّة: لا يفتحها رمز مستخدم آخر
            if (sessionUserId && r.user.user_id !== sessionUserId) {
              setPin("");
              setOtherUser(r.user.display_name);
              return;
            }
            router.replace(next());
            return;
          }
          // بلا جلسة في الذاكرة (أُعيد التحميل — 0005 §١٢١): السياق المحفوظ لهذا المستخدم يُستأنف من
          // الـCookie متصلاً، ويعمل محلياً بلا شبكة حتى يعود الاتصال
          const ctx = await loadContext();
          if (ctx && ctx.userId === r.user.user_id) {
            const resumed = navigator.onLine ? await resumeSession() : null;
            if (resumed && (await adoptResumed(app, resumed))) {
              router.replace(next());
              return;
            }
            if (!navigator.onLine) {
              app.setSession(ctx);
              app.markExpired(); // وضع محلي: الشاشات تعمل على البيانات المحلية بلا توجيه إلى الدخول
              router.replace(next());
              return;
            }
          }
          // لا سياق لهذا المستخدم أو رُفض الاستئناف: الدخول بكلمة المرور مرة واحدة
          app.setSession({ ...app.session, displayName: r.user.display_name });
          setPin("");
          if (!navigator.onLine) {
            setNeedsLogin(true);
            return;
          }
          router.replace(`/login?unlocked=1&next=${encodeURIComponent(next())}`);
          return;
        }
        setOtherUser("");
        setPin("");
        if (r.kind === "wrong") setFailed(r.failed);
        if (r.kind === "locked") {
          setFailed(PIN_LOCK_POLICY.maxAttempts);
          lock.startFrom(Math.ceil((new Date(r.until).getTime() - Date.now()) / 1000));
        }
        if (r.kind === "revoked" || r.kind === "no_verifiers") setRevoked(true);
      } finally {
        setBusy(false);
      }
    },
    [app, busy, lock, router],
  );

  const press = (d: string) => {
    if (busy || lock.remaining > 0) return;
    const next = (pin + d).slice(0, pinLength);
    setPin(next);
    if (next.length === pinLength) void submit(next);
  };

  const state: State = revoked
    ? "permission_denied"
    : failed > 0 || lock.remaining > 0
      ? "validation_error"
      : !online
        ? "offline"
        : "ready";

  return (
    <Frame
      title="فيزانو بلص"
      footer={null}
      notice={!online ? <Status state="offline" label="بلا اتصال" /> : undefined}
    >
      <div className="acc-page" data-screen="ACC-07" data-state={state}>
        <div className="acc-card">
          <div className="acc-card__body acc-pin">
            <div style={{ textAlign: "center" }}>
              <h2 className="acc-card__title" style={{ fontSize: 18 }}>
                {user?.display_name ?? ""}
              </h2>
              <p className="acc-lead">
                {user ? (
                  <>
                    {user.role_name} · {user.branch_name} · الجهاز{" "}
                    <span className="sting-mono">{device?.prefix}</span>
                  </>
                ) : null}
              </p>
            </div>

            {loaded && !device?.verifiers.length ? (
              <Notice kind="info" title="لا رمز PIN محفوظ على هذا الجهاز">
                <p className="acc-lead">
                  القفل يحتاج رمزاً نُزّل عند تجهيز الجهاز. ادخل بكلمة المرور ثم جهّز الجهاز.
                </p>
              </Notice>
            ) : null}
            {needsLogin ? (
              <Notice kind="offline" title="رمزك صحيح — لكن الجلسة انتهت">
                <p className="acc-lead">
                  أُعيد تحميل الصفحة فانتهت جلسة الخادم، وإعادة الدخول تحتاج اتصالاً. اتصل ثم ادخل
                  بكلمة المرور مرة واحدة.
                </p>
              </Notice>
            ) : null}
            {otherUser ? (
              <Notice kind="warning" title={`هذا رمز ${otherUser} — الجلسة المفتوحة لغيره`}>
                <p className="acc-lead">
                  الفتح لصاحب الجلسة وحده. التبديل بين المستخدمين يمر بتسليم الوردية.
                </p>
              </Notice>
            ) : null}
            {state === "permission_denied" ? (
              <Notice kind="error" title="الرمز صحيح — لكن وصولك إلى هذا الجهاز سُحب">
                <p className="acc-lead">
                  إن كان له عملٌ معلّق على هذا الجهاز فله تصديره أو طلب استرداده
                </p>
              </Notice>
            ) : (
              <>
                <div className="acc-pin__dots" aria-label="PIN" role="img">
                  {Array.from({ length: pinLength }, (_, i) => (
                    <span
                      key={i}
                      className={`acc-pin__dot${i < pin.length ? " acc-pin__dot--on" : ""}`}
                    />
                  ))}
                </div>

                {state === "validation_error" ? (
                  <Notice
                    kind="warning"
                    title={
                      lock.remaining > 0 ? (
                        <>
                          محاولة خاطئة —{" "}
                          <span className="sting-mono">{PIN_LOCK_POLICY.maxAttempts}</span> من{" "}
                          <span className="sting-mono">{PIN_LOCK_POLICY.maxAttempts}</span>
                        </>
                      ) : (
                        <>
                          محاولة خاطئة — <span className="sting-mono">{failed}</span> من{" "}
                          <span className="sting-mono">{PIN_LOCK_POLICY.maxAttempts}</span>
                        </>
                      )
                    }
                  >
                    <p className="acc-lead">
                      بعد الخامسة يُقفل الجهاز{" "}
                      <span className="sting-mono">{PIN_LOCK_POLICY.lockMinutes}</span> دقيقة. لا
                      يُحذف شيء ولا تُرسل عمليات، والمالك يستطيع فتحه من شاشة الأجهزة.
                    </p>
                    {lock.remaining > 0 ? (
                      <p className="acc-lead">
                        <span className="sting-mono acc-count">{lock.remaining}</span> ثانية
                      </p>
                    ) : null}
                  </Notice>
                ) : null}

                <div className="acc-keypad">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="sting-mono"
                      onClick={() => press(d)}
                      disabled={busy || lock.remaining > 0 || !user}
                    >
                      {d}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="حذف"
                    onClick={() => setPin((p) => p.slice(0, -1))}
                    disabled={busy || lock.remaining > 0 || !user}
                  >
                    ⌫
                  </button>
                  <button
                    type="button"
                    className="sting-mono"
                    onClick={() => press("0")}
                    disabled={busy || lock.remaining > 0 || !user}
                  >
                    0
                  </button>
                </div>

                <p className="acc-note" style={{ textAlign: "center", borderBlockStart: 0 }}>
                  هذا قفل محلي لا تسجيل دخول. يعمل بلا شبكة ولا يُنشئ جلسة خادمية جديدة.
                </p>
                <div className="acc-links" style={{ justifyContent: "center" }}>
                  <Button
                    variant="quiet"
                    onClick={() => router.push(`/login?next=${encodeURIComponent(next())}`)}
                  >
                    نسيت الرمز؟ ادخل بكلمة المرور
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
