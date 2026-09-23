"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
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

const CHANGE_ERRORS: Record<string, string> = {
  plan_invalid: "الباقة غير متاحة للتغيير.",
  same_plan: "هذه باقتك الحالية.",
  suspended: "الاشتراك موقوف — تواصل مع الدعم أولاً.",
  limits_exceeded: "الاستعمال الحالي يتجاوز حدود الباقة الأصغر — عطّل فرعاً أو جهازاً أولاً.",
  not_downgrade: "هذا ليس تخفيضاً.",
  paid_plan_required: "الإضافات لاشتراك مدفوع ساري — جدّد أو رقِّ أولاً.",
  addon_not_offered: "هذه الإضافة غير معروضة في باقتك.",
  renew_first: "لا أيام متبقية في الفترة — جدّد أولاً.",
  qty_invalid: "الكمية غير صالحة.",
  addon_invalid: "نوع الإضافة غير معروف.",
};

interface AddonLine {
  kind: "devices" | "users" | "branches";
  label: string;
  unit_monthly_minor: string | null;
  offered: boolean;
  qty: number;
  monthly_minor: string | null;
}

interface AddonQuote {
  kind: AddonLine["kind"];
  label: string;
  qty: number;
  plan_name: string;
  unit_monthly_minor: string;
  remaining_days: number;
  amount_minor: string;
  renewal_monthly_minor: string;
  currency: string;
  note: string;
}

interface Quote {
  from: { code: string; name: string; price_minor: string };
  to: { code: string; name: string; price_minor: string };
  kind: "upgrade" | "downgrade" | "renewal";
  remaining_days: number;
  expires_at: string;
  amount_minor: string;
  currency: string;
  effective: string;
  blocked_reasons: string[];
  pending_downgrade: string;
  note: string;
}

interface Payload {
  plan: {
    code: string;
    name: string;
    trial: boolean;
    state: "trial" | "active" | "grace" | "expired" | "suspended";
    expires_at: string;
    suspended_reason?: string;
    days_since_expiry: number;
    price_minor: string | null;
    addons_monthly_minor?: string | null;
    currency: string;
  };
  limits: {
    branches: { used: number; max: number; extra?: number; addon?: number };
    devices: { used: number; max: number; extra?: number; addon?: number };
    users: { used: number; max: number | null; extra?: number; addon?: number };
    campaign_quota: { used: number; max: number };
  };
  features: {
    code: string;
    label: string;
    note: string;
    status: "open" | "conditional" | "locked";
  }[];
  if_expired: { continues: string[]; stops: string[] };
  next_plan_code?: string;
  next_plan_name?: string;
  plans: {
    code: string;
    name: string;
    price_minor: string;
    period: "month" | "trial";
    trial_days: number | null;
    blurb: string;
    current: boolean;
  }[];
  addons?: AddonLine[];
  can_buy_addons?: boolean;
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
  // 0005 §١١٢ — ترقية/تخفيض من المستأجر: عرض التغيير قبل التنفيذ
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState("");
  const [changing, setChanging] = useState(false);
  // 0005 §١١٦ — الإضافات المدفوعة
  const [addonQty, setAddonQty] = useState<Record<string, number>>({});
  const [addonQuote, setAddonQuote] = useState<AddonQuote | null>(null);
  const [addonErr, setAddonErr] = useState("");
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

  const askQuote = async (code: string) => {
    setQuoteErr("");
    setQuote(null);
    const { data, error, response } = await api().GET("/api/org/subscription/change", {
      params: { query: { plan_code: code } },
    });
    const b = (data ?? error) as unknown as { quote?: Quote; detail?: string } | undefined;
    if (response.ok && b?.quote) setQuote(b.quote);
    else setQuoteErr(CHANGE_ERRORS[b?.detail ?? ""] ?? "تعذّر جلب عرض التغيير.");
  };

  const askAddon = async (kind: AddonLine["kind"]) => {
    setAddonErr("");
    setAddonQuote(null);
    const qty = addonQty[kind] ?? 1;
    const { data, error, response } = await api().GET("/api/org/subscription/addon", {
      params: { query: { kind, qty } },
    });
    const b = (data ?? error) as unknown as { quote?: AddonQuote; detail?: string } | undefined;
    if (response.ok && b?.quote) setAddonQuote(b.quote);
    else setAddonErr(CHANGE_ERRORS[b?.detail ?? ""] ?? "تعذّر جلب عرض الإضافة.");
  };

  const reduceAddon = async (kind: AddonLine["kind"]) => {
    setAddonErr("");
    setChanging(true);
    try {
      const { data, error, response } = await api().POST("/api/org/subscription/addon", {
        body: { kind, qty: 1 } as never,
      });
      const b = (data ?? error) as unknown as (Payload & { detail?: string }) | undefined;
      if (response.ok && b && "plans" in b) setP(b);
      else
        setAddonErr(
          b?.detail === "limits_exceeded"
            ? "الاستعمال الحالي يحتاج هذه الإضافة — عطّل جهازاً أو مستخدماً أو فرعاً أولاً."
            : (CHANGE_ERRORS[b?.detail ?? ""] ?? "تعذّر تخفيض الإضافة."),
        );
    } finally {
      setChanging(false);
    }
  };

  const applyDowngrade = async (code: string) => {
    setChanging(true);
    try {
      const { data, error, response } = await api().POST("/api/org/subscription/change", {
        body: { plan_code: code } as never,
      });
      const b = (data ?? error) as unknown as (Payload & { detail?: string }) | undefined;
      if (response.ok && b && "plans" in b) {
        setP(b);
        setQuote(null);
      } else setQuoteErr(CHANGE_ERRORS[b?.detail ?? ""] ?? "تعذّر جدولة التخفيض.");
    } finally {
      setChanging(false);
    }
  };

  const cancelDowngrade = async () => {
    setChanging(true);
    try {
      const { data, response } = await api().POST("/api/org/subscription/change", {
        body: { cancel: true } as never,
      });
      const b = data as unknown as Payload | undefined;
      if (response.ok && b) setP(b);
    } finally {
      setChanging(false);
    }
  };

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

            {p?.plan.state === "suspended" ? (
              <Notice kind="error" title="الاشتراك موقوف من مشغّل المنصة">
                <p className="acc-lead">
                  البيع والطباعة والجرد والقراءة والتصدير مستمرة. المتوقف: الميزات المدفوعة (السوق،
                  الحملات، التقارير المتقدمة) حتى الاستئناف.
                </p>
                <p className="acc-choice__note">
                  <strong>السبب</strong> · {p.plan.suspended_reason || "—"} — التفاصيل في سجل
                  التدقيق، والتواصل عبر الدعم.
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
                      {Number(p.plan.addons_monthly_minor ?? "0") > 0 ? (
                        <>
                          {" "}
                          + الإضافات{" "}
                          <span className="sting-mono">
                            {money(p.plan.addons_monthly_minor ?? "0")}
                          </span>
                        </>
                      ) : null}
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
                    {p.limits.branches.extra ? (
                      <span className="org-extra">
                        {" "}
                        (منها <span className="sting-mono">{p.limits.branches.extra}</span> إضافية)
                      </span>
                    ) : null}
                    {p.limits.branches.addon ? (
                      <span className="org-extra">
                        {" "}
                        (منها <span className="sting-mono">{p.limits.branches.addon}</span> مدفوعة)
                      </span>
                    ) : null}
                  </li>
                  <li>
                    الأجهزة ·{" "}
                    <span className="sting-mono">
                      {p.limits.devices.used} / {p.limits.devices.max}
                    </span>
                    {p.limits.devices.extra ? (
                      <span className="org-extra">
                        {" "}
                        (منها <span className="sting-mono">{p.limits.devices.extra}</span> إضافية)
                      </span>
                    ) : null}
                    {p.limits.devices.addon ? (
                      <span className="org-extra">
                        {" "}
                        (منها <span className="sting-mono">{p.limits.devices.addon}</span> مدفوعة)
                      </span>
                    ) : null}
                  </li>
                  <li>
                    المستخدمون · <span className="sting-mono">{p.limits.users.used}</span> /{" "}
                    {p.limits.users.max === null ? (
                      "غير محدود"
                    ) : (
                      <span className="sting-mono">{p.limits.users.max}</span>
                    )}
                    {p.limits.users.extra ? (
                      <span className="org-extra">
                        {" "}
                        (منها <span className="sting-mono">{p.limits.users.extra}</span> إضافية)
                      </span>
                    ) : null}
                    {p.limits.users.addon ? (
                      <span className="org-extra">
                        {" "}
                        (منها <span className="sting-mono">{p.limits.users.addon}</span> مدفوعة)
                      </span>
                    ) : null}
                  </li>
                  <li>
                    حصة رسائل الحملات ·{" "}
                    <span className="sting-mono">
                      {p.limits.campaign_quota.max.toLocaleString("en-US")}
                    </span>{" "}
                    / شهر
                  </li>
                </ul>

                {p.can_see_amounts && p.addons?.some((a) => a.offered || a.qty > 0) ? (
                  <div className="org-addons" data-testid="org-addons">
                    <h3 className="cat-head__title">الإضافات</h3>
                    <p className="acc-choice__note">
                      تحتاج جهازاً أو مستخدماً أو فرعاً فوق حدّ الباقة دون ترقيتها؟ أضفه بسعر شهري
                      للوحدة. يُدفع الآن عن الأيام المتبقية فقط، ثم يُجدَّد مع الباقة.
                    </p>
                    <ul className="acc-choice__note">
                      {p.addons
                        .filter((a) => a.offered || a.qty > 0)
                        .map((a) => (
                          <li key={a.kind} className="org-effects__row" data-addon={a.kind}>
                            <div>
                              <strong>{a.label} إضافي</strong>
                              <p className="acc-choice__note">
                                <span className="sting-mono">
                                  {thousands(a.unit_monthly_minor ?? "0")}
                                </span>{" "}
                                / شهر للوحدة · لديك <span className="sting-mono">{a.qty}</span>
                              </p>
                            </div>
                            <span className="org-plan__side">
                              {p.can_buy_addons && a.offered ? (
                                <>
                                  <span className="org-stepper">
                                    <button
                                      type="button"
                                      aria-label={`أنقص كمية ${a.label}`}
                                      onClick={() =>
                                        setAddonQty((q) => ({
                                          ...q,
                                          [a.kind]: Math.max(1, (q[a.kind] ?? 1) - 1),
                                        }))
                                      }
                                    >
                                      −
                                    </button>
                                    <span className="sting-mono">{addonQty[a.kind] ?? 1}</span>
                                    <button
                                      type="button"
                                      aria-label={`زد كمية ${a.label}`}
                                      onClick={() =>
                                        setAddonQty((q) => ({
                                          ...q,
                                          [a.kind]: Math.min(50, (q[a.kind] ?? 1) + 1),
                                        }))
                                      }
                                    >
                                      +
                                    </button>
                                  </span>
                                  <Button variant="quiet" onClick={() => void askAddon(a.kind)}>
                                    أضف
                                  </Button>
                                </>
                              ) : null}
                              {a.qty > 0 ? (
                                <Button
                                  variant="quiet"
                                  loading={changing}
                                  onClick={() => void reduceAddon(a.kind)}
                                >
                                  أزل واحدة
                                </Button>
                              ) : null}
                            </span>
                          </li>
                        ))}
                    </ul>
                    {!p.can_buy_addons ? (
                      <p className="acc-choice__note">
                        شراء الإضافات لاشتراك مدفوع ساري — من التجريبية أو بعد الانتهاء جدّد أولاً.
                      </p>
                    ) : null}
                    {addonErr ? <Status state="validation_error" label={addonErr} /> : null}
                    {addonQuote ? (
                      <Notice
                        kind="info"
                        title={`إضافة ${addonQuote.qty} ${addonQuote.label}`}
                        action={
                          <>
                            <Button
                              onClick={() =>
                                router.push(
                                  `/org/subscription/renew?addon=${addonQuote.kind}&qty=${addonQuote.qty}`,
                                )
                              }
                            >
                              ادفع وارفع الإثبات
                            </Button>
                            <Button variant="quiet" onClick={() => setAddonQuote(null)}>
                              إلغاء
                            </Button>
                          </>
                        }
                      >
                        <p className="acc-lead">{addonQuote.note}</p>
                        <p className="acc-choice__note">
                          الآن عن <span className="sting-mono">{addonQuote.remaining_days}</span>{" "}
                          يوماً متبقية:{" "}
                          <strong className="sting-mono">
                            {thousands(addonQuote.amount_minor)} {addonQuote.currency}
                          </strong>{" "}
                          · ثم{" "}
                          <span className="sting-mono">
                            {thousands(addonQuote.renewal_monthly_minor)}
                          </span>{" "}
                          / شهر مع التجديد
                        </p>
                      </Notice>
                    ) : null}
                  </div>
                ) : null}

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
                          <span className="org-plan__side">
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
                            {!pl.current && pl.period !== "trial" && !p.plan.trial ? (
                              <Button variant="quiet" onClick={() => void askQuote(pl.code)}>
                                {BigInt(pl.price_minor) > BigInt(p.plan.price_minor ?? "0")
                                  ? "ترقية"
                                  : "تخفيض"}
                              </Button>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {p.next_plan_code ? (
                      <Notice
                        kind="info"
                        title={`تخفيض مجدول إلى «${p.next_plan_name ?? p.next_plan_code}» عند التجديد`}
                        action={
                          <Button
                            variant="quiet"
                            loading={changing}
                            onClick={() => void cancelDowngrade()}
                          >
                            ألغِ التخفيض
                          </Button>
                        }
                      >
                        <p className="acc-choice__note">
                          باقتك الحالية تبقى حتى تاريخ الانتهاء؛ التجديد القادم يكون على الباقة
                          الأصغر بسعرها.
                        </p>
                      </Notice>
                    ) : null}
                    {quoteErr ? <Status state="validation_error" label={quoteErr} /> : null}
                    {quote ? (
                      <Notice
                        kind={quote.blocked_reasons.length ? "warning" : "info"}
                        title={
                          quote.kind === "upgrade"
                            ? `ترقية إلى «${quote.to.name}»`
                            : quote.kind === "downgrade"
                              ? `تخفيض إلى «${quote.to.name}» عند التجديد`
                              : `الانتقال إلى «${quote.to.name}» عند التجديد`
                        }
                        action={
                          <>
                            {quote.kind === "upgrade" && !quote.blocked_reasons.length ? (
                              <Button
                                onClick={() =>
                                  router.push(`/org/subscription/renew?upgrade=${quote.to.code}`)
                                }
                              >
                                ادفع الفرق وارفع الإثبات
                              </Button>
                            ) : null}
                            {quote.kind === "downgrade" && !quote.blocked_reasons.length ? (
                              <Button
                                loading={changing}
                                onClick={() => void applyDowngrade(quote.to.code)}
                              >
                                جدوِل التخفيض
                              </Button>
                            ) : null}
                            {quote.kind === "renewal" ? (
                              <Button onClick={() => router.push("/org/subscription/renew")}>
                                جدّد على هذه الباقة
                              </Button>
                            ) : null}
                            <Button variant="quiet" onClick={() => setQuote(null)}>
                              إلغاء
                            </Button>
                          </>
                        }
                      >
                        <p className="acc-lead">{quote.note}</p>
                        {quote.kind === "upgrade" ? (
                          <p className="acc-choice__note">
                            الفرق على <span className="sting-mono">{quote.remaining_days}</span>{" "}
                            يوماً متبقية:{" "}
                            <strong className="sting-mono">
                              {thousands(quote.amount_minor)} {quote.currency}
                            </strong>
                          </p>
                        ) : null}
                        {quote.blocked_reasons.map((r) => (
                          <p key={r} className="acc-choice__note">
                            <strong>ممنوع</strong> · {r}
                          </p>
                        ))}
                      </Notice>
                    ) : null}
                    <div className="cat-form__actions">
                      <Button onClick={() => router.push("/org/subscription/renew")}>
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
