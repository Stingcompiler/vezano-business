"use client";

import { Button, Notice, Status, TextField } from "@sting/ui-web";
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
import { agoParts } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "empty" | "validation_error" | "success";

interface Req {
  tenant_id: string;
  name: string;
  docs_line: string;
  status: "pending" | "needs_more" | "verified" | "rejected";
  status_label: string;
  note: string;
  reasons: Record<string, string>;
  submitted_at: string;
  waiting_hours: number;
  reviewed_at: string;
  reviewer_name: string;
  has_doc: boolean;
  doc_name: string;
  checklist: { key: string; title: string; done: boolean; reason: string }[];
}

interface Payload {
  requests: Req[];
  pending_count: number;
  oldest_waiting_hours: number;
  avg_review_hours_week: number;
  badge_text: string;
}

const hoursUnit = (h: number) =>
  h === 1 ? "ساعة" : h === 2 ? "ساعتان" : h <= 10 ? "ساعات" : "ساعة";
const agoWord = (iso: string) => {
  const { n, unit } = agoParts(iso);
  if (unit === "minute") return n <= 1 ? "قبل دقيقة" : `قبل ${n} دقيقة`;
  if (unit === "hour") return n === 1 ? "قبل ساعة" : n === 2 ? "قبل ساعتين" : `قبل ${n} ساعات`;
  return n === 1 ? "قبل يوم" : n === 2 ? "قبل يومين" : `قبل ${n} أيام`;
};
const STATUS_STATE = {
  pending: "stale",
  needs_more: "partial",
  verified: "success",
  rejected: "expired",
} as const;

/** PLT-06 — طلبات تحقق منشآت السوق (18-D13 · 39-D31): الشارة هوية لا تزكية؛ لا رفض بلا سبب محدّد. */
export function VerificationsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [current, setCurrent] = useState<Req | null>(null);
  const [doc, setDoc] = useState<{ name: string; data: string } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonKey, setReasonKey] = useState("registry_doc");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [decided, setDecided] = useState<Req | null>(null);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/verifications");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const act = async (
    r: Req,
    action: "document" | "decide",
    decision?: "verified" | "needs_more" | "rejected",
  ) => {
    if (busy) return;
    setBusy(decision ?? action);
    setErr("");
    try {
      const reasons = reason.trim() ? { [reasonKey]: reason.trim() } : undefined;
      const res = await platformApi().POST("/api/platform/verifications/{tenant_id}/{action}", {
        params: { path: { tenant_id: r.tenant_id, action } },
        body: { decision, reasons } as never,
      });
      const b = (res.data ?? res.error) as unknown as
        { doc_name: string; doc_data: string } | { request: Req } | { detail?: string } | undefined;
      if (res.response.ok && b && "doc_data" in b) {
        setDoc({ name: b.doc_name, data: b.doc_data });
        return;
      }
      if (res.response.ok && b && "request" in b) {
        setDecided(b.request);
        setCurrent(b.request);
        await load();
        return;
      }
      setErr((b as { detail?: string } | undefined)?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const state: State = !data
    ? "loading"
    : decided
      ? "success"
      : err
        ? "validation_error"
        : data.pending_count === 0 && !current
          ? "empty"
          : "ready";

  return (
    <PlatformFrame current="verifications">
      <div className="sys mp cus plt-frame" data-screen="PLT-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              طلبات التحقُّق وتشغيل الإرسال — ما تعنيه الشارة بالضبط
            </h2>
            <span className="cat-head__hint">
              الشارة تقول «تحقّقنا من وجود المنشأة ومن هوية مالكها». لا تقول إن بضاعته جيدة ولا إنه
              يوفي بوعوده.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الطلبات">
                <p className="acc-lead">
                  مع أقدم طلب منتظر — فالانتظار الطويل هنا يعطّل تاجراً عن البيع.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && data ? (
              <Notice kind="success" title="لا طلبات">
                <p className="acc-lead">كل الطلبات روجعت. نعرض متوسط زمن المراجعة كمقياس خدمة.</p>
                <p className="acc-choice__note">
                  <strong>المقياس لا التهنئة</strong> · «لا طلبات · متوسط المراجعة{" "}
                  <span className="sting-mono">{data.avg_review_hours_week}</span>{" "}
                  {hoursUnit(data.avg_review_hours_week)} هذا الأسبوع» — رقمٌ يُحاسَب عليه المشغّل.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice
                kind="warning"
                title={err === "reasons_required" ? "مستند غير مقروء" : "لم يُنفَّذ"}
              >
                <p className="acc-lead">
                  {err === "reasons_required"
                    ? "الصورة مشوّشة أو مقطوعة الأطراف."
                    : err === "not_pending"
                      ? "الطلب محسوم من قبل — لا قرار ثانٍ عليه."
                      : err}
                </p>
                {err === "reasons_required" ? (
                  <p className="acc-choice__note">
                    <strong>لا رفض</strong> · نطلب إعادة الرفع بسبب محدّد: «الطرف الأيسر مقطوع».
                    الرفض يُعيد التاجر إلى أول الطابور بلا ذنب.
                  </p>
                ) : null}
              </Notice>
            ) : null}
            {state === "success" && decided ? (
              <Notice
                kind="success"
                title={
                  decided.status === "verified"
                    ? "تُحقّق من المنشأة"
                    : decided.status === "needs_more"
                      ? "أُعيد الطلب للتاجر بسبب محدّد"
                      : "رُفض الطلب مع بيان السبب"
                }
                action={
                  <Button
                    onClick={() => {
                      setDecided(null);
                      setCurrent(null);
                      setDoc(null);
                      setReason("");
                    }}
                  >
                    التالي
                  </Button>
                }
              >
                <p className="acc-lead">
                  {decided.status === "verified"
                    ? "نقول ما صار مسموحاً: النشر والبيع في السوق، والشارة على صفحتها."
                    : decided.status === "needs_more"
                      ? "الرفض يُعيد التاجر إلى أول الطابور بلا ذنب."
                      : "الحساب يبقى عاملاً بلا شارة."}
                </p>
                <p className="acc-choice__note">
                  <strong>الشارة تعني ما تقول</strong> · تحقّقٌ من هوية المنشأة لا شهادةُ جودة ولا
                  ضمان. وهذا مكتوب حيث تُقرأ الشارة لا هنا فقط.
                </p>
                <p className="acc-choice__note">
                  {decided.name} · قرّر {decided.reviewer_name} ·{" "}
                  {decided.reviewed_at ? agoWord(decided.reviewed_at) : ""}
                </p>
              </Notice>
            ) : null}

            {data && !current ? (
              <>
                <h3 className="cat-head__title">طلبات التحقُّق</h3>
                <p className="acc-choice__note">
                  <span className="sting-mono">{data.pending_count}</span> بانتظار المراجعة
                  {data.pending_count > 0 ? (
                    <>
                      {" "}
                      · أقدم انتظار <span className="sting-mono">
                        {data.oldest_waiting_hours}
                      </span>{" "}
                      {hoursUnit(data.oldest_waiting_hours)}
                    </>
                  ) : null}
                </p>
                <ul className="cus-list">
                  {data.requests.map((r) => (
                    <li key={r.tenant_id}>
                      {r.status === "pending" || r.status === "needs_more" ? (
                        <Button
                          variant="quiet"
                          onClick={() => {
                            setCurrent(r);
                            setReason("");
                            setErr("");
                          }}
                        >
                          {r.name}
                        </Button>
                      ) : (
                        <strong>{r.name}</strong>
                      )}
                      <div className="cus-sub">
                        {r.status === "pending"
                          ? r.docs_line
                          : r.status === "rejected"
                            ? "رُفض الطلب مع بيان السبب. الحساب يبقى عاملاً بلا شارة."
                            : r.note || r.docs_line}
                      </div>
                      <Status state={STATUS_STATE[r.status]} label={r.status_label} />
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">
                  نص الشارة ثابت ومعروض للمشتري: «{data.badge_text}». بلا هذا السطر تصبح الشارة
                  ضماناً لم نقدّمه.
                </p>
                <h3 className="cat-head__title">تشغيل الإرسال — PLT-05</h3>
                <p className="acc-choice__note">
                  صحة القنوات دون كشف مفاتيح أو أسرار مزوّدين. عند نفاد الحصة لا نُسقط الرسائل
                  صامتين. الحملات التسويقية تتوقف أولاً، وتبقى رسائل التشغيل الحرجة تمرّ، ويُبلَّغ
                  التجار المتأثرون بأن حملاتهم مؤجَّلة لا فاشلة.
                </p>
                <div className="acc-actions">
                  <Button variant="quiet" onClick={() => router.push("/platform/outbound")}>
                    لوحة الإرسال
                  </Button>
                </div>
              </>
            ) : null}

            {current ? (
              <>
                <h3 className="cat-head__title">{current.name}</h3>
                <p className="acc-choice__note">
                  {current.docs_line} · قُدِّم{" "}
                  {current.submitted_at ? agoWord(current.submitted_at) : "—"}
                </p>
                <ul className="cus-list">
                  {current.checklist.map((i) => (
                    <li key={i.key}>
                      <strong>{i.title}</strong>
                      {i.reason ? <div className="cus-sub">{i.reason}</div> : null}
                      <Status
                        state={i.done ? "success" : "partial"}
                        label={i.done ? "مكتمل" : "ناقص"}
                      />
                    </li>
                  ))}
                </ul>
                {doc ? (
                  <img
                    src={doc.data}
                    alt={`مستند ${current.name}`}
                    style={{ maxInlineSize: "100%" }}
                  />
                ) : (
                  <div className="acc-actions">
                    <Button
                      loading={busy === "document"}
                      onClick={() => void act(current, "document")}
                      disabledReason={current.has_doc ? undefined : "لم يُرفق مستند"}
                    >
                      افتح المستند — تُسجَّل المشاهدة
                    </Button>
                  </div>
                )}
                {!decided ? (
                  <>
                    <div className="pos-chips" role="group" aria-label="الحقل الناقص">
                      {current.checklist.map((i) => (
                        <button
                          key={i.key}
                          type="button"
                          className={`pos-chip${reasonKey === i.key ? " pos-chip--on" : ""}`}
                          onClick={() => setReasonKey(i.key)}
                        >
                          {i.title}
                        </button>
                      ))}
                    </div>
                    <TextField
                      label="سبب محدّد يقرأه التاجر"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      hint="مثال: «الطرف الأيسر مقطوع» — لا اتهام ولا رفض بلا سبب"
                    />
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy === "verified"}
                        onClick={() => void act(current, "decide", "verified")}
                      >
                        تُحقّق من المنشأة
                      </Button>
                      <Button
                        loading={busy === "needs_more"}
                        onClick={() => void act(current, "decide", "needs_more")}
                      >
                        اطلب إعادة الرفع بسبب
                      </Button>
                      <Button
                        variant="quiet"
                        loading={busy === "rejected"}
                        onClick={() => void act(current, "decide", "rejected")}
                        disabledReason={
                          reason.trim() ? undefined : "الرفض يحتاج سبباً يقرأه التاجر"
                        }
                      >
                        رفض بسبب
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => {
                          setCurrent(null);
                          setDoc(null);
                          setErr("");
                        }}
                      >
                        رجوع
                      </Button>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
