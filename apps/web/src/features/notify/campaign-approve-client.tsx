"use client";

import { Button, Frame, Notice, TextField } from "@sting/ui-web";
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
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "saving" | "expired" | "success";

interface Blocker {
  code: string;
  title: string;
  detail: string;
  confirmable?: boolean;
}

interface Campaign {
  id: string;
  name: string;
  message: string;
  audience_count: number;
  excluded_count: number;
  parts: number;
  cost_messages: number;
  status: string;
  status_label: string;
  scheduled_at: string;
  sent_at: string;
  overdue: boolean;
  can_approve: boolean;
  can_cancel: boolean;
  approved_by_name: string;
  approved_at: string;
  shop_name: string;
  quota: { used: number; max: number; remaining: number };
}

interface Verify {
  audience: { eligible: number; excluded_opt_out: number };
  parts: number;
  cost_messages: number;
  quota: { used: number; max: number; remaining: number };
  blockers: Blocker[];
  campaign: Campaign;
}

function when(iso: string): { rel: string; time: string } {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  const { day: dd, month } = dayMonth(iso);
  return {
    rel: diff === 0 ? "اليوم" : diff === 1 ? "غداً" : diff === -1 ? "أمس" : `${dd} ${month}`,
    time: hhmm(d.toISOString()),
  };
}

const localIso = (date: string, time: string) => {
  if (!date || !time) return "";
  return new Date(`${date}T${time}:00`).toISOString();
};

/**
 * NOT-05 — معاينة واعتماد وجدولة (36-D28 ready/saving/expired/success · 17-D12
 * validation_error): آخر باب قبل الإرسال — الرسالة كما ستصل الزبون على هاتفه ومعها العدد والوقت
 * والحصة بعد الإرسال («الرقم الحاسم»)؛ إعادة التحقق خادمياً قبل كل محاولة (ACC-109)؛ الجدولة
 * تُسجَّل ولا تُرسل؛ حملة مضى وقتها لا تُرسل متأخرة تلقائياً — نسأل؛ الإلغاء ظاهر هنا حتى لحظة
 * الإرسال (§١١.٧).
 */
export function CampaignApproveClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [c, setC] = useState<Campaign | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [nightOk, setNightOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [blocked, setBlocked] = useState<Blocker[] | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/campaigns/{campaign_id}", {
      params: { path: { campaign_id: id } },
    });
    const body = data as unknown as { campaign: Campaign } | undefined;
    if (response.ok && body) setC(body.campaign);
  }, [id]);

  const reverify = useCallback(async () => {
    const { data, response } = await api().POST("/api/campaigns/{campaign_id}/{action}", {
      params: { path: { campaign_id: id, action: "verify" } },
      body: { scheduled_at: localIso(date, time), night_confirmed: nightOk } as never,
    });
    const body = data as unknown as Verify | undefined;
    if (response.ok && body) {
      setVerify(body);
      setC(body.campaign);
    }
  }, [id, date, time, nightOk]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/notify/campaigns/${id}/approve`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  useEffect(() => {
    const t = setTimeout(() => void reverify().catch(() => undefined), 200);
    return () => clearTimeout(t);
  }, [reverify]);

  const act = async (action: "approve" | "cancel", body: Record<string, unknown> = {}) => {
    if (busy) return;
    setBusy(true);
    setAttempted(true);
    setBlocked(null);
    try {
      const { data, error, response } = await api().POST("/api/campaigns/{campaign_id}/{action}", {
        params: { path: { campaign_id: id, action } },
        body: body as never,
      });
      if (response.status === 400) {
        const e = error as unknown as { detail: string; extra?: { blockers?: Blocker[] } };
        if (e.detail === "blocked") setBlocked(e.extra?.blockers ?? []);
        return;
      }
      const out = data as unknown as { campaign: Campaign } | undefined;
      if (response.ok && out) setC(out.campaign);
    } finally {
      setBusy(false);
    }
  };

  const approved = c ? ["scheduled", "sending", "done"].includes(c.status) : false;
  const state: State = busy
    ? "saving"
    : blocked
      ? "validation_error"
      : c?.overdue
        ? "expired"
        : approved && attempted
          ? "success"
          : approved && c?.status !== "scheduled"
            ? "success"
            : "ready";

  const v = verify;
  const sched = c?.scheduled_at ? when(c.scheduled_at) : null;

  return (
    <Frame title="الإشعارات" nav={<AppNav currentId="campaigns" />} footer={null}>
      <div className="sys not" data-screen="NOT-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">معاينة واعتماد وجدولة</h2>
            <span className="cat-head__hint">آخر باب قبل الإرسال.</span>
          </div>
          <div className="acc-card__body">
            {state === "saving" ? (
              <Notice kind="info" title="جارٍ الجدولة">
                <p className="acc-lead">
                  الجدولة تُسجَّل ولا تُرسل. الفرق مكتوب: «مجدولة ٨ ص غداً» لا «أُرسلت».
                </p>
              </Notice>
            ) : null}
            {state === "expired" && c && sched ? (
              <Notice
                kind="warning"
                title="مضى وقت الإرسال"
                action={
                  <>
                    <Button pos onClick={() => void act("approve", { send_now: true })}>
                      أرسل الآن
                    </Button>
                    <Button onClick={() => setDate("")}>أعد الجدولة</Button>
                    <Button variant="secondary" onClick={() => void act("cancel")}>
                      ألغِ
                    </Button>
                  </>
                }
              >
                <p className="acc-lead">
                  حملة مجدولة {sched.rel === "أمس" ? "لأمس" : `لـ${sched.rel}`}{" "}
                  <span className="sting-mono">{sched.time}</span> والنظام كان متوقفاً.
                </p>
                <p className="acc-lead">
                  <strong>لا إرسال متأخر تلقائياً</strong> · عرضُ «خصم اليوم» يصل بعد يومين إزعاجٌ
                  لا تسويق. نسأل: أرسل الآن أم أعد الجدولة أم ألغِ.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" && blocked ? (
              <Notice kind="warning" title="لا يمكن الجدولة بعد">
                <p className="acc-lead">
                  {blocked.length === 3
                    ? "ثلاثة نواقص تمنع الإرسال."
                    : blocked.length === 2
                      ? "نقصان يمنعان الإرسال."
                      : "نقص واحد يمنع الإرسال."}{" "}
                  كلٌّ منها مذكور بسببه وبما يلزم لحلّه.
                </p>
                <ul className="acc-choice__note">
                  {blocked.map((b) => (
                    <li key={b.code}>
                      <strong>{b.title}</strong> · {b.detail}
                      {b.confirmable ? (
                        <>
                          {" "}
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setNightOk(true);
                              setBlocked(null);
                            }}
                          >
                            أؤكّد الإرسال الليلي
                          </Button>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">جدولة — غير متاحة</p>
              </Notice>
            ) : null}
            {state === "success" && c ? (
              <Notice
                kind="success"
                title="اعتُمدت"
                action={
                  <>
                    <Button onClick={() => router.push(`/notify/campaigns/${c.id}`)}>
                      نتائج الحملة
                    </Button>
                    {c.can_cancel ? (
                      <Button variant="secondary" onClick={() => void act("cancel")}>
                        إلغاء الحملة
                      </Button>
                    ) : null}
                  </>
                }
              >
                <p className="acc-lead">
                  نقول ما صار:{" "}
                  {c.status === "scheduled" && sched ? (
                    <>
                      مجدولة <span className="sting-mono">{sched.time}</span> {sched.rel}
                    </>
                  ) : c.status === "sending" ? (
                    "قيد الإرسال"
                  ) : (
                    "أُرسلت"
                  )}
                  {c.approved_at ? (
                    <>
                      {" "}
                      · اعتمدها {c.approved_by_name} في{" "}
                      <span className="sting-mono">{hhmm(c.approved_at)}</span>
                    </>
                  ) : null}
                  ، وأين تُتابَع نتائجها — في «نتائج الحملة».
                </p>
                <p className="acc-lead">
                  <strong>الإلغاء متاح</strong> · حتى لحظة الإرسال، وزرّه ظاهر هنا لا مخبوء في
                  القائمة.
                </p>
              </Notice>
            ) : null}

            {c ? (
              <div className="org-effects__row">
                <div>
                  <h3 className="cat-head__title">كما ستصل الزبون</h3>
                  <p className="acc-choice__note">
                    معاينةٌ بشكل الرسالة على هاتفه، ومعها العدد والوقت والحصة بعد الإرسال.
                  </p>
                  <div className="not-phone" aria-label="معاينة على الهاتف">
                    <div className="not-phone__from">{c.shop_name}</div>
                    <blockquote className="not-preview">{c.message}</blockquote>
                  </div>
                  <p className="acc-lead">
                    <strong>الرقم الحاسم</strong> · «ستصل{" "}
                    <span className="sting-mono">{v?.audience.eligible ?? c.audience_count}</span>{" "}
                    زبوناً · تبقى{" "}
                    <span className="sting-mono">
                      {Math.max(
                        0,
                        (v?.quota.remaining ?? c.quota.remaining) -
                          (approved ? 0 : (v?.cost_messages ?? c.cost_messages)),
                      )}
                    </span>{" "}
                    من حصتك». الاعتماد على معرفة الأثر لا على الثقة بالنظام.
                  </p>
                  <p className="acc-choice__note">
                    <span className="sting-mono">{v?.cost_messages ?? c.cost_messages}</span> رسالة
                    (<span className="sting-mono">{v?.parts ?? c.parts}</span> لكل مستلم) ·{" "}
                    <span className="sting-mono">
                      {v?.audience.excluded_opt_out ?? c.excluded_count}
                    </span>{" "}
                    مستبعد
                  </p>
                </div>
                {!approved || c.status === "scheduled" ? (
                  <div className="cat-form">
                    <h3 className="cat-head__title">الجدولة</h3>
                    <TextField
                      label="تاريخ الإرسال"
                      kind="date"
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setNightOk(false);
                      }}
                    />
                    <TextField
                      label="وقت الإرسال"
                      value={time}
                      onChange={(e) => {
                        setTime(e.target.value);
                        setNightOk(false);
                      }}
                      mono
                    />
                    {v?.blockers.length ? (
                      <p className="acc-choice__note">
                        قبل الجدولة: {v.blockers.map((b) => b.title).join(" · ")}
                      </p>
                    ) : null}
                    {c.can_approve ? (
                      <div className="cat-form__actions">
                        <Button
                          pos
                          onClick={() =>
                            void act("approve", {
                              scheduled_at: localIso(date, time),
                              night_confirmed: nightOk,
                            })
                          }
                          loading={busy}
                          disabledReason={!date ? "اختر تاريخ الإرسال" : undefined}
                        >
                          اعتمد وجدول
                        </Button>
                        <Button
                          onClick={() => void act("approve", { send_now: true })}
                          loading={busy}
                        >
                          اعتمد وأرسل الآن
                        </Button>
                        {c.can_cancel && approved ? (
                          <Button variant="secondary" onClick={() => void act("cancel")}>
                            إلغاء الحملة
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="acc-choice__note">الاعتماد والجدولة صلاحية منفصلة — للمالك.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
