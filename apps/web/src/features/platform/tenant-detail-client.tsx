"use client";

import {
  Button,
  formatMinor,
  Notice,
  SelectField,
  Status,
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
import "@/features/org/org.css";
import "@/features/public/public.css";
import "@/features/market/market.css";
import "./platform.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";
import type { TenantRow } from "@/features/platform/tenants-client";

interface Detail extends TenantRow {
  entitlement: {
    plan_code: string;
    plan_label: string;
    state: string;
    started_at: string;
    expires_at: string;
    extra_features: string[];
    renewal_amount_minor: string;
    suspended: boolean;
    suspended_reason: string;
  };
  plans: { code: string; name: string; trial: boolean }[];
  usage?: { branches: UsageRow; devices: UsageRow; users: UsageRow };
  timeline: TimelineRow[];
  proofs: {
    id: string;
    status: string;
    amount_minor: string;
    reference: string;
    submitted_at: string;
  }[];
  devices_list: {
    id: string;
    name: string;
    branch: string;
    status: string;
    last_seen_at: string;
  }[];
  branches: number;
  users: number;
  storage: { operations: number };
  support_grants: {
    ticket_ref: string;
    hours: number;
    reason: string;
    granted_by_name: string;
    granted_at: string;
    expires_at: string;
    active: boolean;
  }[];
  limits: string[];
}

interface TimelineRow {
  id: string;
  kind: string;
  kind_label: string;
  days: number;
  from_plan: string;
  to_plan: string;
  expires_after: string;
  reason: string;
  by_name: string;
  at: string;
}

type OpAction = "extend" | "plan" | "suspend" | "resume" | "note" | "limits";

interface UsageRow {
  used: number;
  max: number | null;
  plan: number | null;
  extra: number;
  addon?: number;
}

/** أسباب الرفض من الخادم بنصّ للمشغّل */
const OP_ERRORS: Record<string, string> = {
  reason_required: "السبب مطلوب — يُسجَّل في تدقيق المستأجر.",
  limits_invalid: "الزيادة رقم بين 0 و100.",
  nothing_to_change: "لا تغيير عن الزيادات الحالية.",
  days_out_of_range: "الأيام بين 1 و365.",
  unknown_plan: "باقة غير معروفة.",
  same_plan: "المستأجر على هذه الباقة أصلاً.",
  trial_not_reassignable: "لا تُعاد التجريبية بعد باقة مدفوعة.",
  already_suspended: "الاشتراك موقوف أصلاً.",
  not_suspended: "الاشتراك ليس موقوفاً.",
};

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

/** PLT-02/detail — تفاصيل الاستحقاق والحالة التقنية؛ كل فتح يُدقَّق؛ لا مبيعات ولا عملاء. */
export function TenantDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [denied, setDenied] = useState(false);
  // PLT-13: التصرّف في الاشتراك — تبويب واحد مفتوح، سبب إلزامي، ونتيجة كل تصرّف تُعرض
  const [op, setOp] = useState<OpAction>("extend");
  const [days, setDays] = useState("30");
  const [planCode, setPlanCode] = useState("");
  const [reason, setReason] = useState("");
  // 0005 §١١٤ — زيادات فوق حدود الباقة
  const [extraBranches, setExtraBranches] = useState("0");
  const [extraDevices, setExtraDevices] = useState("0");
  const [extraUsers, setExtraUsers] = useState("0");
  const [saving, setSaving] = useState(false);
  const [opError, setOpError] = useState("");
  const [opDone, setOpDone] = useState("");

  const load = useCallback(async () => {
    const { data, response } = await platformApi().GET("/api/platform/tenants/{tenant_id}", {
      params: { path: { tenant_id: id } },
    });
    if (response.status === 403 || response.status === 401) {
      setDenied(true);
      return;
    }
    const body = data as unknown as { tenant: Detail } | undefined;
    if (response.ok && body) setD(body.tenant);
  }, [id]);

  useEffect(() => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    void load().catch(() => undefined);
  }, [load, router]);

  const submitOp = async (e: FormEvent) => {
    e.preventDefault();
    if (!d) return;
    setOpError("");
    setOpDone("");
    if (!reason.trim()) {
      setOpError(OP_ERRORS.reason_required ?? "");
      return;
    }
    setSaving(true);
    try {
      const r = await platformApi().POST("/api/platform/tenants/{tenant_id}/subscription", {
        params: { path: { tenant_id: id } },
        body: {
          action: op,
          reason,
          ...(op === "extend" ? { days: Number(days) } : {}),
          ...(op === "plan" ? { plan_code: planCode } : {}),
          ...(op === "limits"
            ? {
                extra_branches: Number(extraBranches || 0),
                extra_devices: Number(extraDevices || 0),
                extra_users: Number(extraUsers || 0),
              }
            : {}),
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { tenant: Detail; detail?: string } | { detail?: string } | undefined;
      if (r.response.ok && b && "tenant" in b) {
        setD(b.tenant);
        setReason("");
        setOpDone(
          op === "extend"
            ? `مُدِّد ${days} يوماً`
            : op === "plan"
              ? "غُيِّرت الباقة"
              : op === "limits"
                ? "حُفظت الزيادات"
                : op === "suspend"
                  ? "أُوقف الاشتراك"
                  : op === "resume"
                    ? "استُؤنف الاشتراك"
                    : "سُجِّلت الملاحظة",
        );
      } else {
        const code = b?.detail ?? "";
        setOpError(OP_ERRORS[code] ?? `تعذّر التنفيذ (${code || r.response.status})`);
      }
    } finally {
      setSaving(false);
    }
  };

  const state = denied ? "permission_denied" : d ? "ready" : "loading";
  const suspended = Boolean(d?.entitlement.suspended);
  const opLabel: Record<OpAction, string> = {
    extend: "تمديد",
    plan: "تغيير الباقة",
    suspend: "إيقاف",
    resume: "استئناف",
    note: "ملاحظة",
    limits: "زيادة الحدود",
  };

  return (
    <PlatformFrame current="tenants">
      <div className="sys mp cus plt-frame" data-screen="PLT-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تفاصيل الاستحقاق — القائمة لا تكشف دفاتر</h2>
            <span className="cat-head__hint">
              المشغّل يرى حالة الاشتراك والاستخدام التقني. لا يرى مبيعات ولا أسماء زبائن ولا أرصدة
              ذمم.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب المستأجرين">
                <p className="acc-lead">مع العدد الإجمالي وحالة الاستحقاق — سبب فتح الشاشة.</p>
              </Notice>
            ) : null}
            {denied ? (
              <Notice kind="warning" title="المشغّل لا يرى دفاتر التجّار">
                <p className="acc-lead">
                  يرى الاستحقاق والباقة وتاريخ الدفع، ولا يرى مبيعات المستأجر ولا عملاءه ولا أصنافه.
                </p>
              </Notice>
            ) : null}
            {d ? (
              <>
                <div className="cus-head">
                  <div className="acc-actions">
                    <Status
                      state={
                        d.status === "active"
                          ? "success"
                          : d.status === "expired"
                            ? "expired"
                            : d.status === "suspended"
                              ? "permission_denied"
                              : "stale"
                      }
                      label={d.status_label}
                    />
                    <span className="plt-badge">حدود وصول</span>
                  </div>
                  <h3 className="cat-head__title">{d.name}</h3>
                  <div className="cus-sub">
                    {d.entitlement.plan_label} · {d.due_line} · {d.branches}{" "}
                    {d.branches === 1 ? "فرع" : d.branches === 2 ? "فرعان" : "فروع"} ·{" "}
                    <span className="sting-mono">{d.users}</span> مستخدمين
                  </div>
                </div>
                <div className="home-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">الباقة والاستحقاق</div>
                    <div className="home-kpi__value">{d.entitlement.plan_label}</div>
                    <div className="home-kpi__note">
                      حتى <When iso={d.entitlement.expires_at} /> · التجديد{" "}
                      <span className="sting-mono">
                        {formatMinor(d.entitlement.renewal_amount_minor)}
                      </span>
                    </div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">أجهزة</div>
                    <div className="home-kpi__value sting-mono">{d.devices}</div>
                    <div className="home-kpi__note">{d.technical}</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">حجم التخزين</div>
                    <div className="home-kpi__value sting-mono">{d.storage.operations}</div>
                    <div className="home-kpi__note">عملية مزامنة مخزَّنة — لا محتواها</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">وصول الدعم</div>
                    <div className="home-kpi__value">{d.support_access}</div>
                    <div className="home-kpi__note">بإذن مؤقت من المالك يُسجَّل في تدقيقه</div>
                  </div>
                </div>
                {suspended ? (
                  <Notice kind="error" title="الاشتراك موقوف">
                    <p className="acc-lead">
                      {d.entitlement.suspended_reason} — الميزات المدفوعة متوقفة، والبيع والقراءة
                      والتصدير مستمرة عند المستأجر.
                    </p>
                  </Notice>
                ) : null}

                {d.usage ? (
                  <>
                    <h3 className="cat-head__title">الاستعمال مقابل الحدود</h3>
                    <ul className="plt-usage">
                      {(
                        [
                          ["branches", "الفروع"],
                          ["devices", "الأجهزة"],
                          ["users", "المستخدمون"],
                        ] as const
                      ).map(([k, label]) => {
                        const u = d.usage![k];
                        const pct = u.max ? Math.min(100, Math.round((u.used / u.max) * 100)) : 0;
                        const tone =
                          u.max !== null && u.used >= u.max ? "full" : pct >= 80 ? "near" : "ok";
                        return (
                          <li key={k} className="plt-usage__row" data-tone={tone}>
                            <div className="plt-usage__top">
                              <strong>{label}</strong>
                              <span>
                                <span className="sting-mono">{u.used}</span> /{" "}
                                {u.max === null ? (
                                  "بلا حدّ"
                                ) : (
                                  <span className="sting-mono">{u.max}</span>
                                )}
                                {u.extra ? (
                                  <>
                                    {" "}
                                    (منها <span className="sting-mono">{u.extra}</span> إضافية)
                                  </>
                                ) : null}
                                {u.addon ? (
                                  <>
                                    {" "}
                                    (منها <span className="sting-mono">{u.addon}</span> مدفوعة)
                                  </>
                                ) : null}
                              </span>
                            </div>
                            {u.max !== null ? (
                              <div className="plt-usage__bar" aria-hidden="true">
                                <span style={{ inlineSize: `${pct}%` }} />
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : null}

                <h3 className="cat-head__title">إدارة الاشتراك — كل تصرّف بسبب يراه المالك</h3>
                <form className="plt-ops" onSubmit={(e) => void submitOp(e)} noValidate>
                  <div className="plt-ops__tabs" role="tablist" aria-label="نوع التصرّف">
                    {(
                      [
                        "extend",
                        "plan",
                        "limits",
                        suspended ? "resume" : "suspend",
                        "note",
                      ] as OpAction[]
                    ).map((a) => (
                      <button
                        key={a}
                        type="button"
                        role="tab"
                        aria-selected={op === a}
                        className={`plt-ops__tab${op === a ? " plt-ops__tab--on" : ""}`}
                        onClick={() => {
                          setOp(a);
                          setOpError("");
                          setOpDone("");
                        }}
                      >
                        {opLabel[a]}
                      </button>
                    ))}
                  </div>
                  <div className="plt-ops__fields">
                    {op === "extend" ? (
                      <TextField
                        label="أيام التمديد"
                        hint="من تاريخ الانتهاء القائم إن لم يمضِ، وإلا من اليوم"
                        type="number"
                        min={1}
                        max={365}
                        inputMode="numeric"
                        className="sting-mono"
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                      />
                    ) : null}
                    {op === "plan" ? (
                      <SelectField
                        label="الباقة الجديدة"
                        hint="الأثر فوري على الاستحقاق؛ التاريخ لا يتغيّر — التمديد تصرّف منفصل"
                        value={planCode}
                        onChange={(e) => setPlanCode(e.target.value)}
                        options={[
                          { value: "", label: "اختر…" },
                          ...d.plans
                            .filter((p) => p.code !== d.entitlement.plan_code)
                            .map((p) => ({ value: p.code, label: p.name })),
                        ]}
                      />
                    ) : null}
                    {op === "limits" ? (
                      <div className="plt-ops__fields plt-ops__fields--3 plt-limits">
                        <TextField
                          label="فروع إضافية"
                          mono
                          inputMode="numeric"
                          hint={`الباقة ${d.usage?.branches.plan ?? "—"}`}
                          value={extraBranches}
                          onChange={(e) => setExtraBranches(e.target.value)}
                        />
                        <TextField
                          label="أجهزة إضافية"
                          mono
                          inputMode="numeric"
                          hint={`الباقة ${d.usage?.devices.plan ?? "—"}`}
                          value={extraDevices}
                          onChange={(e) => setExtraDevices(e.target.value)}
                        />
                        <TextField
                          label="مستخدمون إضافيون"
                          mono
                          inputMode="numeric"
                          hint={`الباقة ${d.usage?.users.plan ?? "بلا حدّ"}`}
                          value={extraUsers}
                          onChange={(e) => setExtraUsers(e.target.value)}
                        />
                      </div>
                    ) : null}
                    {op === "suspend" ? (
                      <p className="acc-choice__note">
                        الإيقاف يوقف الميزات المدفوعة فقط (كالانتهاء بعد المهلة). لا يحجب الدفتر ولا
                        البيع النقدي ولا التصدير. المالك يرى السبب في شاشة اشتراكه وفي تدقيقه.
                      </p>
                    ) : null}
                    <TextAreaField
                      label={op === "note" ? "الملاحظة" : "السبب"}
                      hint="يُسجَّل باسمك ووقته في سجل المنصة وفي تدقيق المستأجر"
                      required
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <div className="acc-actions">
                    <Button
                      type="submit"
                      loading={saving}
                      variant={op === "suspend" ? "danger" : "primary"}
                    >
                      {op === "suspend"
                        ? "أوقف الاشتراك"
                        : op === "resume"
                          ? "استأنف الاشتراك"
                          : op === "extend"
                            ? "مدّد"
                            : op === "plan"
                              ? "غيّر الباقة"
                              : op === "limits"
                                ? "احفظ الزيادات"
                                : "سجّل الملاحظة"}
                    </Button>
                    {opDone ? <Status state="success" label={opDone} /> : null}
                    {opError ? <Status state="validation_error" label={opError} /> : null}
                  </div>
                </form>

                <h3 className="cat-head__title">سجل الاشتراك</h3>
                <ol className="pb-timeline plt-timeline">
                  {d.timeline.map((e) => (
                    <li key={e.id} className="pb-timeline__item" data-kind={e.kind}>
                      <span className="pb-timeline__dot" aria-hidden="true" />
                      <span className="pb-timeline__at">
                        <When iso={e.at} />
                      </span>
                      <span className="pb-timeline__text">
                        <strong>{e.kind_label}</strong>
                        {e.kind === "extend" || e.kind === "proof_approved" ? (
                          <>
                            {" "}
                            <span className="sting-mono">{e.days}</span> يوماً
                          </>
                        ) : null}
                        {e.kind === "plan_change" ? (
                          <>
                            {" "}
                            {e.from_plan} ← {e.to_plan}
                          </>
                        ) : null}
                        {e.kind === "start" ? <> — {e.to_plan}</> : null}
                        {e.reason ? <div className="cus-sub">{e.reason}</div> : null}
                        {e.by_name ? <div className="cus-sub">بواسطة {e.by_name}</div> : null}
                      </span>
                    </li>
                  ))}
                </ol>

                <h3 className="cat-head__title">الأجهزة — الحالة التقنية</h3>
                <ul className="cus-list">
                  {d.devices_list.map((dev) => (
                    <li key={dev.id}>
                      <strong>{dev.name}</strong>
                      <div className="cus-sub">
                        {dev.branch} · آخر ظهور <When iso={dev.last_seen_at} />
                      </div>
                      <Status
                        state={dev.status === "active" ? "success" : "expired"}
                        label={dev.status}
                      />
                    </li>
                  ))}
                  {d.devices_list.length === 0 ? <li>لا أجهزة مسجَّلة بعد.</li> : null}
                </ul>
                <h3 className="cat-head__title">إيصالات الاشتراك</h3>
                <ul className="cus-list">
                  {d.proofs.map((p) => (
                    <li key={p.id}>
                      <strong className="sting-mono">{p.reference}</strong>
                      <div className="cus-sub">
                        <span className="sting-mono">{formatMinor(p.amount_minor)}</span> ·{" "}
                        <When iso={p.submitted_at} />
                      </div>
                      <Status
                        state={
                          p.status === "approved"
                            ? "success"
                            : p.status === "rejected"
                              ? "expired"
                              : "stale"
                        }
                        label={p.status}
                      />
                    </li>
                  ))}
                  {d.proofs.length === 0 ? <li>لا إيصالات.</li> : null}
                </ul>
                <h3 className="cat-head__title">وصول الدعم — بتذكرة من المالك</h3>
                <ul className="cus-list">
                  {d.support_grants.map((g) => (
                    <li key={`${g.ticket_ref}-${g.granted_at}`}>
                      <strong className="sting-mono">{g.ticket_ref}</strong>
                      <div className="cus-sub">
                        {g.reason} · <span className="sting-mono">{g.hours}</span> ساعة · منحه{" "}
                        {g.granted_by_name} · حتى <When iso={g.expires_at} />
                      </div>
                      <Status
                        state={g.active ? "success" : "expired"}
                        label={g.active ? "فعّال" : "منتهٍ"}
                      />
                    </li>
                  ))}
                  {d.support_grants.length === 0 ? (
                    <li>لا وصول فعّال — القراءة تحتاج تذكرة من المالك.</li>
                  ) : null}
                </ul>
                <h3 className="cat-head__title">حد الوصول</h3>
                <ul className="pub-list">
                  {d.limits.map((t) => (
                    <li key={t}>
                      <span className="pub-mark">لا</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/platform/tenants")}>المستأجرون</Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
