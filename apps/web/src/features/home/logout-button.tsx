"use client";

import { Button } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { forgetSession } from "@/lib/session-store";
import { countPending } from "@/lib/sync";

/**
 * تسجيل الخروج (0005 §١٢٢ — بطلب المالك «أضف زر»؛ غير مرسوم في الإطار).
 *
 * خطوتان: الأولى تعرض ما سيبقى على الجهاز (عمل غير مرفوع يبقى ويُرفع عند الدخول التالي — لا يُحذف
 * شيء)، والثانية تنفّذ: تُلغى الجلسة على الخادم (ويُمسح Cookie الاستئناف)، ويُمسح سياقها المحلي،
 * وتُفرَّغ الرموز من الذاكرة، ثم الدخول بكلمة المرور. الجهاز يبقى مُجهَّزاً ومسجَّلاً.
 */
export function LogoutButton() {
  const app = useApp();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);

  if (!app.tokens && !app.expired) return null;

  const ask = async () => {
    setPending(await countPending().catch(() => 0));
    setConfirming(true);
  };

  const logout = async () => {
    setBusy(true);
    try {
      if (app.tokens) {
        // يلغي الجلسة ويمسح الـCookie؛ بلا شبكة يكفي المسح المحلي وتنتهي الجلسة بعمرها
        await api()
          .POST("/api/auth/logout")
          .catch(() => undefined);
      }
      await forgetSession();
      app.setSession({
        userId: null,
        tenantId: null,
        branchId: null,
        deviceId: null,
        displayName: null,
      });
      app.setDevice(null);
      app.setTokens(null);
      router.replace("/login");
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <Button variant="quiet" className="app-nav__logout" data-keep-nav onClick={() => void ask()}>
        تسجيل الخروج
      </Button>
    );
  }
  return (
    <div className="app-nav__logout-confirm" role="group" aria-label="تأكيد الخروج">
      <p>
        {pending > 0 ? (
          <>
            <span className="sting-mono">{pending}</span> عملية لم تُرفع بعد — تبقى على الجهاز
            وتُرفع عند الدخول التالي.
          </>
        ) : (
          "كل عملك مرفوع. الجهاز يبقى مُجهَّزاً."
        )}
      </p>
      <div className="app-nav__logout-actions">
        <Button variant="danger" loading={busy} onClick={() => void logout()}>
          اخرج
        </Button>
        <Button variant="quiet" data-keep-nav onClick={() => setConfirming(false)}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
