"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/sys/sys.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import {
  currentPushSubscription,
  onPwaChange,
  type PushPermission,
  pushPermission,
  requestPushPermission,
  subscribePush,
  unsubscribePush,
} from "@/lib/pwa";

type State = "ready" | "permission_denied" | "expired" | "success";

interface PushStatus {
  configured: boolean;
  public_key: string;
  subscribed: boolean;
  created_at: string;
  last_used_at: string;
  expired: boolean;
}

type TestResult = "sent" | "push_not_configured" | "not_subscribed" | "expired" | "failed";

/**
 * WEB-02 — إذن Web Push وحالاته (09-D5 permission_denied · 37-D29 ready/expired/success): نشرح قبل
 * حوار المتصفح لأن رفضه دائمٌ تقريباً؛ الرفض لا يمنع شيئاً (البوابة والصندوق يعملان)؛ الاشتراك
 * المنتهي يُجدَّد صامتاً إن كان الإذن قائماً؛ بعد التفعيل نُرسل إشعاراً تجريبياً فوراً — الادّعاء لا
 * يُثبت. نقطة النهاية سرّ تشغيلي: لا تُعرض ولا يعيدها الخادم (§١١.٦، §١١.٨؛ ACC-107، 113).
 */
export function NotifyClient() {
  const router = useRouter();
  const app = useApp();
  const [perm, setPerm] = useState<PushPermission>("default");
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [renewFailed, setRenewFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async (): Promise<PushStatus | null> => {
    try {
      const { data, response } = await api().GET("/api/push/status", {});
      const body = response.ok ? (data as unknown as PushStatus) : null;
      setStatus(body);
      return body;
    } catch {
      setStatus(null);
      return null;
    }
  }, []);

  const sendTest = useCallback(async () => {
    try {
      const { data, response } = await api().POST("/api/push/test", {});
      const body = data as unknown as { sent: boolean; reason?: string } | undefined;
      if (!response.ok || !body) setTest("failed");
      else if (body.sent) setTest("sent");
      else setTest((body.reason as TestResult | undefined) ?? "failed");
    } catch {
      setTest("failed");
    }
    await load();
  }, [load]);

  /** الاشتراك (أو التجديد الصامت) بمفتاح الخادم ثم تسجيله — ثم إشعار تجريبي فوراً. */
  const subscribe = useCallback(
    async (st: PushStatus | null): Promise<boolean> => {
      if (!st?.configured || !st.public_key) return false;
      const keys = await subscribePush(st.public_key);
      if (!keys) return false;
      try {
        const { response } = await api().POST("/api/push/subscribe", { body: keys });
        if (!response.ok) return false;
      } catch {
        return false;
      }
      await sendTest();
      return true;
    },
    [sendTest],
  );

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fnotify");
      return;
    }
    let cancelled = false;
    const refresh = () => setPerm(pushPermission());
    refresh();
    void (async () => {
      const st = await load();
      if (cancelled || !st) return;
      // التجديد الصامت: الإذن قائم والخادم لا يعرف اشتراكاً فعّالاً (انتهى أو مُسح) — بلا سؤال
      const local = await currentPushSubscription();
      if (pushPermission() === "granted" && !st.subscribed && (st.expired || local)) {
        const ok = await subscribe(st);
        if (!cancelled && !ok) setRenewFailed(true);
      }
    })();
    const off = onPwaChange(refresh);
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string } | null;
      if (d?.type === "PUSH_EXPIRED") void load().then((st) => subscribe(st));
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      cancelled = true;
      off();
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, [router, load, subscribe]);

  const state: State =
    perm === "denied" || perm === "unsupported"
      ? "permission_denied"
      : status?.subscribed
        ? "success"
        : status?.expired
          ? "expired"
          : "ready";

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const p = await requestPushPermission();
      setPerm(p);
      if (p !== "granted") return;
      const ok = await subscribe(status ?? (await load()));
      if (!ok) setRenewFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await unsubscribePush();
      await api().POST("/api/push/unsubscribe", { body: {} });
      setTest(null);
      await load();
    } catch {
      await load();
    } finally {
      setBusy(false);
    }
  };

  const configuredReason =
    status && !status.configured ? "مفاتيح الإشعارات غير مضبوطة في النشر" : undefined;

  return (
    <Frame title="الإشعارات" nav={<AppNav currentId="notify" />} footer={null}>
      <div className="sys" data-screen="WEB-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">إذن Web Push وحالاته</h2>
            <span className="cat-head__hint">
              إذنٌ يُطلب مرة واحدة في عمر الموقع — فإن أُهدر لا يُستعاد بسهولة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "ready" ? (
              <Notice
                kind="info"
                title="قبل أن نطلب الإذن"
                action={
                  <Button
                    pos
                    onClick={() => void enable()}
                    loading={busy}
                    disabledReason={configuredReason}
                  >
                    تفعيل الإشعارات
                  </Button>
                }
              >
                <p className="acc-lead">
                  نشرح ما سيصل قبل أن يظهر حوار المتصفح: تنبيهات الفواتير والمخزون، لا إعلانات.
                </p>
                <p className="acc-choice__note">
                  <strong>طلبنا قبل طلب المتصفح</strong> · لأن رفض المتصفح دائمٌ تقريباً. شاشتنا
                  قابلة للرفض بلا ثمن، وحواره ليس كذلك.
                </p>
                {renewFailed ? (
                  <Status
                    state="server_error"
                    label="تعذّر الاشتراك عند المزوّد — لا اشتراك ناجح كاذب"
                  />
                ) : null}
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="warning" title="صلاحية مرفوضة">
                <p className="acc-choice__note">
                  {perm === "unsupported"
                    ? "متصفح داخل تطبيق · غير مدعوم"
                    : "رفض المتصفح دائمٌ تقريباً — يُعاد من إعدادات الموقع في المتصفح لا من هنا"}
                </p>
                <p className="acc-lead">
                  حتى ذلك الحين يعمل كل شيء عدا التثبيت والإشعار والعمل بلا اتصال. لا نطلب إذناً
                  سيُرفض تلقائياً.
                </p>
                <Status
                  state="permission_denied"
                  label="البوابة والصندوق يعملان — لا اشتراك ناجح كاذب"
                />
              </Notice>
            ) : null}

            {state === "expired" ? (
              <Notice
                kind="warning"
                title="انتهى الاشتراك"
                action={
                  <Button
                    pos
                    onClick={() => void enable()}
                    loading={busy}
                    disabledReason={configuredReason}
                  >
                    تفعيل الإشعارات
                  </Button>
                }
              >
                <p className="acc-lead">
                  اشتراك Push انتهى صلاحيته عند المزوّد — يحدث بعد شهور أو بتنظيف المتصفح.
                </p>
                <p className="acc-choice__note">
                  <strong>التجديد الصامت</strong> · نجدّد بلا سؤال إن كان الإذن قائماً. السؤال من
                  جديد يُخاطر بإذنٍ نملكه.
                </p>
                <Status
                  state="expired"
                  label={
                    perm === "granted"
                      ? "الإذن قائم — التجديد الصامت لم ينجح بعد"
                      : "الإذن لم يُمنح بعد — نطلبه بعد الشرح"
                  }
                />
              </Notice>
            ) : null}

            {state === "success" ? (
              <Notice
                kind="success"
                title="فُعّل"
                action={
                  <Button variant="secondary" onClick={() => void sendTest()}>
                    إرسال إشعار تجريبي
                  </Button>
                }
              >
                <p className="acc-lead">
                  نُرسل إشعاراً تجريبياً فوراً — التجربة تُثبت أن القناة تعمل، والادّعاء لا يُثبت.
                </p>
                <p className="acc-choice__note">
                  <strong>وما لا يصل</strong> · نقول إن الإشعارات لا تصل والمتصفح مغلق تماماً على
                  بعض الأنظمة. حدٌّ تقني نعلنه لا نخفيه.
                </p>
                {test === "sent" ? (
                  <Status
                    state="synced"
                    label="أُرسل الإشعار التجريبي — إن لم يصل فالقناة لا تعمل"
                  />
                ) : test === "push_not_configured" ? (
                  <Status
                    state="server_error"
                    label="لم يُرسل: مفاتيح الإشعارات غير مضبوطة في النشر"
                  />
                ) : test === "expired" ? (
                  <Status state="expired" label="لم يُرسل: الاشتراك انتهى عند المزوّد" />
                ) : test === "failed" || test === "not_subscribed" ? (
                  <Status state="server_error" label="لم يُرسل الإشعار التجريبي" />
                ) : null}
                <div className="cat-form__actions">
                  <Button variant="quiet" onClick={() => void disable()} loading={busy}>
                    إيقاف الإشعارات
                  </Button>
                </div>
              </Notice>
            ) : null}

            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/install")}>
                التثبيت
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
