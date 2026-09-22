"use client";

import {
  Button,
  formatMinor,
  Notice,
  parseMoneyInput,
  Status,
  SwitchField,
  TextAreaField,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/public/public.css";
import "./platform.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "permission_denied";

interface Plan {
  code: string;
  name: string;
  blurb: string;
  order: number;
  is_active: boolean;
  trial: boolean;
  trial_days: number;
  max_branches: number;
  max_devices: number;
  max_users: number | null;
  campaign_quota: number;
  features: string[];
  price_monthly_minor: string;
  price_quarterly_minor: string;
  price_yearly_minor: string;
  next_price: {
    monthly_minor: string | null;
    quarterly_minor: string | null;
    yearly_minor: string | null;
    effective_at: string;
  } | null;
  subscribers: number;
  updated_at: string;
}
interface Change {
  id: string;
  plan_code: string;
  changes: Record<string, unknown>;
  reason: string;
  by_name: string;
  at: string;
}
interface Payload {
  plans: Plan[];
  features: string[];
  cycles: { cycle: string; label: string; days: number }[];
  changes: Change[];
  min_price_notice_days: number;
  rule: string;
}

const FEATURE_LABELS: Record<string, string> = {
  pos_core: "نقاط البيع والطباعة والجرد",
  multi_branch: "تعدّد الفروع",
  advanced_reports: "التقارير الكاملة",
  branch_compare: "مقارنة الفروع",
  market_publish: "نشر العروض واستقبال الطلبات في السوق",
  market_private_prices: "قوائم أسعار خاصة في السوق",
  campaigns: "الحملات ورسائل الزبائن",
  bulk_pricing: "التسعير الجماعي",
  cost_margin: "التكلفة والهامش",
  supplier_analytics: "تحليلات المورد المتقدّمة",
};
const ERRORS: Record<string, string> = {
  name_required: "اسم الباقة مطلوب.",
  code_invalid: "الرمز حروف لاتينية صغيرة وأرقام و_ (حتى 20).",
  code_exists: "يوجد باقة بهذا الرمز.",
  nothing_to_change: "لا تغيير.",
  pos_core_required: "نقاط البيع لا تُنزع من أي باقة — لا تتوقف بحال.",
  trial_required: "التجريبية لا تُؤرشف؛ عدّل مدتها أو حدودها.",
  features_invalid: "خاصية غير معروفة.",
  notice_too_short: "السعر الجديد يحتاج إشعاراً 30 يوماً على الأقل — اختر تاريخاً أبعد.",
  effective_at_invalid: "تاريخ السريان غير صالح.",
  price_required: "أدخل سعراً واحداً على الأقل.",
};

const money = (minor: string) => formatMinor(minor);
const toMinor = (text: string) => parseMoneyInput(text) ?? "0";
const When = ({ iso }: { iso: string }) => {
  if (!iso) return <>—</>;
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};

type Draft = {
  code: string;
  name: string;
  blurb: string;
  order: string;
  is_active: boolean;
  trial: boolean;
  trial_days: string;
  max_branches: string;
  max_devices: string;
  max_users: string;
  campaign_quota: string;
  features: string[];
  monthly: string;
  quarterly: string;
  yearly: string;
  reason: string;
};
const EMPTY: Draft = {
  code: "",
  name: "",
  blurb: "",
  order: "0",
  is_active: true,
  trial: false,
  trial_days: "30",
  max_branches: "1",
  max_devices: "3",
  max_users: "",
  campaign_quota: "0",
  features: ["pos_core"],
  monthly: "0.00",
  quarterly: "0.00",
  yearly: "0.00",
  reason: "",
};
const fromPlan = (p: Plan): Draft => ({
  code: p.code,
  name: p.name,
  blurb: p.blurb,
  order: String(p.order),
  is_active: p.is_active,
  trial: p.trial,
  trial_days: String(p.trial_days),
  max_branches: String(p.max_branches),
  max_devices: String(p.max_devices),
  max_users: p.max_users === null ? "" : String(p.max_users),
  campaign_quota: String(p.campaign_quota),
  features: p.features,
  monthly: money(p.price_monthly_minor),
  quarterly: money(p.price_quarterly_minor),
  yearly: money(p.price_yearly_minor),
  reason: "",
});

/** PLT-16 — كتالوج الباقات والتسعير: ما تراه الصفحة العامة وORG-06 يُحرَّر هنا بسبب وسجل. */
export function PlansCatalogClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [editing, setEditing] = useState<string>("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [priceFor, setPriceFor] = useState("");
  const [nextMonthly, setNextMonthly] = useState("");
  const [nextYearly, setNextYearly] = useState("");
  const [effective, setEffective] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data: d, response } = await platformApi().GET("/api/platform/plans");
    if (response.status === 403 || response.status === 401) {
      setDenied(true);
      return;
    }
    const b = d as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const fail = (code: string, status: number) =>
    setError(ERRORS[code] ?? `تعذّر التنفيذ (${code || status})`);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const body = () => ({
    name: draft.name,
    blurb: draft.blurb,
    order: Number(draft.order || 0),
    is_active: draft.is_active,
    trial: draft.trial,
    trial_days: Number(draft.trial_days || 30),
    max_branches: Number(draft.max_branches || 1),
    max_devices: Number(draft.max_devices || 1),
    max_users: draft.max_users.trim() === "" ? null : Number(draft.max_users),
    campaign_quota: Number(draft.campaign_quota || 0),
    features: draft.features,
    price_monthly_minor: Number(toMinor(draft.monthly)),
    price_quarterly_minor: Number(toMinor(draft.quarterly)),
    price_yearly_minor: Number(toMinor(draft.yearly)),
    reason: draft.reason,
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setDone("");
    setBusy(true);
    try {
      const r =
        editing === "new"
          ? await platformApi().POST("/api/platform/plans", {
              body: { code: draft.code.trim().toLowerCase(), ...body() } as never,
            })
          : await platformApi().POST("/api/platform/plans/{code}/{action}", {
              params: { path: { code: editing, action: "update" } },
              body: body() as never,
            });
      const b = (r.data ?? r.error) as unknown as Payload | { detail?: string } | undefined;
      if (r.response.ok && b && "plans" in b) {
        setData(b);
        setDone(editing === "new" ? `أُنشئت الباقة «${draft.name}»` : `حُفظت «${draft.name}»`);
        setEditing("");
      } else fail((b as { detail?: string } | undefined)?.detail ?? "", r.response.status);
    } finally {
      setBusy(false);
    }
  };

  const schedule = async (code: string, clear = false) => {
    setError("");
    setDone("");
    setBusy(true);
    try {
      const r = await platformApi().POST("/api/platform/plans/{code}/{action}", {
        params: { path: { code, action: "price" } },
        body: (clear
          ? { clear: true, reason: priceReason }
          : {
              monthly_minor: nextMonthly.trim() ? Number(toMinor(nextMonthly)) : null,
              yearly_minor: nextYearly.trim() ? Number(toMinor(nextYearly)) : null,
              effective_at: effective ? new Date(effective).toISOString() : "",
              reason: priceReason,
            }) as never,
      });
      const b = (r.data ?? r.error) as unknown as Payload | { detail?: string } | undefined;
      if (r.response.ok && b && "plans" in b) {
        setData(b);
        setDone(clear ? "أُلغي السعر المقبل" : "جُدول السعر الجديد بتاريخ سريانه");
        setPriceFor("");
        setNextMonthly("");
        setNextYearly("");
        setEffective("");
        setPriceReason("");
      } else fail((b as { detail?: string } | undefined)?.detail ?? "", r.response.status);
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied ? "permission_denied" : data ? "ready" : "loading";

  const form = (
    <form className="plt-ops plt-plan-form" onSubmit={(e) => void save(e)} noValidate>
      <div className="plt-ops__fields plt-ops__fields--3">
        {editing === "new" ? (
          <TextField
            label="الرمز"
            mono
            hint="لاتيني صغير — لا يتغيّر بعد الإنشاء"
            value={draft.code}
            onChange={(e) => set("code", e.target.value)}
          />
        ) : null}
        <TextField label="الاسم" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        <TextField
          label="الترتيب"
          mono
          inputMode="numeric"
          value={draft.order}
          onChange={(e) => set("order", e.target.value)}
        />
      </div>
      <TextAreaField
        label="الوصف"
        rows={2}
        value={draft.blurb}
        onChange={(e) => set("blurb", e.target.value)}
      />
      <div className="plt-ops__fields plt-ops__fields--3">
        <TextField
          label="السعر الشهري"
          mono
          inputMode="decimal"
          value={draft.monthly}
          onChange={(e) => set("monthly", e.target.value)}
        />
        <TextField
          label="السعر الربعي"
          mono
          inputMode="decimal"
          hint="0 = الدورة غير معروضة"
          value={draft.quarterly}
          onChange={(e) => set("quarterly", e.target.value)}
        />
        <TextField
          label="السعر السنوي"
          mono
          inputMode="decimal"
          hint="0 = الدورة غير معروضة"
          value={draft.yearly}
          onChange={(e) => set("yearly", e.target.value)}
        />
      </div>
      <div className="plt-ops__fields plt-ops__fields--4">
        <TextField
          label="الفروع"
          mono
          inputMode="numeric"
          value={draft.max_branches}
          onChange={(e) => set("max_branches", e.target.value)}
        />
        <TextField
          label="الأجهزة"
          mono
          inputMode="numeric"
          value={draft.max_devices}
          onChange={(e) => set("max_devices", e.target.value)}
        />
        <TextField
          label="المستخدمون"
          mono
          inputMode="numeric"
          hint="فارغ = بلا حدّ"
          value={draft.max_users}
          onChange={(e) => set("max_users", e.target.value)}
        />
        <TextField
          label="رسائل الحملات شهرياً"
          mono
          inputMode="numeric"
          value={draft.campaign_quota}
          onChange={(e) => set("campaign_quota", e.target.value)}
        />
      </div>
      <fieldset className="plt-features">
        <legend>الخصائص</legend>
        {(data?.features ?? []).map((f) => (
          <label key={f} className="plt-features__item">
            <input
              type="checkbox"
              checked={draft.features.includes(f)}
              disabled={f === "pos_core"}
              onChange={(e) =>
                set(
                  "features",
                  e.target.checked ? [...draft.features, f] : draft.features.filter((x) => x !== f),
                )
              }
            />
            <span>{FEATURE_LABELS[f] ?? f}</span>
          </label>
        ))}
      </fieldset>
      <div className="plt-ops__fields plt-ops__fields--3">
        <SwitchField
          label="معروضة"
          hint="غير المعروضة تختفي من الصفحة العامة والدفع ولا تكسر اشتراكاً قائماً"
          checked={draft.is_active}
          onChange={(v) => set("is_active", v)}
        />
        <SwitchField label="تجريبية" checked={draft.trial} onChange={(v) => set("trial", v)} />
        {draft.trial ? (
          <TextField
            label="أيام التجريبية"
            mono
            inputMode="numeric"
            value={draft.trial_days}
            onChange={(e) => set("trial_days", e.target.value)}
          />
        ) : null}
      </div>
      <TextAreaField
        label="سبب التغيير"
        hint="يُسجَّل باسمك في سجل الكتالوج"
        rows={2}
        value={draft.reason}
        onChange={(e) => set("reason", e.target.value)}
      />
      <div className="acc-actions plt-ops-row">
        <Button type="submit" loading={busy}>
          {editing === "new" ? "أنشئ الباقة" : "احفظ"}
        </Button>
        <Button variant="quiet" onClick={() => setEditing("")}>
          إلغاء
        </Button>
        {error ? <Status state="validation_error" label={error} /> : null}
      </div>
    </form>
  );

  return (
    <PlatformFrame current="plans">
      <div className="sys plt-frame" data-screen="PLT-16" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              الباقات والتسعير — ما تراه الصفحة العامة يُحرَّر هنا
            </h2>
            <span className="cat-head__hint">
              الاسم والسعر لكل دورة والحدود والخصائص لكل باقة، بسبب مسجَّل. تغيير السعر يمسّ
              التجديدات القادمة فقط، والسعر المعلن يُجدول بتاريخ سريان.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الكتالوج">
                <p className="acc-lead">الباقات كما تُعرض للمشتري والمستأجر، مع عدد المشتركين.</p>
              </Notice>
            ) : null}
            {denied ? (
              <Notice kind="warning" title="مساحة المشغّل فقط">
                <p className="acc-lead">الكتالوج يُحرَّر بصفة مشغّل.</p>
              </Notice>
            ) : null}
            {done ? <Status state="success" label={done} /> : null}
            {data ? (
              <>
                <ul className="plt-plans">
                  {data.plans.map((p) => (
                    <li key={p.code} className="plt-plan" data-active={p.is_active}>
                      <div className="plt-plan__top">
                        <div>
                          <strong className="plt-plan__name">{p.name}</strong>{" "}
                          <span className="plt-badge">{p.code}</span>
                        </div>
                        <Status
                          state={p.is_active ? "success" : "expired"}
                          label={p.is_active ? "معروضة" : "مؤرشفة"}
                        />
                      </div>
                      <div className="plt-plan__prices">
                        {p.trial ? (
                          <span>
                            مجاناً · <span className="sting-mono">{p.trial_days}</span> يوماً
                          </span>
                        ) : (
                          <>
                            <span>
                              شهري{" "}
                              <span className="sting-mono">{money(p.price_monthly_minor)}</span>
                            </span>
                            {p.price_quarterly_minor !== "0" ? (
                              <span>
                                ربعي{" "}
                                <span className="sting-mono">{money(p.price_quarterly_minor)}</span>
                              </span>
                            ) : null}
                            {p.price_yearly_minor !== "0" ? (
                              <span>
                                سنوي{" "}
                                <span className="sting-mono">{money(p.price_yearly_minor)}</span>
                              </span>
                            ) : null}
                          </>
                        )}
                      </div>
                      <div className="cus-sub">
                        <span className="sting-mono">{p.max_branches}</span> فروع ·{" "}
                        <span className="sting-mono">{p.max_devices}</span> أجهزة ·{" "}
                        {p.max_users === null ? (
                          "مستخدمون بلا حدّ"
                        ) : (
                          <>
                            <span className="sting-mono">{p.max_users}</span> مستخدمين
                          </>
                        )}{" "}
                        · <span className="sting-mono">{p.features.length}</span> خصائص ·{" "}
                        <span className="sting-mono">{p.subscribers}</span> مشترك
                      </div>
                      {p.next_price ? (
                        <p className="plt-plan__next">
                          <strong>سعر مقبل</strong> · من <When iso={p.next_price.effective_at} />
                          {p.next_price.monthly_minor ? (
                            <>
                              {" "}
                              · شهري{" "}
                              <span className="sting-mono">
                                {money(p.next_price.monthly_minor)}
                              </span>
                            </>
                          ) : null}
                          {p.next_price.yearly_minor ? (
                            <>
                              {" "}
                              · سنوي{" "}
                              <span className="sting-mono">{money(p.next_price.yearly_minor)}</span>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {editing === p.code ? (
                        form
                      ) : priceFor === p.code ? (
                        <div className="plt-ops plt-plan-form">
                          <div className="plt-ops__fields plt-ops__fields--3">
                            <TextField
                              label="الشهري الجديد"
                              mono
                              inputMode="decimal"
                              value={nextMonthly}
                              onChange={(e) => setNextMonthly(e.target.value)}
                            />
                            <TextField
                              label="السنوي الجديد"
                              mono
                              inputMode="decimal"
                              value={nextYearly}
                              onChange={(e) => setNextYearly(e.target.value)}
                            />
                            <TextField
                              label="تاريخ السريان"
                              type="date"
                              mono
                              hint={`بعد ${data.min_price_notice_days} يوماً على الأقل — إشعار الشروط`}
                              value={effective}
                              onChange={(e) => setEffective(e.target.value)}
                            />
                          </div>
                          <TextAreaField
                            label="السبب"
                            rows={2}
                            value={priceReason}
                            onChange={(e) => setPriceReason(e.target.value)}
                          />
                          <div className="acc-actions plt-ops-row">
                            <Button loading={busy} onClick={() => void schedule(p.code)}>
                              جدوِل السعر
                            </Button>
                            {p.next_price ? (
                              <Button
                                variant="secondary"
                                loading={busy}
                                onClick={() => void schedule(p.code, true)}
                              >
                                ألغِ السعر المقبل
                              </Button>
                            ) : null}
                            <Button variant="quiet" onClick={() => setPriceFor("")}>
                              إلغاء
                            </Button>
                            {error ? <Status state="validation_error" label={error} /> : null}
                          </div>
                        </div>
                      ) : (
                        <div className="acc-actions plt-ops-row">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setEditing(p.code);
                              setPriceFor("");
                              setDraft(fromPlan(p));
                              setError("");
                            }}
                          >
                            عدّل
                          </Button>
                          {!p.trial ? (
                            <Button
                              variant="quiet"
                              onClick={() => {
                                setPriceFor(p.code);
                                setEditing("");
                                setError("");
                              }}
                            >
                              سعر مقبل بتاريخ
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                {editing === "new" ? (
                  form
                ) : (
                  <div className="acc-actions plt-ops-row">
                    <Button
                      onClick={() => {
                        setEditing("new");
                        setPriceFor("");
                        setDraft(EMPTY);
                        setError("");
                      }}
                    >
                      باقة جديدة
                    </Button>
                  </div>
                )}

                <h3 className="cat-head__title">سجل التغييرات</h3>
                {data.changes.length ? (
                  <ol className="pb-timeline plt-timeline">
                    {data.changes.map((ch) => (
                      <li key={ch.id} className="pb-timeline__item">
                        <span className="pb-timeline__dot" aria-hidden="true" />
                        <span className="pb-timeline__at">
                          <When iso={ch.at} />
                        </span>
                        <span className="pb-timeline__text">
                          <strong>{ch.plan_code}</strong> ·{" "}
                          <span className="sting-mono plt-change">
                            {JSON.stringify(ch.changes)}
                          </span>
                          {ch.reason ? <div className="cus-sub">{ch.reason}</div> : null}
                          <div className="cus-sub">بواسطة {ch.by_name}</div>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="acc-choice__note">لا تغييرات بعد — الكتالوج كما بُذر.</p>
                )}
                <p className="acc-choice__note">{data.rule}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
