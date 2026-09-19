"use client";

import { Button, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./notify.css";
import { AppNav } from "@/features/home/app-nav";
import { dayMonth, hhmm } from "@/features/home/format";
import { Ago } from "@/features/org/ago";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "partial" | "server_error" | "success";

interface Failure {
  code: string;
  label: string;
  count: number;
  action: string;
  retryable: boolean;
}

interface Results {
  sent: number;
  accepted: number;
  delivered: number;
  unconfirmed: number;
  awaiting: number;
  failed: number;
  failed_permanent: number;
  failed_temporary: number;
  opted_out: number;
  queued: number;
  cancelled: number;
  refunded_messages?: number;
  failures: Failure[];
  provider_silent: boolean;
  read: null;
}

interface Campaign {
  id: string;
  name: string;
  message: string;
  audience_count: number;
  parts: number;
  cost_messages: number;
  status: string;
  status_label: string;
  scheduled_at: string;
  sent_at: string;
  results: Partial<Results>;
  overdue: boolean;
  can_approve: boolean;
  can_cancel: boolean;
  cancelled_at: string;
  quota: { used: number; max: number; remaining: number };
}

function When({ iso }: { iso: string }) {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const { day: dd, month } = dayMonth(iso);
  return (
    <span>
      {diff === 0 ? (
        "اليوم"
      ) : diff === 1 ? (
        "أمس"
      ) : (
        <>
          <span className="sting-mono">{dd}</span> {month}
        </>
      )}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </span>
  );
}

/**
 * NOT-06 — نتائج حملة وإلغاؤها (36-D28 ready/empty/server_error/success · 07-D3 partial): ما وصل
 * فعلاً — المرسل والواصل والفاشل بأسبابه؛ «قرأها» لا يُعرض لأن المزوّد لا يُثبته (ACC-111)؛ «لم تصل
 * نتائج بعد» ≠ «لم تصل لأحد»؛ المزوّد الصامت يُقال كما هو ولا نُعيد الإرسال؛ الإلغاء يُفصّل ما أُرسل ولا
 * يُستردّ؛ الرسائل الـعابرة غير المحسومة لا تُحتسب نجاحاً ولا فشلاً (ACC-108) (§١١.٩).
 */
export function CampaignResultsClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [c, setC] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/campaigns/{campaign_id}", {
      params: { path: { campaign_id: id } },
    });
    const body = data as unknown as { campaign: Campaign } | undefined;
    if (response.ok && body) setC(body.campaign);
  }, [id]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/notify/campaigns/${id}`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const act = async (action: "cancel" | "retry") => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, response } = await api().POST("/api/campaigns/{campaign_id}/{action}", {
        params: { path: { campaign_id: id, action } },
        body: {} as never,
      });
      const out = data as unknown as { campaign: Campaign } | undefined;
      if (response.ok && out) setC(out.campaign);
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  const r: Partial<Results> = c?.results ?? {};
  const sent = r.sent ?? 0;
  const failed = r.failed ?? 0;
  const unconfirmed = r.unconfirmed ?? 0;
  const delivered = r.delivered ?? 0;
  const accepted = r.accepted ?? 0;
  const inFlight = c ? ["sending"].includes(c.status) : false;
  const started = c
    ? ["sending", "done", "cancelled"].includes(c.status) && sent + failed > 0
    : false;

  const state: State | null = !c
    ? null
    : c.status === "cancelled"
      ? "success"
      : r.provider_silent
        ? "server_error"
        : !started
          ? "empty"
          : // جزئي = ما لم يُحسم بعد (عابر أو غير مؤكد)؛ الفشل الدائم وحده لا يجعلها جزئية
            (r.failed_temporary ?? 0) > 0 || unconfirmed > 0 || inFlight
            ? "partial"
            : "ready";

  const failures = (r.failures ?? []).filter((f) => f.count > 0 || f.code !== "opted_out");
  const temp = (r.failures ?? []).find((f) => f.code === "provider_temp");

  return (
    <Frame title="الإشعارات" nav={<AppNav currentId="campaigns" />} footer={null}>
      <div className="sys not" data-screen="NOT-06" data-state={state ?? undefined}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">نتائج حملة وإلغاؤها</h2>
            <span className="cat-head__hint">
              ما وصل فعلاً. القاعدة: لا ندّعي علماً بما لا يُخبرنا به المزوّد.
            </span>
          </div>
          <div className="acc-card__body">
            {c ? (
              <section className="rep-head" aria-label="الحملة">
                <h3 className="cat-head__title">
                  {c.name}
                  {c.status === "draft" ? "" : ""}
                </h3>
                <p className="acc-choice__note">
                  {c.sent_at ? (
                    <>
                      أُرسلت <When iso={c.sent_at} /> ·{" "}
                      <span className="sting-mono">{c.audience_count}</span> مستلماً
                    </>
                  ) : c.scheduled_at ? (
                    <>
                      مجدولة <When iso={c.scheduled_at} />
                    </>
                  ) : (
                    c.status_label
                  )}{" "}
                  ·{" "}
                  <Status
                    state={
                      c.status === "cancelled"
                        ? "expired"
                        : state === "partial"
                          ? "partial"
                          : state === "server_error"
                            ? "server_error"
                            : c.status === "done"
                              ? "success"
                              : "pending_sync"
                    }
                    label={
                      state === "partial"
                        ? "اكتملت جزئياً"
                        : c.status === "cancelled"
                          ? "أُلغيت"
                          : c.status_label
                    }
                  />
                </p>
                {c.status === "draft" || c.status === "pending_approval" ? (
                  <div className="cat-form__actions">
                    <Button pos onClick={() => router.push(`/notify/campaigns/${c.id}/approve`)}>
                      معاينة واعتماد وجدولة
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {state === "empty" && c ? (
              <Notice kind="empty" title="لا نتائج بعد">
                <p className="acc-lead">
                  {c.sent_at ? (
                    <>
                      أُرسلت <Ago iso={c.sent_at} /> ولم يردّ المزوّد بشيء.
                    </>
                  ) : c.scheduled_at ? (
                    "لم تُرسل بعد — مجدولة."
                  ) : (
                    "لم تُرسل بعد — مسودة تنتظر الاعتماد."
                  )}
                </p>
                <p className="acc-lead">
                  <strong>نفرّق</strong> · «لم تصل نتائج بعد» لا «لم تصل لأحد». الأولى انتظار
                  والثانية فشل.
                </p>
              </Notice>
            ) : null}

            {state === "server_error" ? (
              <Notice kind="error" title="المزوّد لا يردّ">
                <p className="acc-lead">
                  الحملة أُرسلت وحالة التسليم مجهولة. أسوأ من الفشل لأنه غموض.
                </p>
                <p className="acc-lead">
                  <strong>نقولها كما هي</strong> · «أُرسلت{" "}
                  <span className="sting-mono">{sent}</span> · حالة التسليم غير معروفة — المزوّد لا
                  يستجيب». ولا نُعيد الإرسال: قد تصل مرتين.
                </p>
              </Notice>
            ) : null}

            {state === "success" && c ? (
              <Notice kind="success" title="أُلغيت الحملة">
                {sent === 0 ? (
                  <p className="acc-lead">
                    أُلغيت قبل موعدها. نقول العدد الذي لم يُرسل والحصة التي عادت:{" "}
                    <span className="sting-mono">{r.cancelled ?? 0}</span> لم تُرسل ·{" "}
                    <span className="sting-mono">{r.refunded_messages ?? 0}</span> رسالة عادت إلى
                    حصتك.
                  </p>
                ) : (
                  <p className="acc-lead">
                    <strong>ما أُرسل لا يُستردّ</strong> · إن كانت بدأت، نُفصّل: «
                    <span className="sting-mono">{sent}</span> أُرسلت ولا تُستردّ ·{" "}
                    <span className="sting-mono">{r.cancelled ?? 0}</span> أُلغيت». الإلغاء الجزئي
                    حقيقة تُقال.
                  </p>
                )}
              </Notice>
            ) : null}

            {state === "partial" && c ? (
              <Notice kind="warning" title="جزئي">
                <p className="acc-lead">
                  <strong>
                    الإخفاقات — <span className="sting-mono">{failed}</span> رسالة
                  </strong>
                  {unconfirmed > 0 ? (
                    <>
                      {" "}
                      · انقطع عامل الجدولة. الرسائل الـ
                      <span className="sting-mono">{unconfirmed}</span> العابرة لم تُحسم نتيجتها لدى
                      المزوّد — تُعرض «غير مؤكدة» ولا تُحتسب نجاحاً ولا فشلاً نهائياً.
                    </>
                  ) : null}
                </p>
                {temp && (temp.count > 0 || unconfirmed > 0) && c.can_approve ? (
                  <div className="cat-form__actions">
                    <Button onClick={() => void act("retry")} loading={busy}>
                      إعادة محاولة الـ
                      {temp.count + unconfirmed} العابرة
                    </Button>
                  </div>
                ) : null}
              </Notice>
            ) : null}

            {c && started ? (
              <>
                <div className="home-kpis rep-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">أُرسلت للمزوّد</div>
                    <div className="home-kpi__value sting-mono">{sent}</div>
                    <div className="home-kpi__scope">كل الجمهور المؤهل</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">قبِلها المزوّد</div>
                    <div className="home-kpi__value sting-mono">{accepted}</div>
                    <div className="home-kpi__scope">قبول ليس تسليماً</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">أكّد المزوّد تسليمها</div>
                    <div className="home-kpi__value sting-mono">{delivered}</div>
                    <div className="home-kpi__scope">
                      وصلت الجهاز · <span className="sting-mono">{unconfirmed}</span> بلا تأكيد بعد
                    </div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">فشلت</div>
                    <div className="home-kpi__value sting-mono">{failed}</div>
                    <div className="home-kpi__scope">
                      <span className="sting-mono">{r.failed_permanent ?? 0}</span> دائم ·{" "}
                      <span className="sting-mono">{r.failed_temporary ?? 0}</span> عابر
                    </div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">غير محسومة</div>
                    <div className="home-kpi__value sting-mono">{unconfirmed}</div>
                    <div className="home-kpi__scope">انقطع عامل الجدولة</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">قُرئت</div>
                    <div className="home-kpi__value">غير معروف</div>
                    <div className="home-kpi__scope">القراءة غير مقيسة ولن تُعرض.</div>
                  </div>
                </div>
                <p className="acc-choice__note">
                  <strong>لا قراءة مفترضة</strong> · المزوّد يخبرنا أنه قبِل الرسالة، وأحياناً أنه
                  سلّمها. لا يخبرنا أن أحداً قرأها. عرض «معدل القراءة» هنا سيكون رقماً مخترعاً تبني
                  عليه قراراً تسويقياً خاطئاً. تسجيل القراءة افتراضاً يجعل التاجر يظنّ حملته ناجحة.
                  الصمت أصدق من رقم مخترع.
                </p>
                {failures.length ? (
                  <Table
                    caption="الإخفاقات"
                    columns={[
                      { key: "r", header: "سبب الفشل", render: (f: Failure) => f.label },
                      {
                        key: "n",
                        header: "العدد",
                        mono: true,
                        render: (f: Failure) => String(f.count),
                      },
                      {
                        key: "k",
                        header: "النوع",
                        render: (f: Failure) =>
                          f.code === "invalid_number"
                            ? "دائم — لا يُعاد الإرسال تلقائياً"
                            : f.code === "provider_temp"
                              ? "عابر — إعادة المحاولة متاحة بصلاحية"
                              : "يُحترم فوراً",
                      },
                      { key: "a", header: "ما يمكن فعله", render: (f: Failure) => f.action },
                    ]}
                    rows={failures}
                    rowKey={(f) => f.code}
                  />
                ) : null}
              </>
            ) : null}

            {c && c.can_cancel && c.status !== "cancelled" ? (
              <div className="cat-form__actions">
                <p className="acc-choice__note">
                  الإيقاف لا يسترد ما أُرسل ولا يعيد رصيده. نقول ذلك قبل التأكيد لا بعده.
                  {sent > 0 ? (
                    <>
                      {" "}
                      <span className="sting-mono">{sent}</span> أُرسلت ولا تُستردّ.
                    </>
                  ) : null}
                </p>
                {confirmCancel ? (
                  <>
                    <Button pos onClick={() => void act("cancel")} loading={busy}>
                      أكّد الإيقاف
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirmCancel(false)}>
                      رجوع
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmCancel(true)}>
                    {inFlight ? "إيقاف ما تبقّى" : "إلغاء الحملة"}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
