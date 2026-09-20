"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "@/features/market/market.css";
import "./platform.css";
import { agoParts, dayMonth } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformNav } from "@/features/platform/platform-nav";

type State = "ready" | "validation_error" | "conflict" | "success";

interface Proof {
  id: string;
  tenant_id: string;
  tenant_name: string;
  plan_code: string;
  plan_label: string;
  amount_minor: string;
  due_minor: string;
  shortfall_minor: string;
  reference: string;
  period_label: string;
  note: string;
  has_image: boolean;
  image_name: string;
  submitted_at: string;
  submitted_by_name: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string;
  reviewed_by_name: string;
  rejection_reason: string;
  claim: {
    by_name: string;
    mine: boolean;
    claimed_at: string;
    expires_at: string;
    minutes_ago: number;
    handover_requested: boolean;
  } | null;
  reference_used: {
    approved_at: string;
    approved_by_name: string;
    same_tenant: boolean;
    tenant_name: string;
  } | null;
}

interface Payload {
  proofs: Proof[];
  pending_count: number;
  claim_minutes: number;
}

const agoWord = (iso: string) => {
  const { n, unit } = agoParts(iso);
  if (unit === "minute")
    return n <= 1
      ? "قبل دقيقة"
      : n === 2
        ? "قبل دقيقتين"
        : n <= 10
          ? `قبل ${n} دقائق`
          : `قبل ${n} دقيقة`;
  if (unit === "hour")
    return n === 1
      ? "قبل ساعة"
      : n === 2
        ? "قبل ساعتين"
        : n <= 10
          ? `قبل ${n} ساعات`
          : `قبل ${n} ساعة`;
  return n === 1 ? "قبل يوم" : n === 2 ? "قبل يومين" : `قبل ${n} أيام`;
};
const dm = (iso: string) => {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}
    </>
  );
};

/** PLT-03 — مراجعة دفع اشتراك (18-D13 conflict/success · 39-D31 ready/validation_error): الازدواج يُمنع قبل الاعتماد لا بعده. */
export function ProofsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [current, setCurrent] = useState<Proof | null>(null);
  const [image, setImage] = useState<{ name: string; data: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; extra: Record<string, string> } | null>(null);
  const [decided, setDecided] = useState<Proof | null>(null);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/proofs", {
      params: { query: { status: "pending" } },
    });
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) setData(body);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const act = async (p: Proof, action: "open" | "image" | "handover" | "approve" | "reject") => {
    if (busy) return;
    setBusy(action);
    setErr(null);
    try {
      const r = await platformApi().POST("/api/platform/proofs/{tenant_id}/{proof_id}/{action}", {
        params: { path: { tenant_id: p.tenant_id, proof_id: p.id, action } },
        body: { reason } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        | { proof: Proof }
        | { image_name: string; image_data: string }
        | { detail?: string; extra?: Record<string, unknown> }
        | undefined;
      if (r.response.ok && b && "proof" in b) {
        setCurrent(b.proof);
        if (action === "approve" || action === "reject") {
          setDecided(b.proof);
          await load();
        }
        return;
      }
      if (r.response.ok && b && "image_data" in b) {
        setImage({ name: b.image_name, data: b.image_data });
        return;
      }
      const e = b as { detail?: string; extra?: Record<string, unknown> } | undefined;
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(e?.extra ?? {}))
        extra[k] =
          typeof v === "string"
            ? v
            : typeof v === "number"
              ? String(v)
              : typeof v === "boolean"
                ? v
                  ? "1"
                  : ""
                : "";
      setErr({ code: e?.detail ?? "server_error", extra });
    } finally {
      setBusy("");
    }
  };

  const conflict =
    Boolean(current?.claim && !current.claim.mine) || err?.code === "claimed_by_other";
  const state: State = decided
    ? "success"
    : err && err.code !== "claimed_by_other"
      ? "validation_error"
      : conflict
        ? "conflict"
        : "ready";

  return (
    <Frame title="إدارة Sting" navLayout="top" nav={<PlatformNav current="proofs" />} footer={null}>
      <div className="sys mp cus plt-frame" data-screen="PLT-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              مراجعة دفع اشتراك — الازدواج يُمنع قبل الاعتماد لا بعده
            </h2>
            <span className="cat-head__hint">
              التحويل اليدوي يصل بإيصال مصوّر. الخطر الحقيقي: اعتماد الإيصال نفسه مرتين من مراجعَين
              مختلفَين.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && decided ? (
              <Notice
                kind="success"
                title={decided.status === "approved" ? "اعتُمد الإيصال" : "رُفض الإيصال بسبب"}
                action={
                  <Button
                    onClick={() => {
                      setDecided(null);
                      setCurrent(null);
                      setImage(null);
                      setReason("");
                    }}
                  >
                    التالي
                  </Button>
                }
              >
                <p className="acc-lead">
                  {decided.status === "approved"
                    ? "الاعتماد يكتب مدة الاشتراك مرة واحدة. محاولة ثانية على نفس الإيصال تُرفض ولا تُمدِّد شهراً إضافياً."
                    : "الرفض لا يوقف الخدمة فوراً: للتاجر مهلة معلنة لتصحيح الإيصال، والتعطيل يأتي بإشعار سابق لا مفاجأة."}
                </p>
                <p className="acc-choice__note">
                  <span className="sting-mono">{decided.reference}</span> · {decided.tenant_name} ·{" "}
                  {decided.reviewed_by_name}
                  {decided.rejection_reason ? ` — ${decided.rejection_reason}` : ""}
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" && err ? (
              <Notice
                kind="warning"
                title={
                  err.code === "reference_used"
                    ? "رقم التحويل مستخدم"
                    : err.code === "reason_required"
                      ? "الرفض يحتاج سبباً يقرأه التاجر"
                      : "لم يُنفَّذ"
                }
              >
                <p className="acc-lead">
                  {err.code === "reference_used"
                    ? "نفس المرجع استُعمل لاعتماد دفعة سابقة."
                    : err.code === "reason_required"
                      ? "الرفض لا يوقف الخدمة فوراً: للتاجر مهلة معلنة لتصحيح الإيصال، والتعطيل يأتي بإشعار سابق لا مفاجأة."
                      : err.code === "already_reviewed"
                        ? "الاعتماد يكتب مدة الاشتراك مرة واحدة. محاولة ثانية على نفس الإيصال تُرفض ولا تُمدِّد شهراً إضافياً."
                        : err.code}
                </p>
                {err.code === "reference_used" ? (
                  <p className="acc-choice__note">
                    <strong>نُظهر السابقة</strong> · بتاريخها ومستأجرها — بلا اسمه إن كان مستأجراً
                    آخر. المراجع يحتاج أن يعرف أنها مستهلكة لا لمن. اعتُمدت{" "}
                    {err.extra.approved_at ? dm(err.extra.approved_at) : "—"} بيد{" "}
                    {err.extra.approved_by_name ?? ""} ·{" "}
                    {err.extra.same_tenant ? "المستأجر نفسه" : "مستأجر آخر"}
                  </p>
                ) : null}
              </Notice>
            ) : null}
            {state === "conflict" && current?.claim ? (
              <Notice kind="warning" title="هذا الإيصال مراجَع الآن من زميل">
                <p className="acc-lead">
                  فتحه «{current.claim.by_name}»{" "}
                  {current.claim.minutes_ago === 0 ? "الآن" : agoWord(current.claim.claimed_at)}. لن
                  نسمح باعتمادين متوازيين ينتجان شهرين مدفوعين بإيصال واحد.
                </p>
                <p className="acc-choice__note">
                  المراجعة تُحجز لشخص واحد مدة 15 دقيقة، ويظهر اسمه لبقية الفريق.
                </p>
                <div className="acc-actions">
                  <Button disabledReason={`محجوز لـ${current.claim.by_name}`}>
                    اعتماد — محجوز لزميل
                  </Button>
                  <Button
                    loading={busy === "handover"}
                    onClick={() => void act(current, "handover")}
                    disabledReason={current.claim.handover_requested ? "طُلب التسليم" : undefined}
                  >
                    طلب تسليم المراجعة
                  </Button>
                </div>
              </Notice>
            ) : null}

            {!current && data ? (
              <>
                <p className="acc-choice__note">
                  <strong>الإثبات ومطابقته</strong> · صورة التحويل ورقمه وتاريخه، بجانب المستحقّ
                  والباقة. والمطابقة يدوية بقرار لا آلية. <strong>لا قبول آلي</strong> · مطابقة
                  المبلغ وحدها لا تكفي — قد يكون تحويلاً لغرض آخر أو مستهلكاً سابقاً (ACC-15).
                </p>
                <h3 className="cat-head__title">مراجعة دفع الاشتراك</h3>
                <p className="acc-choice__note">
                  إيصالات بانتظار المراجعة —{" "}
                  <span className="sting-mono">{data.pending_count}</span>
                </p>
                {data.proofs.length === 0 ? (
                  <p className="acc-choice__note">لا إيصالات بانتظار المراجعة.</p>
                ) : null}
                <ul className="cus-list">
                  {data.proofs.map((p) => (
                    <li key={p.id}>
                      <Button
                        variant="quiet"
                        loading={busy === "open"}
                        onClick={() => void act(p, "open")}
                      >
                        {p.tenant_name} · <span className="sting-mono">{p.reference}</span>
                      </Button>
                      <div className="cus-sub">
                        وصل {agoWord(p.submitted_at)} ·{" "}
                        <span className="sting-mono">{formatMinor(p.amount_minor)}</span> على{" "}
                        {p.plan_label}
                        {p.reference_used ? " · رقم العملية مستخدم" : ""}
                      </div>
                      {p.claim ? (
                        <Status
                          state="stale"
                          label={p.claim.mine ? "محجوز لك" : `يراجعه ${p.claim.by_name}`}
                        />
                      ) : (
                        <Status state="synced" label="إيصال بانتظار المراجعة" />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {current ? (
              <>
                <div className="acc-actions">
                  {conflict ? <Status state="conflict" label="تعارض" /> : null}
                  <Status
                    state={
                      decided ? (decided.status === "approved" ? "success" : "expired") : "stale"
                    }
                    label={
                      decided
                        ? decided.status === "approved"
                          ? "اعتُمد"
                          : "رُفض"
                        : "إيصال بانتظار المراجعة"
                    }
                  />
                </div>
                <h3 className="cat-head__title">
                  {current.tenant_name} · وصل {agoWord(current.submitted_at)}
                </h3>
                <dl className="mp-preview">
                  <dt>المبلغ في الإيصال</dt>
                  <dd className="sting-mono">{formatMinor(current.amount_minor)}</dd>
                  <dt>المستحق على الباقة</dt>
                  <dd>
                    <span className="sting-mono">{formatMinor(current.due_minor)}</span> ·{" "}
                    {current.plan_label}
                    {Number(current.shortfall_minor) > 0 ? (
                      <div className="mp-reason">
                        المبلغ أقل من المستحق — الفرق{" "}
                        <span className="sting-mono">{formatMinor(current.shortfall_minor)}</span>{" "}
                        ويبقى الإيصال مرفقاً.
                      </div>
                    ) : null}
                  </dd>
                  <dt>تاريخ التحويل</dt>
                  <dd>{dm(current.submitted_at)}</dd>
                  <dt>رقم العملية البنكية</dt>
                  <dd>
                    <span className="sting-mono">{current.reference}</span>
                    {current.reference_used ? (
                      <div className="mp-reason">
                        رقم العملية مستعمل سابقاً — اعتُمد {dm(current.reference_used.approved_at)}{" "}
                        بيد {current.reference_used.approved_by_name} ·{" "}
                        {current.reference_used.same_tenant ? "المستأجر نفسه" : "مستأجر آخر"}
                      </div>
                    ) : null}
                  </dd>
                </dl>
                <h3 className="cat-head__title">صورة الإيصال</h3>
                <p className="acc-choice__note">
                  معاينة بحجم كامل وتكبير — لا تُحمَّل إلا عند فتح المراجعة، وتُسجَّل كل مشاهدة في
                  الأثر
                </p>
                {image ? (
                  <img
                    src={image.data}
                    alt={`إيصال ${current.reference}`}
                    style={{ maxInlineSize: "100%" }}
                  />
                ) : (
                  <div className="acc-actions">
                    <Button
                      loading={busy === "image"}
                      onClick={() => void act(current, "image")}
                      disabledReason={current.has_image ? undefined : "لم يُرفق التاجر صورة"}
                    >
                      افتح الصورة — تُسجَّل المشاهدة
                    </Button>
                  </div>
                )}
                <p className="acc-choice__note">
                  رقم العملية البنكية يُفحص قبل الاعتماد؛ لو اعتُمد سابقاً لأي متجر نوقف الإجراء
                  ونعرض الاعتماد الأول بتاريخه ومن نفّذه. الاعتماد يكتب مدة الاشتراك مرة واحدة.
                  محاولة ثانية على نفس الإيصال تُرفض ولا تُمدِّد شهراً إضافياً.
                </p>
                <p className="acc-choice__note">
                  <strong>الرفض يحتاج سبباً يقرأه التاجر</strong> · الرفض لا يوقف الخدمة فوراً:
                  للتاجر مهلة معلنة لتصحيح الإيصال، والتعطيل يأتي بإشعار سابق لا مفاجأة.
                </p>
                <TextField
                  label="سبب الرفض"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  hint="المبلغ أقل من المستحق — نذكر الفرق بالرقم ونبقي الإيصال مرفقاً. الصورة غير مقروءة — نطلب صورة أوضح ولا نتهم التاجر بالتزوير. رقم العملية مستعمل سابقاً — نعرض للتاجر تاريخ استعماله لأنه قد يكون أخطأ في الإرفاق."
                />
                {decided ? null : !conflict ? (
                  <div className="acc-actions">
                    <Button
                      pos
                      loading={busy === "approve"}
                      onClick={() => void act(current, "approve")}
                      disabledReason={
                        current.reference_used ? "رقم التحويل مستخدم — لا اعتماد" : undefined
                      }
                    >
                      اعتماد
                    </Button>
                    <Button
                      loading={busy === "reject"}
                      onClick={() => void act(current, "reject")}
                      disabledReason={reason.trim() ? undefined : "الرفض يحتاج سبباً يقرأه التاجر"}
                    >
                      رفض بسبب
                    </Button>
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setCurrent(null);
                        setImage(null);
                      }}
                    >
                      رجوع
                    </Button>
                  </div>
                ) : (
                  <div className="acc-actions">
                    <Button
                      variant="quiet"
                      onClick={() => {
                        setCurrent(null);
                        setImage(null);
                        setErr(null);
                      }}
                    >
                      رجوع
                    </Button>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
