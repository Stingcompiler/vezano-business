"use client";

import { Button, Notice, Status, Table, TextField } from "@sting/ui-web";
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

type State = "loading" | "ready" | "empty" | "partial";

interface Dispute {
  id: string;
  tenant_id: string;
  ref_label: string;
  parties: string;
  subject: string;
  turn_label: string;
  remaining_hours: number;
  overdue_hours: number;
  days_open: number;
  hours_to_limit: number;
  near_limit: boolean;
  over_limit: boolean;
  referred: boolean;
  referred_by_name: string;
  mediator_requested: boolean;
  mediator_note: string;
  evidence_count: number;
  limit_note: string;
}
interface Payload {
  state: "ready" | "empty" | "partial";
  disputes: Dispute[];
  open_count: number;
  near_limit_count: number;
  avg_response_hours: number;
  response_target_hours: number;
  within_target: boolean;
  referred_week: number;
  closed_30d: number;
  intervention_days: number;
}

/** PLT-08 — متابعة الخلافات (26-D19): حدّ التدخّل وزمن الاستجابة، لا تسوية دفتر تلقائية (ACC-148). */
export function DisputesOpsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [noteFor, setNoteFor] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/disputes");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const act = async (d: Dispute, action: "suggest" | "refer") => {
    if (busy) return;
    setBusy(`${action}:${d.id}`);
    try {
      const r = await platformApi().POST(
        "/api/platform/disputes/{tenant_id}/{dispute_id}/{action}",
        {
          params: { path: { tenant_id: d.tenant_id, dispute_id: d.id, action } },
          body: { note } as never,
        },
      );
      if (r.response.ok) {
        setNoteFor("");
        setNote("");
        await load();
      }
    } finally {
      setBusy("");
    }
  };

  const state: State = data ? data.state : "loading";
  const columns = [
    {
      key: "parties",
      header: "الخلاف والطرفان",
      render: (d: Dispute) => (
        <>
          <strong>{d.parties}</strong>
          <div className="mp-check__hint">
            <span className="sting-mono">{d.ref_label}</span> · مفتوح منذ{" "}
            <span className="sting-mono">{d.days_open}</span>{" "}
            {d.days_open === 1
              ? "يوم"
              : d.days_open === 2
                ? "يومين"
                : d.days_open <= 10
                  ? "أيام"
                  : "يوماً"}
          </div>
        </>
      ),
    },
    { key: "subject", header: "الموضوع", render: (d: Dispute) => d.subject },
    {
      key: "response",
      header: "زمن الاستجابة",
      render: (d: Dispute) => (
        <>
          {d.turn_label} ·{" "}
          {d.overdue_hours > 0 ? (
            <>
              متأخر <span className="sting-mono">{d.overdue_hours}</span> ساعة
            </>
          ) : (
            <>
              متبقٍّ <span className="sting-mono">{d.remaining_hours}</span> ساعة
            </>
          )}
        </>
      ),
    },
    {
      key: "limit",
      header: "حدّ التدخّل",
      render: (d: Dispute) => (
        <>
          <Status
            state={
              d.referred
                ? "expired"
                : d.over_limit
                  ? "conflict"
                  : d.near_limit
                    ? "partial"
                    : "synced"
            }
            label={
              d.referred
                ? "أُحيل"
                : d.over_limit
                  ? "تجاوز الحدّ"
                  : d.near_limit
                    ? "قرب الحدّ"
                    : "قيد المتابعة"
            }
          />
          <div className="mp-check__hint">{d.limit_note}</div>
          {!d.referred ? (
            <div className="acc-actions">
              <Button
                variant="quiet"
                onClick={() => {
                  setNoteFor(noteFor === d.id ? "" : d.id);
                  setNote(d.mediator_note);
                }}
              >
                اقترح مساراً
              </Button>
              {d.near_limit || d.over_limit ? (
                <Button
                  variant="quiet"
                  loading={busy === `refer:${d.id}`}
                  onClick={() => void act(d, "refer")}
                >
                  إحالة لمسار خارجي معلَن
                </Button>
              ) : null}
            </div>
          ) : null}
          {noteFor === d.id ? (
            <>
              <TextField
                label="المسار المقترَح — يراه الطرفان"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="acc-actions">
                <Button
                  loading={busy === `suggest:${d.id}`}
                  onClick={() => void act(d, "suggest")}
                  disabledReason={note.trim() ? undefined : "اكتب المسار المقترَح"}
                >
                  تسجيل المسار
                </Button>
              </div>
            </>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <PlatformFrame current="disputes">
      <div className="sys mp cus plt-frame" data-screen="PLT-08" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              متابعة الخلافات — حدّ التدخّل وزمن الاستجابة، لا تسوية دفتر تلقائية
            </h2>
            <span className="cat-head__hint">
              المنصة تُيسّر التواصل وتقيس زمن الاستجابة، ولا تُصدر حكماً مالياً بين طرفين. تسوية
              الذمم تبقى بينهما (ACC-148).
            </span>
          </div>
          <div className="acc-card__body">
            {data ? (
              <dl className="mp-preview">
                <dt>خلافات مفتوحة</dt>
                <dd>
                  <span className="sting-mono">{data.open_count}</span>
                  <div className="mp-reason">
                    <span className="sting-mono">{data.near_limit_count}</span> قرب تجاوز حدّ
                    التدخّل
                  </div>
                </dd>
                <dt>متوسط زمن الاستجابة</dt>
                <dd>
                  <span className="sting-mono">{data.avg_response_hours}</span> ساعة
                  <div className="mp-reason">
                    {data.within_target ? "ضمن الهدف المعلَن" : "فوق الهدف المعلَن"} (
                    <span className="sting-mono">{data.response_target_hours}h</span>)
                  </div>
                </dd>
                <dt>أُحيل لمسار خارجي</dt>
                <dd>
                  <span className="sting-mono">{data.referred_week}</span>
                  <div className="mp-reason">تجاوز حدّ التدخّل هذا الأسبوع</div>
                </dd>
                <dt>أُغلق ودّياً</dt>
                <dd>
                  <span className="sting-mono">{data.closed_30d}</span>
                  <div className="mp-reason">
                    خلال <span className="sting-mono">30</span> يوماً · بلا تسوية دفتر آلية
                  </div>
                </dd>
              </dl>
            ) : null}
            <div className="acc-actions">
              <Status
                state={state === "partial" ? "partial" : state === "empty" ? "synced" : "stale"}
                label={state === "partial" ? "قرب الحدّ" : "قيد المتابعة"}
              />
            </div>
            <h3 className="cat-head__title">الخلافات المفتوحة</h3>
            <p className="acc-choice__note">مرتّبة بزمن الاستجابة المتبقّي</p>
            <Table
              caption="الخلافات المفتوحة"
              columns={columns}
              rows={data?.disputes ?? []}
              rowKey={(d) => d.id}
              loading={data ? undefined : 3}
              empty={
                <Notice kind="empty" title="لا خلافات مفتوحة">
                  <p className="acc-lead">
                    وضع صحّي. السجل التاريخي للخلافات المُغلقة متاح للمراجعة، لكن لا صفوف نشطة الآن.
                  </p>
                </Notice>
              }
            />
            <p className="acc-choice__note">
              <strong>حدّ التدخّل ثابت في كل صف:</strong> المنصة تفتح قناة، وتحفظ الأدلة المرفوعة،
              وتقيس زمن الاستجابة، وتقترح مساراً. لا تُحرّك رصيداً ولا تُلزم طرفاً بمبلغ. متى تجاوز
              الخلاف حدّها، يُحال إلى مسار خارجي مُعلَن لا إلى قرار داخلي صامت.
            </p>
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
