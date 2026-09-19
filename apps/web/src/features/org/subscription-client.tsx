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
import { MonoText } from "@/features/org/mono";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "permission_denied" | "expired";

interface Payload {
  plan: {
    code: string;
    name: string;
    trial: boolean;
    state: "trial" | "active" | "grace" | "expired";
    expires_at: string;
    days_since_expiry: number;
    price_minor: string | null;
    currency: string;
  };
  limits: {
    branches: { used: number; max: number };
    devices: { used: number; max: number };
    users: { used: number; max: number | null };
    campaign_quota: { used: number; max: number };
  };
  features: {
    code: string;
    label: string;
    note: string;
    status: "open" | "conditional" | "locked";
  }[];
  if_expired: { continues: string[]; stops: string[] };
  plans: {
    code: string;
    name: string;
    price_minor: string;
    period: "month" | "trial";
    trial_days: number | null;
    blurb: string;
    current: boolean;
  }[];
  can_see_amounts: boolean;
  can_renew: boolean;
}

const STATUS_LABEL = { open: "مفتوح", conditional: "مشروط", locked: "مغلق" } as const;

function money(minor: string): string {
  const n = Number(minor) / 100;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function thousands(minor: string): string {
  return Math.round(Number(minor) / 100).toLocaleString("en-US");
}

/**
 * ORG-06 — الاشتراك والباقات: ما تفتحه الباقة وما لا تفتحه، بلا إخفاء (27-D20 ready/
 * permission_denied/expired · 39-D31 loading): الميزة غير المتاحة رمادية بسبب؛ حدّ الأجهزة رقم
 * صريح؛ الحالة من الخادم دائماً لا كاش للاستحقاق؛ المبالغ للمالك ومن فوّضه (§١١.١، §١٦.١؛ ACC-104).
 */
export function SubscriptionClient() {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    try {
      const { data, response } = await api().GET("/api/org/subscription", {});
      if (response.status === 403) {
        setFailed(true);
        return;
      }
      if (response.ok && data) setP(data);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Forg%2Fsubscription");
      return;
    }
    void load();
  }, [router, load]);

  const state: State = !p
    ? "loading"
    : !p.can_see_amounts
      ? "permission_denied"
      : p.plan.state === "grace" || p.plan.state === "expired"
        ? "expired"
        : "ready";

  const renew = p ? dayMonth(p.plan.expires_at) : null;

  return (
    <Frame title="الاشتراك" nav={<AppNav currentId="org-subscription" />} footer={null}>
      <div className="sys" data-screen="ORG-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              الاشتراك والباقات — ما تفتحه الباقة وما لا تفتحه، بلا إخفاء
            </h2>
            <span className="cat-head__hint">
              الميزة غير المتاحة تُعرض رمادية مع سبب، لا تُخفى فيظنّ التاجر أنها غير موجودة. وحدّ
              الأجهزة رقم صريح لا مفاجأة عند الجهاز السابع.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الاشتراك">
                <p className="acc-lead">
                  حالة الاشتراك من الخادم دائماً. رقمٌ قديم هنا يعني قراراً مالياً على معلومة قديمة.
                </p>
                <p className="acc-choice__note">
                  <strong>لا كاش للاستحقاق</strong> · تاريخ الاستحقاق والمبلغ يُقرآن حيّين. والشاشة
                  تُفتح مرةً في الشهر — فثانيتان مقبولتان.
                </p>
                {failed ? (
                  <Button variant="secondary" onClick={() => void load()}>
                    أعد المحاولة
                  </Button>
                ) : null}
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="info" title="مدير فرع يفتح الاشتراك">
                <p className="acc-lead">
                  الاشتراك التزام مالي على المنشأة — يراه المالك ومن فوّضه صراحة. مدير الفرع يرى أثر
                  الباقة على عمله (الحدود والميزات) دون المبالغ ولا وسيلة الدفع.
                </p>
              </Notice>
            ) : null}

            {state === "expired" && p ? (
              <Notice
                kind="warning"
                title="لو انتهى الاشتراك"
                action={
                  <Button onClick={() => router.push("/org/subscription/expiry")}>ORG-08</Button>
                }
              >
                <p className="acc-lead">
                  البيع والطباعة والجرد تستمر. ما يتوقف: نشر عروض السوق، والحملات، وتقارير الفترات
                  الطويلة. التفصيل الكامل في ORG-08 — انتهى اشتراكك قبل{" "}
                  <MonoText text={`${p.plan.days_since_expiry} أيام`} />.
                </p>
              </Notice>
            ) : null}

            {p ? (
              <>
                <h3 className="cat-head__title">استحقاقات</h3>
                <p className="acc-lead">
                  <strong>باقتك الحالية — {p.plan.name}</strong>
                  {p.can_see_amounts && renew ? (
                    <>
                      {" "}
                      · تُجدَّد في <span className="sting-mono">{renew.day}</span> {renew.month} ·{" "}
                      <span className="sting-mono">
                        {money(p.plan.price_minor ?? "0")} {p.plan.currency}
                      </span>{" "}
                      شهرياً
                    </>
                  ) : null}{" "}
                  <span
                    className={`org-badge org-badge--${p.plan.state === "expired" ? "expired" : "active"}`}
                  >
                    {p.plan.state === "trial"
                      ? "تجريبية"
                      : p.plan.state === "active"
                        ? "سارية"
                        : p.plan.state === "grace"
                          ? "منتهية — مهلة"
                          : "منتهية"}
                  </span>
                </p>

                <h3 className="cat-head__title">حدود الباقة كأرقام</h3>
                <p className="acc-choice__note">
                  عند بلوغ الحدّ لا نمنع البيع. نمنع إضافة جهاز جديد ونشرح البديل: ترقية الباقة أو
                  سحب جهاز قديم.
                </p>
                <ul className="acc-choice__note">
                  <li>
                    الفروع ·{" "}
                    <span className="sting-mono">
                      {p.limits.branches.used} / {p.limits.branches.max}
                    </span>
                  </li>
                  <li>
                    الأجهزة ·{" "}
                    <span className="sting-mono">
                      {p.limits.devices.used} / {p.limits.devices.max}
                    </span>
                  </li>
                  <li>
                    المستخدمون · <span className="sting-mono">{p.limits.users.used}</span> /{" "}
                    {p.limits.users.max === null ? (
                      "غير محدود"
                    ) : (
                      <span className="sting-mono">{p.limits.users.max}</span>
                    )}
                  </li>
                  <li>
                    حصة رسائل الحملات ·{" "}
                    <span className="sting-mono">
                      {p.limits.campaign_quota.max.toLocaleString("en-US")}
                    </span>{" "}
                    / شهر
                  </li>
                </ul>

                <ul className="acc-choice__note">
                  {p.features.map((f) => (
                    <li key={f.code} className="org-effects__row">
                      <div>
                        <strong>{f.label}</strong>
                        <p className="acc-choice__note">
                          <MonoText text={f.note} />
                        </p>
                      </div>
                      <span
                        className={`org-badge org-badge--${f.status === "open" ? "active" : f.status === "conditional" ? "sent" : "disabled"}`}
                      >
                        {STATUS_LABEL[f.status]}
                      </span>
                    </li>
                  ))}
                </ul>

                {state !== "expired" ? (
                  <Notice kind="info" title="لو انتهى الاشتراك">
                    <p className="acc-lead">
                      البيع والطباعة والجرد تستمر. ما يتوقف: نشر عروض السوق، والحملات، وتقارير
                      الفترات الطويلة. التفصيل الكامل في ORG-08 — وهذه الشاشة تعرض القائمة قبل
                      الانتهاء لا بعده.
                    </p>
                    <Button variant="quiet" onClick={() => router.push("/org/subscription/expiry")}>
                      ORG-08
                    </Button>
                  </Notice>
                ) : null}

                {p.can_see_amounts ? (
                  <>
                    <h3 className="cat-head__title">الباقات — ORG-06</h3>
                    <p className="acc-choice__note">حدود صريحة بالأرقام، لا «غير محدود» بنجمة</p>
                    <ul className="acc-choice__note">
                      {p.plans.map((pl) => (
                        <li key={pl.code} className="org-effects__row">
                          <div>
                            <strong>{pl.name}</strong>
                            {pl.current ? " · باقتك الحالية" : ""}
                            <p className="acc-choice__note">
                              <MonoText text={pl.blurb} />
                            </p>
                          </div>
                          <span>
                            {pl.period === "trial" ? (
                              <>
                                <span className="sting-mono">{pl.trial_days}</span> يوماً
                              </>
                            ) : (
                              <>
                                <span className="sting-mono">{thousands(pl.price_minor)}</span> /
                                شهر
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="cat-form__actions">
                      <Button
                        onClick={() => router.push("/org/subscription/renew")}
                        disabledReason="رفع إثبات التحويل ومراجعته — ORG-07 (المهمة التالية)"
                      >
                        تجديد الاشتراك
                      </Button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
