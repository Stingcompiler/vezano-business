"use client";

import { Button, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "@/features/market/market.css";
import "./platform.css";
import { platformApi, setOperatorSession } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "ready" | "validation_error" | "permission_denied";

/** PLT-01 — دخول الإدارة ومساحة المشغّل (26-D19 ready/validation_error · 18-D13 permission_denied): حساب منفصل لا دور مزدوج. التحقّق الثنائي أُلغي بأمر المالك (0005 §١٠٨). */
export function OperatorLoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"" | "invalid_credentials" | "tenant_account">("");

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await platformApi().POST("/api/platform/login", {
        body: { email, password } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        | { access: string; display_name: string; role?: "admin" | "support" }
        | { detail?: string }
        | undefined;
      if (r.response.ok && b && "access" in b) {
        setOperatorSession(b.access, b.display_name, b.role ?? "admin");
        router.push("/platform/tenants");
        return;
      }
      const d = (b as { detail?: string } | undefined)?.detail ?? "invalid_credentials";
      setError(d === "tenant_account" ? d : "invalid_credentials");
    } finally {
      setBusy(false);
    }
  };

  const state: State =
    error === "tenant_account" ? "permission_denied" : error ? "validation_error" : "ready";

  return (
    <PlatformFrame current="login">
      <div className="sys plt-frame plt-login" data-screen="PLT-01" data-state={state}>
        <div className="plt-login__card">
          <div className="plt-login__brand">
            <span className="plt-login__mark" aria-hidden="true">
              ف
            </span>
            <div>
              <strong>إدارة فيزانو</strong>
              <span className="plt-badge">ADMIN</span>
            </div>
          </div>
          <h2 className="plt-login__title">
            دخول الإدارة ومساحة المشغّل — حساب منفصل لا دور مزدوج
          </h2>
          <p className="plt-login__hint">
            من يشغّل الخدمة يدخل بحساب مشغّل مستقل. حساب مالك متجر لا يترقّى إلى مساحة المشغّل مهما
            كانت صلاحياته داخل متجره.
          </p>

          {state === "permission_denied" ? (
            <Notice kind="warning" title="حساب مالك متجر حاول الدخول هنا">
              <p className="acc-lead">هذه المساحة ليست امتداداً لصلاحياتك في متجرك.</p>
              <p className="acc-choice__note">
                بيانات دخولك صحيحة كمالك متجر، لكن مساحة المشغّل حساب من نوع آخر تماماً. لا نمنحها
                لك ولا نُنشئها تلقائياً؛ من يحتاج وصول تشغيل يطلبه عبر مسار داخلي مدقَّق. أُعيد
                توجيهك إلى مساحة متجرك.
              </p>
              <div className="acc-actions">
                <Button pos onClick={() => router.push("/login")}>
                  مساحة متجرك
                </Button>
              </div>
            </Notice>
          ) : null}
          {state === "validation_error" ? (
            <Notice kind="warning" title="بيانات الدخول غير صحيحة">
              <p className="acc-lead">
                البريد أو كلمة المرور — لا نقول أيّهما، ولا إن كان الحساب موجوداً.
              </p>
            </Notice>
          ) : null}

          <form
            className="plt-login__form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            noValidate
          >
            <div className="plt-login__kicker">
              <span className="plt-badge">فصل حسابات</span>
              <strong>وحدة تشغيل فيزانو — دخول المشغّل</strong>
            </div>
            <TextField
              label="بريد المشغّل"
              mono
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <TextField
              label="كلمة المرور"
              kind="password"
              autoComplete="current-password"
              hint="كل جلسة مقيّدة بمدّة وتُسجَّل."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="acc-actions">
              <Button
                pos
                type="submit"
                loading={busy}
                disabledReason={
                  !email.trim() || !password ? "البريد وكلمة المرور مطلوبان" : undefined
                }
              >
                دخول مساحة المشغّل
              </Button>
            </div>
          </form>
        </div>
      </div>
    </PlatformFrame>
  );
}
