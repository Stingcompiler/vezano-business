"use client";

import { Button, Frame, Notice, Status, TextField } from "@sting/ui-web";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import "@/features/acc/acc.css";
import { PublicHeader } from "@/features/public/public-header";
import { AuthAside, AuthExtras, AuthSteps } from "@/features/acc/auth-aside";
import { CodeInput } from "@/features/acc/code-input";
import { api, apiBaseUrl } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { BrandMark } from "@/features/public/brand-mark";

type Step = "form" | "verify" | "password";

/**
 * تسجيل حساب جديد (0005 §٩٤): المعرّف → رمز تحقّق بغرض `register` (سياسة ACC-02 نفسها) → كلمة مرور
 * → تذكرة اختيار بلا عضويات → ACC-04 إنشاء المنشأة. لا حساب بلا تحقّق، ولا تخمين للمعرّف الموجود.
 */
export function RegisterClient() {
  const router = useRouter();
  const params = useSearchParams();
  const app = useApp();
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(6);
  const [ticket, setTicket] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  // بيئة التطوير فقط: لا مزوّد إرسال بعد (G-02) — حارس السيناريو يعيد آخر رمز؛ في الإنتاج 404 فلا يظهر شيء
  const [devCode, setDevCode] = useState<string | null>(null);

  const fetchDevCode = async (id: string) => {
    try {
      const r = await fetch(
        `${apiBaseUrl()}/api/scenario/verification-code?identifier=${encodeURIComponent(id)}`,
      );
      if (!r.ok) return setDevCode(null);
      const body = (await r.json()) as { code?: string };
      setDevCode(body.code ?? null);
    } catch {
      setDevCode(null);
    }
  };
  const next = params.get("next") ?? "/create-org";

  const requestCode = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setErr(null);
    if (!name.trim()) return setErr("name_required");
    if (!identifier.trim()) return setErr("identifier_required");
    setBusy(true);
    try {
      const { data, error, response } = await api().POST("/api/auth/verify/request", {
        body: { identifier: identifier.trim(), purpose: "register" },
      });
      if (response.status === 202 && data) {
        setCodeLength(data.policy.code_length);
        setStep("verify");
        void fetchDevCode(identifier.trim());
        return;
      }
      const detail = (error as { detail?: string } | undefined)?.detail ?? "";
      setErr(
        detail === "identifier_invalid"
          ? "identifier_invalid"
          : detail === "resend_too_soon"
            ? "resend_too_soon"
            : "send_failed",
      );
    } catch {
      setErr("offline");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const { data, error, response } = await api().POST("/api/auth/verify/confirm", {
        body: { identifier: identifier.trim(), purpose: "register", code },
      });
      if (response.ok && data) {
        setTicket(data.verified_ticket);
        setStep("password");
        return;
      }
      const body = error as { detail?: string; attempts_left?: number } | undefined;
      if (body?.detail === "code_invalid") setAttemptsLeft(body.attempts_left ?? null);
      setErr(body?.detail === "code_expired" ? "code_expired" : "code_invalid");
    } catch {
      setErr("offline");
    } finally {
      setBusy(false);
    }
  };

  const register = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (password.length < 8) return setErr("password_short");
    if (password !== password2) return setErr("password_mismatch");
    setBusy(true);
    try {
      const { data, error, response } = await api().POST("/api/auth/account/register", {
        body: { verified_ticket: ticket, password, display_name: name.trim() },
      });
      if (response.status === 201 && data) {
        app.setSelection({ ticket: data.select_ticket ?? "", memberships: data.memberships ?? [] });
        router.replace(next);
        return;
      }
      const detail = (error as { detail?: string } | undefined)?.detail ?? "";
      setErr(detail === "account_exists" ? "account_exists" : "ticket_invalid");
    } catch {
      setErr("offline");
    } finally {
      setBusy(false);
    }
  };

  const MESSAGES: Record<string, string> = {
    name_required: "اكتب اسمك — يظهر لفريقك في الأدوار والسجل.",
    identifier_required: "اكتب رقم هاتفك أو بريدك.",
    identifier_invalid: "المعرّف ليس رقم هاتف صالحاً ولا بريداً.",
    resend_too_soon: "طُلب رمز قبل قليل — انتظر ثم أعد المحاولة.",
    send_failed: "تعذّر إرسال الرمز الآن. أعد المحاولة بعد قليل.",
    offline: "لا اتصال — التسجيل يحتاج الشبكة مرة واحدة.",
    code_invalid: "الرمز غير صحيح.",
    code_expired: "انتهى الرمز — اطلب رمزاً جديداً.",
    password_short: "كلمة المرور ثمانية أحرف على الأقل.",
    password_mismatch: "كلمتا المرور غير متطابقتين.",
    account_exists: "هذا المعرّف مسجَّل من قبل — ادخل بكلمة مرورك أو استعدها.",
    ticket_invalid: "انتهت صلاحية التحقق — ابدأ من جديد.",
  };

  return (
    <Frame title="فيزانو" footer={null} back={false} chrome={<PublicHeader cta="login" />}>
      <div
        className="acc-page acc-page--split"
        data-screen="ACC-02"
        data-state={busy ? "saving" : err ? "validation_error" : "ready"}
      >
        <AuthAside hint="حساب واحد يدير المنشأة ويشتري من السوق — التجربة 30 يوماً بلا بطاقة." />
        <AuthSteps current={step === "form" ? 1 : step === "verify" ? 2 : 3} />
        {step === "form" ? (
          <form className="acc-card" onSubmit={(e) => void requestCode(e)} noValidate>
            <div className="acc-card__head">
              <span className="acc-logo" aria-hidden="true">
                <BrandMark />
              </span>
              <h1 className="acc-card__title">حساب جديد في فيزانو</h1>
            </div>
            <div className="acc-card__body">
              <p className="acc-lead">
                حساب إدارة المتجر: بعده تُنشئ منشأتك وفرعها الأول وتبدأ التجربة. زبون المحل لا يحتاج
                حساباً هنا.
              </p>
              {err ? (
                <Notice kind="error" title={MESSAGES[err] ?? err}>
                  {err === "account_exists" ? (
                    <div className="acc-links">
                      <Link href="/login" className="c-btn c-btn--quiet">
                        لي حساب — دخول
                      </Link>
                    </div>
                  ) : null}
                </Notice>
              ) : null}
              <TextField
                label="اسمك"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                readOnly={busy}
                required
              />
              <TextField
                label="رقم الهاتف أو البريد"
                kind="tel"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                readOnly={busy}
                required
              />
              <div className="acc-actions">
                <Button type="submit" pos loading={busy}>
                  أرسل رمز التحقق
                </Button>
                <Link href="/login" className="c-btn c-btn--quiet">
                  لي حساب — دخول
                </Link>
              </div>
            </div>
          </form>
        ) : null}

        {step === "verify" ? (
          <form className="acc-card" onSubmit={(e) => void confirm(e)} noValidate>
            <div className="acc-card__head acc-card__head--tone">
              <div className="acc-card__sub">{busy ? "جارٍ التحقق" : "تحقق الحساب"}</div>
              <h1 className="acc-card__title">أدخل رمز التحقق</h1>
            </div>
            <div className="acc-card__body">
              <p className="acc-lead">
                أرسلنا رمزاً إلى <span className="sting-mono">{identifier.trim()}</span>. أدخله
                لتأكيد أن المعرّف لك.
              </p>
              {err ? <Notice kind="error" title={MESSAGES[err] ?? err} /> : null}
              {devCode ? (
                <Notice
                  kind="info"
                  title="بيئة تطوير — لا مزوّد إرسال بعد"
                  action={<Button onClick={() => setCode(devCode)}>املأ الرمز</Button>}
                >
                  <p className="acc-lead">
                    الرمز الذي كان سيصلك: <span className="sting-mono">{devCode}</span>
                  </p>
                </Notice>
              ) : null}
              <CodeInput
                label="رمز التحقق"
                length={codeLength}
                value={code}
                onChange={setCode}
                locked={busy}
              />
              {attemptsLeft !== null && err === "code_invalid" ? (
                <Status
                  state="validation_error"
                  label={
                    <>
                      خطأ تحقق — <span className="sting-mono">{attemptsLeft}</span>
                    </>
                  }
                />
              ) : null}
              <div className="acc-actions">
                <Button
                  type="submit"
                  loading={busy}
                  disabledReason={code.length < codeLength ? "أكمل الرمز" : undefined}
                >
                  تأكيد الرمز
                </Button>
                <Button variant="secondary" onClick={() => void requestCode()} loading={busy}>
                  إرسال رمز جديد
                </Button>
                <Button variant="quiet" onClick={() => setStep("form")}>
                  غيّر المعرّف
                </Button>
              </div>
            </div>
          </form>
        ) : null}

        {step === "password" ? (
          <form className="acc-card" onSubmit={(e) => void register(e)} noValidate>
            <div className="acc-card__head">
              <span className="acc-logo" aria-hidden="true">
                <BrandMark />
              </span>
              <h1 className="acc-card__title">اختر كلمة مرور</h1>
            </div>
            <div className="acc-card__body">
              <p className="acc-lead">
                تحقّق المعرّف <span className="sting-mono">{identifier.trim()}</span>. كلمة المرور
                ثمانية أحرف على الأقل — تدخل بها على أي جهاز.
              </p>
              {err ? <Notice kind="error" title={MESSAGES[err] ?? err} /> : null}
              <TextField
                label="كلمة المرور"
                kind="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                readOnly={busy}
                required
              />
              <TextField
                label="تأكيد كلمة المرور"
                kind="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                readOnly={busy}
                required
              />
              <div className="acc-actions">
                <Button type="submit" pos loading={busy}>
                  أنشئ الحساب وتابع إلى المنشأة
                </Button>
              </div>
            </div>
          </form>
        ) : null}
        <AuthExtras />
      </div>
    </Frame>
  );
}
