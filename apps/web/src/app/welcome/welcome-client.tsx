"use client";

import { Button, Frame, Notice } from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import { PublicHeader } from "@/features/public/public-header";
import { AuthAside, AuthExtras } from "@/features/acc/auth-aside";
import { api } from "@/lib/api";
import { hasLocalSetup } from "@/lib/device-setup";
import { useOnline } from "@/lib/online";

type State = "ready" | "offline" | "server_error";

/**
 * ACC-01. النصوص حرفاً من `28-D21#ACC-01` (ready) و`34-D26#ACC-01` (offline · server_error).
 * الجهاز المهيّأ لا يرى هذه الشاشة: ينتقل إلى قفل PIN (ACC-07) — «عرضُ ترحيبٍ لمن هُيّئ جهازه إهدارُ خطوة».
 */
export function WelcomeClient() {
  const router = useRouter();
  const online = useOnline();
  const [serverDown, setServerDown] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void hasLocalSetup().then((done) => {
      if (done) router.replace("/lock");
    });
  }, [router]);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void api()
      .GET("/api/health")
      .then(({ response }) => {
        if (!cancelled) setServerDown(!response.ok);
      })
      .catch(() => {
        if (!cancelled) setServerDown(true);
      });
    return () => {
      cancelled = true;
    };
  }, [online, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const state: State = !online ? "offline" : serverDown ? "server_error" : "ready";

  return (
    <Frame title="فيزانو" footer={null} back={false} chrome={<PublicHeader cta="login" />}>
      <div className="acc-page acc-page--split" data-screen="ACC-01" data-state={state}>
        <AuthAside />
        {state === "offline" ? (
          <div className="acc-card">
            <div className="acc-card__body">
              <Notice kind="offline" title="بلا اتصال">
                <p className="acc-lead">
                  جهازٌ جديد لا يستطيع الدخول ولا الإنشاء: كلاهما يحتاج الخادم.
                </p>
                <div className="acc-links">
                  <Button onClick={retry}>أعد المحاولة</Button>
                </div>
              </Notice>
            </div>
          </div>
        ) : null}
        {state === "server_error" ? (
          <div className="acc-card">
            <div className="acc-card__body">
              <Notice kind="error" title="خطأ خادم">
                <p className="acc-lead">الخدمة لا تستجيب — العطب ليس عندك</p>
                <div className="acc-links">
                  <Button onClick={retry}>أعد المحاولة</Button>
                  <Button variant="secondary" onClick={() => router.push("/status")}>
                    حالة الخدمة
                  </Button>
                </div>
              </Notice>
            </div>
          </div>
        ) : null}
        {state === "ready" ? (
          <div className="acc-card">
            <div className="acc-card__body">
              <div>
                <h2 className="acc-card__title" style={{ fontSize: 21 }}>
                  أهلاً بك في فيزانو
                </h2>
                <p className="acc-lead">
                  اختر ما جاء بك. الاختيار يحدّد نوع حسابك ولا يُغيَّر لاحقاً بضغطة.
                </p>
              </div>
              <Link href="/register" className="acc-choice acc-choice--primary">
                <span className="acc-choice__k">أدير متجراً — إنشاء منشأة جديدة</span>
                <span className="acc-choice__note">
                  حساب إدارة: نقاط بيع ومخزون ودفاتر. هذا ما يحتاجه صاحب المحل.
                </span>
              </Link>
              <Link href="/login" className="acc-choice">
                <span className="acc-choice__k">لي حساب — دخول</span>
                <span className="acc-choice__note">مالك أو موظف له عضوية في منشأة قائمة.</span>
              </Link>
              <Link href="/login?intent=market" className="acc-choice">
                <span className="acc-choice__k">أشتري من السوق باسم منشأتي</span>
                <span className="acc-choice__note">
                  نفس حساب الإدارة. لا حساب سوق منفصل — منشأة واحدة تشتري وتبيع بدفتر واحد.
                </span>
              </Link>
              <p className="acc-note">
                زبون محل وصلته رسالة؟ لا تحتاج حساباً هنا — افتح الرابط الذي وصلك مباشرة.
              </p>
            </div>
          </div>
        ) : null}
        <AuthExtras />
      </div>
    </Frame>
  );
}
