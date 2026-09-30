"use client";

import { Button, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "./platform.css";
import {
  markOperatorPasswordChanged,
  operatorMustChangePassword,
  operatorToken,
  platformApi,
} from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "ready" | "validation_error" | "success";

const ERRORS: Record<string, string> = {
  password_too_short: "كلمة المرور 10 أحرف على الأقل.",
  password_unchanged: "اختر كلمة غير المؤقتة.",
  invalid_current_password: "الكلمة الحالية غير صحيحة.",
  mismatch: "الكلمتان الجديدتان غير متطابقتين.",
};

/**
 * تغيير كلمة مرور المشغّل (0005 §١٣٨): من أنشأ حسابك أو أعاد تعيين كلمتك يعرفها، فتُغيَّر قبل أي
 * شاشة. الخادم يرفض كل قسم بـ`password_change_required` حتى تُغيَّر؛ الجلسة الحالية تبقى.
 */
export function OperatorPasswordClient() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const required = operatorMustChangePassword();

  useEffect(() => {
    if (!operatorToken()) router.replace("/platform/login");
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setError("mismatch");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await platformApi().POST("/api/platform/me/password", {
        body: { current, new: next } as never,
      });
      if (r.response.ok) {
        markOperatorPasswordChanged();
        setDone(true);
        return;
      }
      const d = (r.error as { detail?: string } | undefined)?.detail ?? "";
      setError(d in ERRORS ? d : "invalid_current_password");
    } finally {
      setBusy(false);
    }
  };

  const state: State = done ? "success" : error ? "validation_error" : "ready";

  return (
    <PlatformFrame current="password">
      <div className="sys plt-frame plt-login" data-screen="PLT-17" data-state={state}>
        <div className="plt-login__card">
          <h2 className="plt-login__title">
            {required ? "غيّر كلمة المرور المؤقتة قبل المتابعة" : "تغيير كلمة المرور"}
          </h2>
          <p className="plt-login__hint">
            من أنشأ حسابك أو أعاد تعيين كلمتك يعرفها؛ اختر كلمة لا يعرفها غيرك. جلستك الحالية تبقى.
          </p>
          {done ? (
            <Notice kind="success" title="تغيّرت كلمة المرور">
              <p className="acc-lead">الدخول القادم بالكلمة الجديدة.</p>
              <div className="acc-actions">
                <Button pos onClick={() => router.replace("/platform")}>
                  إلى النظرة العامة
                </Button>
              </div>
            </Notice>
          ) : (
            <form className="plt-login__form" onSubmit={(e) => void submit(e)} noValidate>
              {error ? (
                <Notice kind="warning" title="لم تتغيّر كلمة المرور">
                  <p className="acc-lead">{ERRORS[error]}</p>
                </Notice>
              ) : null}
              <TextField
                label="كلمة المرور الحالية"
                kind="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
              <TextField
                label="كلمة المرور الجديدة"
                kind="password"
                autoComplete="new-password"
                hint="10 أحرف على الأقل."
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <TextField
                label="تأكيد كلمة المرور الجديدة"
                kind="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <div className="acc-actions">
                <Button
                  pos
                  type="submit"
                  loading={busy}
                  disabledReason={
                    !current || !next || !confirm ? "الحقول الثلاثة مطلوبة" : undefined
                  }
                >
                  غيّر كلمة المرور
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </PlatformFrame>
  );
}
