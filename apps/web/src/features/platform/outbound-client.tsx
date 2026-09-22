"use client";

import { Button, Notice, Status, Table } from "@sting/ui-web";
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

type State = "ready" | "empty" | "partial" | "server_error";

interface Channel {
  key: "sms_primary" | "sms_fallback" | "push" | "email";
  label: string;
  purpose: string;
  quota_line: string;
  used: number;
  max: number;
  status: "ok" | "exhausted" | "down" | "receiving" | "ready" | "partial";
  status_label: string;
  behaviour: string;
  failure_pct?: string;
  note: string;
}

interface Payload {
  state: State;
  sent_today: number;
  quota: { used: number; max: number; remaining: number };
  queue: {
    queued: number;
    unconfirmed: number;
    temp_failed: number;
    held_waiting_channel: number;
    deferred_campaigns: number;
    announcements_due: number;
  };
  delivery_rate_hour: string;
  delivery_hour_total: number;
  channels: Channel[];
  fetched_at: string;
}

const STATUS_STATE: Record<
  Channel["status"],
  "success" | "expired" | "conflict" | "synced" | "saved_local" | "partial"
> = {
  ok: "success",
  exhausted: "expired",
  down: "conflict",
  receiving: "synced",
  ready: "saved_local",
  partial: "partial",
};

/** PLT-05 — تشغيل الإرسال والإخفاقات (26-D19 · 18-D13): حصص وقنوات دون كشف أسرار المزوّدين. */
export function OutboundClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/outbound");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const toggle = async (ch: Channel) => {
    if (busy) return;
    setBusy(ch.key);
    try {
      const r = await platformApi().POST("/api/platform/outbound/channels/{key}", {
        params: { path: { key: ch.key } },
        body: { state: ch.status === "down" ? "up" : "down", note: "" } as never,
      });
      const b = r.data as unknown as Payload | undefined;
      if (r.response.ok && b) setData(b);
    } finally {
      setBusy("");
    }
  };

  const state: State = data?.state ?? "ready";
  const columns = [
    {
      key: "channel",
      header: "القناة / المزوّد",
      render: (c: Channel) => (
        <>
          <strong>{c.label}</strong>
          <div className="mp-check__hint">{c.purpose}</div>
        </>
      ),
    },
    {
      key: "quota",
      header: "الحصة المستهلَكة",
      render: (c: Channel) =>
        c.key === "sms_primary" ? (
          <>
            <span className="sting-mono">{c.used}</span> /{" "}
            <span className="sting-mono">{c.max}</span>
          </>
        ) : c.key === "push" ? (
          <>
            <span className="sting-mono">{c.failure_pct ?? "0"}%</span> فشل
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (c: Channel) => <Status state={STATUS_STATE[c.status]} label={c.status_label} />,
    },
    {
      key: "behaviour",
      header: "السلوك عند التعثّر",
      render: (c: Channel) => (
        <>
          {c.behaviour}
          {c.note ? <div className="mp-check__hint">{c.note}</div> : null}
          {c.key === "sms_primary" || c.key === "sms_fallback" ? (
            <div className="acc-actions">
              <Button variant="quiet" loading={busy === c.key} onClick={() => void toggle(c)}>
                {c.status === "down" ? "إعلان عودة القناة" : "إعلان تعذّر القناة"}
              </Button>
            </div>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <PlatformFrame current="outbound">
      <div className="sys mp cus plt-frame" data-screen="PLT-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              تشغيل الإرسال والإخفاقات — حصص وقنوات دون كشف أسرار المزوّدين
            </h2>
            <span className="cat-head__hint">
              لوحة تشغيل كاملة للإرسال: القنوات، الحصص، التحويل الاحتياطي، والطابور لكل مستأجر — بلا
              مفتاح أو سرّ مزوّد واحد.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "server_error" && data ? (
              <Notice kind="error" title="تعذّر الوصول إلى المزوّد الأساسي والاحتياطي معاً">
                <p className="acc-lead">
                  لا نعلن «أُرسلت» لما لم يُرسل. الرسائل تُحتجز في الطابور بحالة «بانتظار قناة» لا
                  «فشل نهائي»، ويُعاد المحاولة تلقائياً. عدّاد الاحتجاز ظاهر، ولا يُحذف حدث صامتاً.
                </p>
                <p className="acc-choice__note">
                  محتجَز بانتظار قناة:{" "}
                  <span className="sting-mono">{data.queue.held_waiting_channel}</span>
                </p>
              </Notice>
            ) : null}
            {state === "partial" && data ? (
              <Notice kind="warning" title="جزئي">
                <p className="acc-lead">
                  نفدت حصة الرسائل النصية للحملات. أوقفنا حملات التسويق أولاً، وتبقى رسائل التشغيل
                  الحرجة (تأكيد طلب، تنبيه دفع) تمرّ عبر المزوّد الاحتياطي. التجار أصحاب الحملات
                  المؤجَّلة أُبلغوا أن حملتهم <strong>مؤجَّلة لا فاشلة</strong>.
                </p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="info" title="لا طابور إرسال الآن">
                <p className="acc-lead">
                  كل ما أُرسل تأكّد تسليمه أو انتهى بحالة نهائية. هذا وضع سليم لا خطأ، فلا نعرض
                  جدولاً فارغاً موحياً بعطل.
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                <dl className="mp-preview">
                  <dt>أُرسل اليوم</dt>
                  <dd>
                    <span className="sting-mono">{data.sent_today}</span>
                    <div className="mp-reason">تشغيل + تسويق</div>
                  </dd>
                  <dt>حصة الرسائل المتبقّية</dt>
                  <dd>
                    <span className="sting-mono">{data.quota.remaining}</span>
                    <div className="mp-reason">
                      {data.quota.remaining === 0
                        ? "نفدت للحملات · تشغيل عبر الاحتياطي"
                        : "الحصة اليومية · يُعاد ضبطها منتصف الليل"}
                    </div>
                  </dd>
                  <dt>في الطابور</dt>
                  <dd>
                    <span className="sting-mono">
                      {data.queue.queued + data.queue.unconfirmed + data.queue.temp_failed}
                    </span>
                    <div className="mp-reason">
                      {data.queue.deferred_campaigns > 0 ? (
                        <>
                          <span className="sting-mono">{data.queue.deferred_campaigns}</span> حملات
                          مؤجَّلة تنتظر إعادة الحصة
                        </>
                      ) : data.queue.announcements_due > 0 ? (
                        <>
                          إعلانات منصة تُرسل خلال ساعة:{" "}
                          <span className="sting-mono">{data.queue.announcements_due}</span>
                        </>
                      ) : (
                        "لا حملات مؤجَّلة"
                      )}
                    </div>
                  </dd>
                  <dt>نسبة التسليم</dt>
                  <dd>
                    <span className="sting-mono">{data.delivery_rate_hour}%</span>
                    <div className="mp-reason">قياس آخر ساعة</div>
                  </dd>
                </dl>
                <h3 className="cat-head__title">القنوات والمزوّدون</h3>
                <p className="acc-choice__note">لا مفاتيح ولا أسرار معروضة</p>
                <Table
                  caption="القنوات والمزوّدون"
                  columns={columns}
                  rows={data.channels}
                  rowKey={(c) => c.key}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
