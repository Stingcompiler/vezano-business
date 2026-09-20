"use client";

import { Button, Frame, Notice, Status, TextField } from "@sting/ui-web";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import { CodeInput } from "@/features/acc/code-input";
import { useCountdown } from "@/features/acc/use-countdown";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { hasLocalSetup } from "@/lib/device-setup";
import { useOnline } from "@/lib/online";

type Step = "login" | "verify" | "manual";
type State =
  "ready" | "loading" | "validation_error" | "offline" | "expired" | "server_error" | "success";
type Purpose = "register" | "recover";

interface VerifyPolicy {
  readonly code_length: number;
  readonly code_ttl_seconds: number;
  readonly resend_after_seconds: number;
  readonly max_resends: number;
}
const DEFAULT_POLICY: VerifyPolicy = {
  code_length: 6,
  code_ttl_seconds: 600,
  resend_after_seconds: 60,
  max_resends: 2,
};

/** بعد الإرسال «نعرض «لم يصل؟» بعد ١٥ ثانية» (34-D26 loading). */
const NOT_ARRIVED_AFTER_MS = 15_000;

/**
 * ACC-02. خطوة الدخول من `06-D2#ACC-02` (W/1440/ready)، خطوة رمز التحقق وبديله اليدوي من
 * `13-D8#G-02` (M/390/ready · server_error)، وبقية الحالات من `34-D26#ACC-02`.
 * «دخلتَ» بلا شاشة تهنئة: الانتقال فوري إلى اختيار المنشأة (ACC-03) أو الرئيسية.
 */
export function LoginClient() {
  const router = useRouter();
  const params = useSearchParams();
  const app = useApp();
  const online = useOnline();

  const [step, setStep] = useState<Step>(params.get("step") === "verify" ? "verify" : "login");
  const [purpose, setPurpose] = useState<Purpose>("recover");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [notArrived, setNotArrived] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [codeInvalidLeft, setCodeInvalidLeft] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const [sendFailures, setSendFailures] = useState(0);
  const [manualSuggested, setManualSuggested] = useState(false);
  const [manualRequestId, setManualRequestId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<VerifyPolicy>(DEFAULT_POLICY);
  const [resendsLeft, setResendsLeft] = useState(DEFAULT_POLICY.max_resends);
  const [localSetup, setLocalSetup] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const lock = useCountdown();
  const resend = useCountdown();

  useEffect(() => {
    void hasLocalSetup().then(setLocalSetup);
  }, []);

  // «لم يصل؟» بعد ١٥ ثانية من الإرسال — لا زر إلغاء: الرمز خرج
  useEffect(() => {
    if (busySince === null) {
      setNotArrived(false);
      return;
    }
    const t = window.setTimeout(() => setNotArrived(true), NOT_ARRIVED_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [busySince]);

  const start = () => {
    setBusy(true);
    setBusySince(Date.now());
  };
  const stop = () => {
    setBusy(false);
    setBusySince(null);
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || lock.remaining > 0) return;
    setInvalid(false);
    start();
    try {
      const { data, error, response } = await api().POST("/api/auth/account/login", {
        body: { identifier, password },
      });
      if (response.status === 429) {
        lock.startFrom(error?.retry_after_seconds ?? 0);
        setInvalid(true);
        return;
      }
      if (!response.ok || !data) {
        setInvalid(true);
        return;
      }
      setSucceeded(true);
      if (data.access && data.refresh && data.session_id) {
        app.setTokens({ access: data.access, refresh: data.refresh, sessionId: data.session_id });
        app.setSession({
          ...app.session,
          userId: data.user_id ?? null,
          tenantId: data.tenant_id ?? null,
        });
        router.replace(params.get("next") ?? "/");
      } else {
        app.setSelection({ ticket: data.select_ticket ?? "", memberships: data.memberships ?? [] });
        const next = params.get("next");
        // الوجهة تُحمل عبر اختيار المنشأة (ACC-03) ولا تُفقد — الدعوة تُفتح مباشرة
        router.replace(
          next?.startsWith("/invite/")
            ? next
            : next
              ? `/select-org?next=${encodeURIComponent(next)}`
              : "/select-org",
        );
      }
    } catch {
      setInvalid(true);
    } finally {
      stop();
    }
  };

  const requestCode = useCallback(
    async (p: Purpose) => {
      if (busy) return;
      setPurpose(p);
      setExpired(false);
      setCodeInvalidLeft(null);
      start();
      try {
        const { data, error, response } = await api().POST("/api/auth/verify/request", {
          body: { identifier, purpose: p },
        });
        if (response.status === 202 && data) {
          setPolicy(data.policy);
          setResendsLeft(data.resends_left);
          resend.startFrom(data.resend_after_seconds);
          setSendFailures(0);
          setStep("verify");
          return;
        }
        const err: {
          detail?: string;
          send_failures?: number;
          manual_suggested?: boolean;
          retry_after_seconds?: number;
          policy?: VerifyPolicy;
        } = error ?? {};
        if (err.policy) setPolicy(err.policy);
        if (err.detail === "send_failed") {
          setSendFailures(err.send_failures ?? 1);
          if (err.manual_suggested) setManualSuggested(true);
          setStep(err.manual_suggested ? "manual" : step);
        } else if (err.detail === "resend_limit") {
          setManualSuggested(true);
          setResendsLeft(0);
          setStep("manual");
        } else if (err.detail === "resend_too_soon") {
          resend.startFrom(err.retry_after_seconds ?? 0);
        } else {
          setInvalid(true);
        }
      } catch {
        setSendFailures((n) => n + 1);
      } finally {
        stop();
      }
    },
    [busy, identifier, resend, step],
  );

  const confirmCode = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || code.length < policy.code_length) return;
    start();
    try {
      const { data, error, response } = await api().POST("/api/auth/verify/confirm", {
        body: { identifier, purpose, code },
      });
      if (response.status === 410) {
        setExpired(true);
        return;
      }
      if (response.status === 400) {
        setCodeInvalidLeft(error?.attempts_left ?? 0);
        return;
      }
      if (data?.verified_ticket) {
        // تأكيد الرمز صحيح — الخطوة التالية (كلمة مرور جديدة/إكمال التسجيل) غير مرسومة بعد (0005 §٣)
        setSucceeded(true);
        router.replace("/welcome");
      }
    } catch {
      setSendFailures((n) => n + 1);
    } finally {
      stop();
    }
  };

  const openManual = async () => {
    if (busy) return;
    start();
    try {
      const { data } = await api().POST("/api/auth/verify/manual", {
        body: { identifier, purpose, tenant_name: "" },
      });
      if (data?.request_id) setManualRequestId(data.request_id);
    } finally {
      stop();
    }
  };

  const state: State = succeeded
    ? "success"
    : !online
      ? "offline"
      : step === "manual"
        ? "server_error"
        : busy
          ? "loading"
          : expired
            ? "expired"
            : invalid || codeInvalidLeft !== null
              ? "validation_error"
              : "ready";

  const ttlMinutes = Math.round(policy.code_ttl_seconds / 60);

  return (
    <Frame title="فيزانو" footer={null}>
      <div className="acc-page" data-screen="ACC-02" data-state={state} data-step={step}>
        {state === "offline" ? (
          <div className="acc-card">
            <div className="acc-card__body">
              <Notice kind="offline" title="بلا اتصال">
                <p className="acc-lead">الدخول الأول يحتاج الخادم.</p>
                {localSetup ? (
                  <div className="acc-links">
                    <Button onClick={() => router.push("/lock")}>ادخل بـPIN المحلي</Button>
                  </div>
                ) : null}
              </Notice>
            </div>
          </div>
        ) : null}

        {state !== "offline" && step === "login" ? (
          <form className="acc-card" onSubmit={(e) => void submitLogin(e)} noValidate>
            <div className="acc-card__head">
              <span className="acc-logo" aria-hidden="true">
                ف
              </span>
              <h2 className="acc-card__title">الدخول إلى فيزانو</h2>
            </div>
            <div className="acc-card__body">
              {invalid ? (
                <Notice kind="error" title="بيانات الدخول غير صحيحة">
                  {lock.remaining > 0 ? (
                    <p className="acc-lead">
                      <span className="sting-mono acc-count">{lock.remaining}</span> ثانية
                    </p>
                  ) : null}
                  <div className="acc-links">
                    <Button variant="quiet" onClick={() => void requestCode("recover")}>
                      نسيت كلمة المرور؟
                    </Button>
                    <Link href="/welcome" className="c-btn c-btn--quiet">
                      ليس لديك حساب؟
                    </Link>
                  </div>
                </Notice>
              ) : null}
              <TextField
                label="رقم الهاتف أو البريد"
                kind="tel"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                readOnly={busy}
                required
              />
              <TextField
                label="كلمة المرور"
                kind="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                readOnly={busy}
                required
              />
              <div className="acc-actions">
                <Button
                  type="submit"
                  financial
                  loading={busy}
                  disabledReason={
                    lock.remaining > 0 ? `${String(lock.remaining)} ثانية` : undefined
                  }
                >
                  دخول
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void requestCode("recover")}
                  disabledReason={
                    busy ? undefined : identifier ? undefined : "رقم الهاتف أو البريد"
                  }
                >
                  نسيت كلمة المرور
                </Button>
              </div>
              {sendFailures > 0 && !manualSuggested ? (
                <Status state="server_error" label="تعذّر إرسال الرمز" />
              ) : null}
              <p className="acc-note">
                حساب إدارة المتجر. زبون المحل يدخل من رابط المحل ولا يحتاج حساباً هنا.
              </p>
            </div>
          </form>
        ) : null}

        {state !== "offline" && step === "verify" ? (
          <form className="acc-card" onSubmit={(e) => void confirmCode(e)} noValidate>
            <div
              className="acc-card__head acc-card__head--tone"
              style={
                expired
                  ? ({
                      "--acc-head-bg": "var(--color-state-expired-bg)",
                      "--acc-head-border": "var(--color-state-expired-border)",
                      "--acc-head-fg": "var(--color-state-expired-fg)",
                      "--acc-title-fg": "var(--color-state-expired-fg)",
                    } as React.CSSProperties)
                  : undefined
              }
            >
              <div className="acc-card__sub">{busy ? "جارٍ التحقق" : "تحقق الحساب"}</div>
              <h2 className="acc-card__title">
                {expired ? "انتهى رمز التحقق" : "أدخل رمز التحقق"}
              </h2>
            </div>
            <div className="acc-card__body">
              <p className="acc-lead">
                {expired ? (
                  <>اطلب رمزاً جديداً — الرمز القديم لم يعد صالحاً حتى لو وصلك الآن.</>
                ) : (
                  <>
                    أرسلنا رمزاً من ست خانات إلى وسيلة الاتصال المسجَّلة لهذا الحساب. صالح{" "}
                    <span className="sting-mono">{ttlMinutes}</span> دقائق.
                  </>
                )}
              </p>
              <CodeInput
                label="رمز التحقق"
                length={policy.code_length}
                value={code}
                onChange={setCode}
                locked={busy || expired}
              />
              {codeInvalidLeft !== null ? (
                <Status
                  state="validation_error"
                  label={
                    <>
                      خطأ تحقق — <span className="sting-mono">{codeInvalidLeft}</span>
                    </>
                  }
                />
              ) : null}
              {!expired ? (
                <div className="acc-item">
                  <div className="acc-item__label">{notArrived ? "لم يصل؟" : "لم يصلك الرمز؟"}</div>
                  <div className="acc-item__note">
                    إعادة الإرسال متاحة بعد{" "}
                    <span className="sting-mono">{policy.resend_after_seconds}</span> ثانية، ومرتين
                    كحد أقصى قبل أن نقترح التحقق اليدوي.
                  </div>
                </div>
              ) : null}
              <div className="acc-actions">
                {expired ? (
                  <Button
                    financial
                    loading={busy}
                    onClick={() => void requestCode(purpose)}
                    disabledReason={
                      resend.remaining > 0 ? `${String(resend.remaining)} ثانية` : undefined
                    }
                  >
                    إرسال رمز جديد
                  </Button>
                ) : (
                  <Button type="submit" loading={busy}>
                    تأكيد الرمز
                  </Button>
                )}
                {!expired ? (
                  <Button
                    variant="secondary"
                    onClick={() => void requestCode(purpose)}
                    disabledReason={
                      busy
                        ? undefined
                        : resendsLeft === 0
                          ? "ومرتين كحد أقصى"
                          : resend.remaining > 0
                            ? "متاحة بعد"
                            : undefined
                    }
                  >
                    {resend.remaining > 0 ? (
                      <>
                        إعادة الإرسال — <span className="sting-mono">{resend.remaining}</span> ثانية
                      </>
                    ) : (
                      "إعادة الإرسال"
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          </form>
        ) : null}

        {state !== "offline" && step === "manual" ? (
          <div className="acc-card">
            <div
              className="acc-card__head acc-card__head--tone"
              style={
                {
                  "--acc-head-bg": "var(--color-state-validation_error-bg)",
                  "--acc-head-border": "var(--color-state-validation_error-border)",
                  "--acc-head-fg": "var(--color-state-validation_error-fg)",
                  "--acc-title-fg": "var(--color-state-validation_error-fg)",
                } as React.CSSProperties
              }
            >
              <div className="acc-card__sub">تعذّر إرسال الرمز</div>
              <h2 className="acc-card__title">بديل يعمل الآن</h2>
            </div>
            <div className="acc-card__body">
              <p className="acc-lead">
                فشل إرسال الرمز ثلاث مرات. لن نتركك في حلقة إعادة محاولة: التحقق اليدوي بالدعم مسار
                مكتمل لا استثناء طارئ.
              </p>
              <div
                className="acc-item"
                style={
                  {
                    "--acc-item-border": "var(--color-brand-line)",
                    "--acc-item-bg": "var(--color-brand-tint)",
                    "--acc-item-fg": "var(--color-brand-strong)",
                  } as React.CSSProperties
                }
              >
                <div className="acc-item__label">ما يطلبه التحقق اليدوي</div>
                <div className="acc-item__note">
                  اسم المنشأة ومستند هويتها ومكالمة أو رسالة من الدعم. مدة الإنجاز معلنة: يوم عمل
                  واحد.
                </div>
              </div>
              <div
                className="acc-item"
                style={
                  {
                    "--acc-item-border": "var(--color-state-validation_error-border)",
                    "--acc-item-bg": "var(--color-state-validation_error-bg)",
                    "--acc-item-fg": "var(--color-state-validation_error-fg)",
                  } as React.CSSProperties
                }
              >
                <div className="acc-item__label">ما لن نفعله</div>
                <div className="acc-item__note">
                  لا نفتح الحساب بلا تحقق ولا نقبل صورة شاشة كدليل. الحساب يحمل دفتراً مالياً.
                </div>
              </div>
              {manualRequestId ? (
                <Status state="saved_local" label="مدة الإنجاز معلنة: يوم عمل واحد." />
              ) : null}
              <div className="acc-actions">
                <Button
                  onClick={() => void openManual()}
                  loading={busy}
                  disabledReason={manualRequestId ? "ما يطلبه التحقق اليدوي" : undefined}
                >
                  فتح طلب تحقق يدوي
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep("login");
                    setIdentifier("");
                    setSendFailures(0);
                    setManualSuggested(false);
                  }}
                >
                  محاولة أخرى بوسيلة مختلفة
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Frame>
  );
}
