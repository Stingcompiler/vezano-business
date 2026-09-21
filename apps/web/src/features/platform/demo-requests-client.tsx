"use client";

import { Button, Frame, Notice, Status, TextAreaField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/public/public.css";
import "./platform.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformNav } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "empty" | "permission_denied";
type ReqStatus = "new" | "contacted" | "converted" | "closed";
type Filter = "open" | "all" | ReqStatus;

interface DemoRequest {
  id: string;
  name: string;
  whatsapp: string;
  email: string;
  channel: "whatsapp" | "call" | "email";
  channel_label: string;
  message: string;
  status: ReqStatus;
  status_label: string;
  note: string;
  created_at: string;
  handled_at: string;
  handled_by_name: string;
  next: ReqStatus[];
}
interface Payload {
  requests: DemoRequest[];
  filter: string;
  counts: Record<ReqStatus | "open", number>;
  fetched_at: string;
  rule: string;
}

const STATUS_LABEL: Record<ReqStatus, string> = {
  new: "جديد",
  contacted: "تواصلنا",
  converted: "تحوّل",
  closed: "أُغلق",
};
const NEXT_LABEL: Record<ReqStatus, string> = {
  new: "أعد الفتح",
  contacted: "تواصلنا",
  converted: "تحوّل إلى منشأة",
  closed: "أغلق",
};
const TONE: Record<ReqStatus, "pending_sync" | "stale" | "success" | "expired"> = {
  new: "pending_sync",
  contacted: "stale",
  converted: "success",
  closed: "expired",
};
const ERRORS: Record<string, string> = {
  note_required: "الإغلاق والتحوّل يحتاجان ملاحظة: ماذا حدث؟",
  bad_transition: "انتقال غير مسموح من هذه الحالة.",
  nothing_to_change: "لا تغيير — اختر حالة أو اكتب ملاحظة.",
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

/** PLT-14 — طلبات «اطلب الجولة» من الهبوط بحالتها؛ التواصل بشري على القناة المختارة (G-02). */
export function DemoRequestsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (f: Filter) => {
      if (!operatorToken()) {
        router.replace("/platform/login");
        return;
      }
      const { data: d, response } = await platformApi().GET("/api/platform/demo-requests", {
        params: { query: { status: f } },
      });
      if (response.status === 403 || response.status === 401) {
        setDenied(true);
        return;
      }
      const b = d as unknown as Payload | undefined;
      if (response.ok && b) setData(b);
    },
    [router],
  );

  useEffect(() => {
    void load(filter).catch(() => undefined);
  }, [load, filter]);

  const apply = async (r: DemoRequest, status: ReqStatus | "") => {
    setError("");
    setBusy(true);
    try {
      const res = await platformApi().POST("/api/platform/demo-requests/{request_id}", {
        params: { path: { request_id: r.id } },
        body: { status, note } as never,
      });
      const b = (res.data ?? res.error) as unknown as { detail?: string } | undefined;
      if (res.response.ok) {
        setNote("");
        setOpenId("");
        await load(filter);
      } else {
        const code = b?.detail ?? "";
        setError(ERRORS[code] ?? `تعذّر التنفيذ (${code || res.response.status})`);
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : !data
      ? "loading"
      : data.requests.length === 0
        ? "empty"
        : "ready";

  return (
    <Frame title="إدارة فيزانو" navLayout="top" nav={<PlatformNav current="demo" />} footer={null}>
      <div className="sys plt-frame" data-screen="PLT-14" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">طلبات الجولة — من صفحة الهبوط</h2>
            <span className="cat-head__hint">
              كل طلب بقناته وحالته. لا إرسال آلي للطالب — التواصل بشري ويُسجَّل هنا باسمك ووقته.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الطلبات">
                <p className="acc-lead">الجديد أولاً — ما ينتظر فعلاً قبل ما أُغلق.</p>
              </Notice>
            ) : null}
            {denied ? (
              <Notice kind="warning" title="مساحة المشغّل فقط">
                <p className="acc-lead">طلبات الجولة بيانات أشخاص — لا تُفتح بغير صفة مشغّل.</p>
              </Notice>
            ) : null}
            {data ? (
              <>
                <div className="home-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">ينتظر</div>
                    <div className="home-kpi__value sting-mono">{data.counts.open}</div>
                    <div className="home-kpi__note">جديد + تواصلنا</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">جديد</div>
                    <div className="home-kpi__value sting-mono">{data.counts.new}</div>
                    <div className="home-kpi__note">لم يُتواصل معه بعد</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">تحوّل</div>
                    <div className="home-kpi__value sting-mono">{data.counts.converted}</div>
                    <div className="home-kpi__note">سجّل منشأة</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">أُغلق</div>
                    <div className="home-kpi__value sting-mono">{data.counts.closed}</div>
                    <div className="home-kpi__note">بملاحظة</div>
                  </div>
                </div>
                <div className="pos-chips" role="group" aria-label="الحالة">
                  {(
                    [
                      ["open", "ينتظر"],
                      ["new", "جديد"],
                      ["contacted", "تواصلنا"],
                      ["converted", "تحوّل"],
                      ["closed", "أُغلق"],
                      ["all", "الكل"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`pos-chip${filter === k ? " pos-chip--on" : ""}`}
                      aria-pressed={filter === k}
                      onClick={() => setFilter(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {state === "empty" ? (
                  <Notice kind="empty" title="لا طلبات في هذا المرشّح">
                    <p className="acc-lead">
                      {filter === "open"
                        ? "لا طلب ينتظر — كل ما وصل تُوبع."
                        : "لا طلبات بهذه الحالة."}
                    </p>
                  </Notice>
                ) : null}
                <ul className="plt-demo">
                  {data.requests.map((r) => (
                    <li key={r.id} className="plt-demo__item" data-status={r.status}>
                      <div className="plt-demo__top">
                        <strong>{r.name}</strong>
                        <Status state={TONE[r.status]} label={STATUS_LABEL[r.status]} />
                      </div>
                      <div className="cus-sub">
                        {r.channel_label} · <span className="sting-mono">{r.whatsapp}</span>
                        {r.email ? (
                          <>
                            {" "}
                            · <span className="sting-mono">{r.email}</span>
                          </>
                        ) : null}{" "}
                        · وصل <When iso={r.created_at} />
                      </div>
                      {r.message ? <p className="plt-demo__msg">{r.message}</p> : null}
                      {r.note ? (
                        <p className="cus-sub">
                          <strong>ملاحظة</strong> · {r.note}
                          {r.handled_by_name ? (
                            <>
                              {" "}
                              — {r.handled_by_name} · <When iso={r.handled_at} />
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {openId === r.id ? (
                        <div className="plt-demo__act">
                          <TextAreaField
                            label="ملاحظة"
                            hint="إلزامية عند التحوّل أو الإغلاق"
                            rows={2}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                          />
                          <div className="acc-actions">
                            {r.next.map((n) => (
                              <Button
                                key={n}
                                variant={n === "closed" ? "secondary" : "primary"}
                                loading={busy}
                                onClick={() => void apply(r, n)}
                              >
                                {NEXT_LABEL[n]}
                              </Button>
                            ))}
                            <Button
                              variant="quiet"
                              loading={busy}
                              onClick={() => void apply(r, "")}
                            >
                              احفظ الملاحظة فقط
                            </Button>
                            <Button
                              variant="quiet"
                              onClick={() => {
                                setOpenId("");
                                setError("");
                              }}
                            >
                              إلغاء
                            </Button>
                            {error ? <Status state="validation_error" label={error} /> : null}
                          </div>
                        </div>
                      ) : (
                        <div className="acc-actions">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setOpenId(r.id);
                              setNote("");
                              setError("");
                            }}
                          >
                            تابِع
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">{data.rule}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
