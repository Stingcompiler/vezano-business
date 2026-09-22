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
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "ready" | "validation_error" | "permission_denied" | "success";

interface OfferSummary {
  id: string;
  tenant_id: string;
  public_name: string;
  seller_name: string;
  status: string;
  suspended: boolean;
  suspended_reason: string;
  suspended_by_name: string;
  appeal_status: string;
  confirmed_orders: number;
}
interface Report {
  id: string;
  tenant_id: string;
  number: number;
  ref_label: string;
  reason: "impersonation" | "misleading" | "harmful" | "prohibited";
  reason_label: string;
  target_label: string;
  note: string;
  evidence_name: string;
  has_evidence: boolean;
  reporter_name: string;
  created_at: string;
  hours_ago: number;
  status: "under_review" | "actioned" | "closed";
  status_label: string;
  outcome: string;
  offer: OfferSummary | null;
}
interface Appeal {
  offer_id: string;
  tenant_id: string;
  public_name: string;
  seller_name: string;
  suspended_reason: string;
  suspended_by_name: string;
  appeal_status: string;
  appeal_note: string;
  appeal_doc_name: string;
  has_doc: boolean;
  appeal_opened_at: string;
}
interface Payload {
  reports: Report[];
  open_count: number;
  appeals: Appeal[];
  reasons: { code: string; label: string }[];
}

const SHORT: Record<Report["reason"], string> = {
  impersonation: "انتحال منشأة",
  misleading: "وصف مضلّل",
  harmful: "محتوى ضارّ",
  prohibited: "سلعة ممنوعة",
};
const TYPE: Record<Report["reason"], string> = {
  impersonation: "انتحال اسم منشأة موثَّقة",
  misleading: "وصف مضلّل للمنتج أو وحدته",
  harmful: "محتوى غير لائق أو ضارّ",
  prohibited: "عرض لسلعة ممنوعة",
};
const agoHours = (h: number) =>
  h === 0
    ? "قبل أقل من ساعة"
    : h === 1
      ? "قبل ساعة"
      : h === 2
        ? "قبل ساعتين"
        : h <= 10
          ? `قبل ${h} ساعات`
          : `قبل ${h} ساعة`;

/** PLT-07 — مراجعة بلاغ وتعليق نشر واعتراض (26-D19 · 39-D31): لا مساس بدفاتر الأطراف (ACC-135 · ACC-139). */
export function ReportsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [current, setCurrent] = useState<Report | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [appealNote, setAppealNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [decided, setDecided] = useState<Report | null>(null);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/reports", {
      params: { query: { status: "all" } },
    });
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const decide = async (r: Report, decision: "suspend" | "close" | "ledger") => {
    if (busy) return;
    setBusy(decision);
    setErr("");
    try {
      const res = await platformApi().POST("/api/platform/reports/{tenant_id}/{report_id}/decide", {
        params: { path: { tenant_id: r.tenant_id, report_id: r.id } },
        body: { decision, reason_code: reasonCode, reason_text: reasonText } as never,
      });
      const b = (res.data ?? res.error) as unknown as
        { report?: Report; detail?: string } | undefined;
      if (res.response.ok && b?.report) {
        setDecided(b.report);
        setCurrent(b.report);
        await load();
        return;
      }
      setErr(b?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const decideAppeal = async (a: Appeal, decision: "uphold" | "reverse") => {
    if (busy) return;
    setBusy(`appeal:${decision}`);
    setErr("");
    try {
      const res = await platformApi().POST("/api/platform/appeals/{tenant_id}/{offer_id}/decide", {
        params: { path: { tenant_id: a.tenant_id, offer_id: a.offer_id } },
        body: { decision, note: appealNote } as never,
      });
      const b = (res.data ?? res.error) as unknown as
        { appeal?: unknown; detail?: string } | undefined;
      if (res.response.ok) {
        setAppealNote("");
        await load();
        return;
      }
      setErr(b?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const state: State =
    err === "operator_scope_publish_only"
      ? "permission_denied"
      : err === "reason_required"
        ? "validation_error"
        : decided
          ? "success"
          : "ready";
  const open = data?.reports.filter((r) => r.status === "under_review") ?? [];
  const done = data?.reports.filter((r) => r.status !== "under_review") ?? [];

  return (
    <PlatformFrame current="reports">
      <div className="sys mp cus plt-frame" data-screen="PLT-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              مراجعة بلاغ وتعليق نشر واعتراض — لا مساس بدفاتر الأطراف
            </h2>
            <span className="cat-head__hint">
              <strong>المشغّل يعلّق</strong> النشر في السوق عند بلاغ بانتحال أو ضرر. لا يعدّل مخزون
              بائع ولا طلباً مؤكّداً ولا دفتر أي طرف (ACC-135, ACC-139).
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice
                kind="locked"
                title="محاولة تعديل مخزون البائع"
                action={<Button onClick={() => setErr("")}>فهمت</Button>}
              >
                <p className="acc-lead">
                  لا يوجد في مساحة المشغّل زرّ يعدّل كميّة أو سعراً في دفتر بائع. المحاولة تُرفض
                  بنصّ صريح: صلاحية المشغّل تقف عند النشر.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="warning" title="تعليق بلا سبب مصنَّف">
                <p className="acc-lead">
                  محاولة تعليق نشر بلا اختيار سبب من القائمة ولا نصّ للمعلَّق عليه.
                </p>
                <p className="acc-choice__note">
                  <strong>السبب حقٌّ للمعلَّق عليه</strong> · تعليقٌ بلا سبب لا يُعترض عليه ولا
                  يُصحَّح. القائمة المصنَّفة تجعل الاعتراض ممكناً والمراجعة متسقة.
                </p>
                <p className="acc-choice__note">
                  <strong>لا مساس بالدفاتر</strong> · التعليق يمنع النشر الجديد ولا يمسّ طلباً
                  قائماً ولا دفتر طرف (ACC-139).
                </p>
              </Notice>
            ) : null}
            {err && !["operator_scope_publish_only", "reason_required"].includes(err) ? (
              <Notice kind="warning" title="لم يُنفَّذ">
                <p className="acc-lead">
                  {err === "same_reviewer"
                    ? "الاعتراض يذهب لمراجِع مختلف عن من علّق — لا حسم من طرف واحد."
                    : err === "already_decided"
                      ? "البلاغ محسوم من قبل."
                      : err}
                </p>
              </Notice>
            ) : null}
            {state === "success" && decided ? (
              <Notice
                kind="success"
                title={
                  decided.status === "actioned"
                    ? "عُلّق نشر العرض — البائع يرى السبب الآن وله مسار اعتراض"
                    : "أُغلق البلاغ بلا إجراء"
                }
                action={
                  <Button
                    onClick={() => {
                      setDecided(null);
                      setCurrent(null);
                      setReasonCode("");
                      setReasonText("");
                    }}
                  >
                    التالي
                  </Button>
                }
              >
                <p className="acc-lead">
                  {decided.status === "actioned"
                    ? "يُخفى العرض من نتائج السوق فقط. الطلبات المؤكَّدة قبل التعليق تبقى قائمة بين طرفيها، ومخزون البائع ودفتره لا يُلمسان."
                    : "المبلِّغ يرى حالة بلاغه برقمه؛ لا أثر على العرض ولا على صاحبه."}
                </p>
                <p className="acc-choice__note">
                  {decided.ref_label} · {decided.outcome}
                </p>
              </Notice>
            ) : null}

            {data && !current ? (
              <>
                <h3 className="cat-head__title">
                  بلاغات قيد المراجعة — <span className="sting-mono">{data.open_count}</span>
                </h3>
                {open.length === 0 ? (
                  <p className="acc-choice__note">لا بلاغات بانتظار المراجعة.</p>
                ) : null}
                <ul className="cus-list">
                  {open.map((r) => (
                    <li key={r.id}>
                      <Button
                        variant="quiet"
                        onClick={() => {
                          setCurrent(r);
                          setErr("");
                          setReasonCode("");
                          setReasonText("");
                        }}
                      >
                        بلاغ #{r.ref_label} — {SHORT[r.reason]}
                      </Button>
                      <div className="cus-sub">
                        أبلغ عنه: {r.reporter_name} · {agoHours(r.hours_ago)}
                      </div>
                      <Status state="stale" label="قيد المراجعة" />
                    </li>
                  ))}
                </ul>
                {done.length ? (
                  <>
                    <h3 className="cat-head__title">بلاغات محسومة</h3>
                    <ul className="cus-list">
                      {done.map((r) => (
                        <li key={r.id}>
                          <strong>
                            بلاغ #{r.ref_label} — {SHORT[r.reason]}
                          </strong>
                          <div className="cus-sub">{r.outcome}</div>
                          <Status
                            state={r.status === "actioned" ? "expired" : "synced"}
                            label={r.status === "actioned" ? "تعليق نشر" : "أُغلق بلا إجراء"}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            ) : null}

            {current ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={
                      current.status === "actioned"
                        ? "expired"
                        : current.status === "closed"
                          ? "synced"
                          : "stale"
                    }
                    label={
                      current.status === "actioned"
                        ? "تعليق نشر"
                        : current.status === "closed"
                          ? "أُغلق بلا إجراء"
                          : "قيد المراجعة"
                    }
                  />
                </div>
                <h3 className="cat-head__title">
                  بلاغ #{current.ref_label} — {SHORT[current.reason]}
                </h3>
                <p className="acc-choice__note">
                  أبلغ عنه: {current.reporter_name} · {agoHours(current.hours_ago)}
                </p>
                <dl className="mp-preview">
                  <dt>العرض المبلَّغ عنه</dt>
                  <dd>
                    {current.offer ? `${current.offer.public_name} — ` : ""}
                    {current.note || current.target_label}
                    {current.offer ? (
                      <div className="mp-reason">البائع: {current.offer.seller_name}</div>
                    ) : null}
                  </dd>
                  <dt>نوع البلاغ</dt>
                  <dd>{TYPE[current.reason]}</dd>
                  <dt>الدليل المرفوع</dt>
                  <dd>{current.has_evidence ? current.evidence_name || "مرفق" : "بلا دليل"}</dd>
                  <dt>طلبات مؤكَّدة على هذا العرض</dt>
                  <dd>
                    {current.offer && current.offer.confirmed_orders > 0 ? (
                      <>
                        <span className="sting-mono">{current.offer.confirmed_orders}</span> — تبقى
                        قائمة بين طرفيها
                      </>
                    ) : (
                      "لا يوجد — العرض جديد بلا طلبات"
                    )}
                  </dd>
                </dl>
                <h3 className="cat-head__title">أثر التعليق محدود بدقّة</h3>
                <p className="acc-choice__note">
                  <strong>يُخفى</strong> العرض المبلَّغ عنه من نتائج السوق فقط. الطلبات المؤكَّدة
                  قبل التعليق تبقى قائمة بين طرفيها، ومخزون البائع ودفتره لا يُلمسان. التعليق إجراء
                  نشر لا إجراء محاسبي.
                </p>
                {!decided && current.status === "under_review" ? (
                  <>
                    <h3 className="cat-head__title">قرار المراجعة</h3>
                    <p className="acc-choice__note">
                      <strong>تعليق النشر مع سبب معلَن للبائع</strong> — لا تعليق صامت. البائع يرى
                      نص السبب فوراً وله مسار اعتراض.
                    </p>
                    <div className="pos-chips" role="group" aria-label="سبب التعليق">
                      {data?.reasons.map((x) => (
                        <button
                          key={x.code}
                          type="button"
                          className={`pos-chip${reasonCode === x.code ? " pos-chip--on" : ""}`}
                          onClick={() => setReasonCode(x.code)}
                        >
                          {x.label}
                        </button>
                      ))}
                    </div>
                    <TextField
                      label="نصّ السبب — يقرأه البائع"
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                    />
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy === "suspend"}
                        onClick={() => void decide(current, "suspend")}
                      >
                        تعليق العرض مع بيان السبب
                      </Button>
                      <Button
                        loading={busy === "close"}
                        onClick={() => void decide(current, "close")}
                      >
                        إغلاق البلاغ بلا إجراء
                      </Button>
                      <Button
                        variant="quiet"
                        loading={busy === "ledger"}
                        onClick={() => void decide(current, "ledger")}
                      >
                        دفتر البائع ومخزونه
                      </Button>
                      <Button
                        variant="quiet"
                        onClick={() => {
                          setCurrent(null);
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

            {data?.appeals.length ? (
              <>
                <h3 className="cat-head__title">اعتراض البائع فُتح ويُراجَع</h3>
                <p className="acc-choice__note">
                  قدّم البائع مستنداً يثبت هويته. الاعتراض يذهب لمراجِع مختلف عن من علّق، وحتى حسمه
                  يبقى القرار الأول ساري المفعول ومعلَناً — لا حسم من طرف واحد.
                </p>
                <ul className="cus-list">
                  {data.appeals.map((a) => (
                    <li key={a.offer_id}>
                      <strong>
                        {a.public_name} · {a.seller_name}
                      </strong>
                      <div className="cus-sub">
                        علّقه {a.suspended_by_name} — {a.suspended_reason}
                      </div>
                      <div className="cus-sub">
                        الاعتراض: {a.appeal_note}
                        {a.has_doc ? ` · مستند: ${a.appeal_doc_name}` : ""}
                      </div>
                      <Status state="stale" label="التعليق سارٍ حتى الحسم" />
                      <TextField
                        label="ملاحظة الحسم"
                        value={appealNote}
                        onChange={(e) => setAppealNote(e.target.value)}
                      />
                      <div className="acc-actions">
                        <Button
                          loading={busy === "appeal:reverse"}
                          onClick={() => void decideAppeal(a, "reverse")}
                        >
                          إلغاء التعليق
                        </Button>
                        <Button
                          variant="quiet"
                          loading={busy === "appeal:uphold"}
                          onClick={() => void decideAppeal(a, "uphold")}
                        >
                          إبقاء التعليق
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
