"use client";

import { Button, Frame, Notice } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./org.css";
import { AppNav } from "@/features/home/app-nav";
import { dayMonth } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "expired" | "permission_denied";

interface Payload {
  state: "trial" | "active" | "grace" | "expired";
  expired: boolean;
  expired_at: string;
  days_since_expiry: number;
  continues: string[];
  stops: string[];
  can_renew: boolean;
  can_see_amounts: boolean;
  plan_name: string;
}

/**
 * ORG-08 — انتهاء الاشتراك: القائمة الصريحة (39-D31 ready/permission_denied · 07-D3 expired):
 * قرار G-08 المطبَّق — البيع يستمر، والسوق والحملات والتقارير تُحجب؛ لا حجب للبيانات والتصدير
 * يبقى عاملاً؛ التجديد للمالك والموظف يرى أثر الانتهاء على عمله (§١١.٢؛ ACC-80، 81، 82).
 */
export function ExpiryClient() {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/org/subscription/expiry", {});
    if (response.ok && data) setP(data);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Fsubscription%2Fexpiry");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const state: State = !p
    ? "ready"
    : p.expired && !p.can_renew
      ? "permission_denied"
      : p.expired
        ? "expired"
        : "ready";
  const at = p ? dayMonth(p.expired_at) : null;

  return (
    <Frame title="انتهاء الاشتراك" nav={<AppNav currentId="org-subscription" />} footer={null}>
      <div className="sys" data-screen="ORG-08" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">انتهاء الاشتراك</h2>
            <span className="cat-head__hint">حالتان ناقصتان، وتحكمهما قائمة G-08 الصريحة.</span>
          </div>
          <div className="acc-card__body">
            {state === "expired" && p && at ? (
              <Notice
                kind="warning"
                title={
                  <>
                    انتهى اشتراكك في <span className="sting-mono">{at.day}</span> {at.month}
                  </>
                }
                action={
                  <>
                    <Button onClick={() => router.push("/org/subscription/renew")}>
                      تجديد الاشتراك
                    </Button>
                    <Button variant="secondary" onClick={() => router.push("/sync/backup")}>
                      تصدير نسخة كاملة
                    </Button>
                  </>
                }
              >
                <p className="acc-lead">
                  بياناتك كاملة ولم يُحجب منها شيء. البيع وإدارة الذمم والورديات تعمل كالمعتاد. ما
                  توقّف هو السوق والحملات والتقارير التحليلية.
                </p>
                <p className="acc-choice__note">
                  <strong>تصدير نسخة محلية</strong> SYS-05 <strong>وتصدير التقارير</strong> REP-06
                  يبقيان متاحين دائماً. لن نحتجز بياناتك مقابل التجديد، وتستطيع أخذها كاملة في أي
                  وقت.
                </p>
              </Notice>
            ) : null}

            {state === "permission_denied" && p && at ? (
              <Notice kind="info" title="التجديد للمالك">
                <p className="acc-lead">
                  الموظف يرى أن الاشتراك انتهى وأثر ذلك على عمله، ولا يرى الفواتير ولا يجدّد.
                </p>
                <p className="acc-choice__note">
                  <strong>ما يراه</strong> · ما توقّف من وظائفه هو، لا حالة الحساب المالية. «تقرير
                  المبيعات موقوف — الاشتراك منتهٍ» يكفيه.
                </p>
              </Notice>
            ) : null}

            {state === "ready" ? (
              <Notice kind="info" title="ما يستمر وما يتوقف">
                <p className="acc-lead">
                  قائمتان صريحتان لا عبارة عامة: البيع والذمم والورديات والتصدير تستمر؛ السوق
                  والتقارير الخادمية والحملات تتوقف.
                </p>
                <p className="acc-choice__note">
                  <strong>لماذا صريحتان</strong> · «الأعمال الأساسية مستمرة» جملةٌ يفسّرها كلٌّ
                  بهواه. القائمة تُنهي الجدل قبل وقوعه (G-08).
                </p>
                <p className="acc-choice__note">
                  <strong>لا حجب للبيانات</strong> · انتهاء الاشتراك لا يحجب دفترك عنك. التصدير يبقى
                  عاملاً — بياناتك بياناتك.
                </p>
              </Notice>
            ) : null}

            {p ? (
              <div className="org-effects">
                <div className="org-effects__row">
                  <div>
                    <strong>يستمر بالكامل</strong>
                    <ul className="acc-choice__note">
                      {p.continues.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong>محجوب حتى التجديد</strong>
                    <ul className="acc-choice__note">
                      {p.stops.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/org/subscription")}>
                الاشتراك والباقات
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
