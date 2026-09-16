"use client";

import {
  attemptUnlock,
  type DeviceVerifiers,
  PIN_LOCK_POLICY,
  readPinLock,
  readVerifiers,
  storeVerifiers,
} from "@sting/sync-core";
import { Frame, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import { useCountdown } from "@/features/acc/use-countdown";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "validation_error" | "offline" | "permission_denied";

/**
 * ACC-07. الشاشة من `28-D21#ACC-07` (ready · validation_error)؛ `offline` و`permission_denied` من
 * `34-D26#ACC-07`. القفل محلي والتحقق محلي — لا جلسة خادمية جديدة؛ الفرق الوحيد بلا اتصال مؤشّرٌ
 * في الشريط. السحب المؤجَّل يُطبَّق عند أول اتصال (قائمة المتحققات كاملة كل مرة).
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
  const lock = useCountdown();

  // المتحققات: المحلية أولاً (تعمل بلا شبكة)، ثم تحديث خادمي عند الاتصال بجلسة جهاز
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storage = getStorage();
      const local = await readVerifiers(storage);
      if (!cancelled && local) setDevice(local);
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
  // المستخدم المعروض: آخر من فتح (أو الأول)؛ المسحوب يبقى ظاهراً ليُعلَن له السحب لا الخطأ
  const user = device?.verifiers[0] ?? null;

  const submit = useCallback(
    async (candidate: string) => {
      if (busy || lock.remaining > 0) return;
      setBusy(true);
      try {
        const r = await attemptUnlock(getStorage(), candidate);
        if (r.kind === "unlocked") {
          app.setSession({
            ...app.session,
            userId: r.user.user_id,
            displayName: r.user.display_name,
          });
          router.replace("/");
          return;
        }
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
      title="Sting"
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
                      يُحذف شيء ولا تُرسل عمليات، والمالك يستطيع فتحه من ORG-04.
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
              </>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
