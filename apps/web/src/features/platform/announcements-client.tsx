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
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "ready" | "validation_error" | "saving" | "success";

interface Announcement {
  id: string;
  kind: "maintenance" | "notice";
  kind_label: string;
  title: string;
  body: string;
  audience: "all" | "market";
  audience_label: string;
  starts_at: string;
  ends_at: string;
  status: "draft" | "scheduled" | "cancelled" | "done";
  status_label: string;
  audience_count: number;
  created_by_name: string;
  scheduled_at: string;
  cancelled_by_name: string;
}

interface Preview {
  targeted: number;
  segments: { label: string; count: number; note: string; included: boolean; fixed?: boolean }[];
  promise_outside_plan: boolean;
  outside_count: number;
}

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
const storesWord = (n: number) =>
  n === 1 ? "متجر واحد" : n === 2 ? "متجران" : n <= 10 ? `${n} متاجر` : `${n} متجراً`;
const localIso = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** PLT-04 — إعلانات المنصة وصيانة (26-D19 ready/success · 39-D31 validation_error/saving): الجمهور المتأثّر يظهر قبل الجدولة. */
export function AnnouncementsClient() {
  const router = useRouter();
  const [rows, setRows] = useState<Announcement[]>([]);
  const [kind, setKind] = useState<"maintenance" | "notice">("maintenance");
  const [audience, setAudience] = useState<"all" | "market">("market");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [starts, setStarts] = useState(() => localIso(new Date(Date.now() + 6 * 3_600_000)));
  const [ends, setEnds] = useState(() =>
    localIso(new Date(Date.now() + 6 * 3_600_000 + 40 * 60_000)),
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [draftId, setDraftId] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState("");
  const [scheduled, setScheduled] = useState<Announcement | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/announcements");
    const b = data as unknown as { announcements: Announcement[] } | undefined;
    if (response.ok && b) setRows(b.announcements);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!operatorToken()) return;
    const t = setTimeout(() => {
      void (async () => {
        const { data, response } = await platformApi().POST("/api/platform/announcements/preview", {
          body: { audience, body, kind } as never,
        });
        const b = data as unknown as Preview | undefined;
        if (response.ok && b) setPreview(b);
      })().catch(() => undefined);
    }, 150);
    return () => clearTimeout(t);
  }, [audience, body, kind]);

  const save = async (): Promise<Announcement | null> => {
    const r = await platformApi().POST("/api/platform/announcements", {
      body: {
        id: draftId || undefined,
        kind,
        audience,
        title,
        body,
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(ends).toISOString(),
      } as never,
    });
    const b = (r.data ?? r.error) as unknown as
      { announcement?: Announcement; detail?: string } | undefined;
    if (r.response.ok && b?.announcement) {
      setDraftId(b.announcement.id);
      return b.announcement;
    }
    setErr(b?.detail ?? "server_error");
    return null;
  };

  const onSave = async () => {
    if (busy) return;
    setBusy("save");
    setErr("");
    try {
      const a = await save();
      if (a) {
        setSaved(true);
        await load();
      }
    } finally {
      setBusy("");
    }
  };

  const onSchedule = async () => {
    if (busy) return;
    if (preview?.promise_outside_plan) {
      setErr("promise_outside_plan");
      return;
    }
    setBusy("schedule");
    setErr("");
    try {
      const a = await save();
      if (!a) return;
      const r = await platformApi().POST("/api/platform/announcements/{announcement_id}/{action}", {
        params: { path: { announcement_id: a.id, action: "schedule" } },
        body: {} as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { announcement?: Announcement; detail?: string } | undefined;
      if (r.response.ok && b?.announcement) {
        setScheduled(b.announcement);
        await load();
      } else setErr(b?.detail ?? "server_error");
    } finally {
      setBusy("");
    }
  };

  const cancel = async (a: Announcement) => {
    if (busy) return;
    setBusy(`cancel:${a.id}`);
    try {
      await platformApi().POST("/api/platform/announcements/{announcement_id}/{action}", {
        params: { path: { announcement_id: a.id, action: "cancel" } },
        body: {} as never,
      });
      await load();
    } finally {
      setBusy("");
    }
  };

  const state: State = scheduled
    ? "success"
    : busy === "schedule"
      ? "saving"
      : err === "promise_outside_plan" || preview?.promise_outside_plan
        ? "validation_error"
        : "ready";

  return (
    <PlatformFrame current="announcements">
      <div className="sys mp cus plt-frame" data-screen="PLT-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              إعلانات المنصة وصيانة — الجمهور المتأثّر يظهر قبل الجدولة
            </h2>
            <span className="cat-head__hint">
              قبل أن يُجدول أي إعلان، يرى المشغّل بالضبط من سيصله ومتى. ولا يُعلن عن ميزة مقيّدة
              بباقة لمن لا يملكها (G-ref ACC-104).
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && scheduled ? (
              <Notice
                kind="success"
                title={`جُدول الإعلان — ${storesWord(scheduled.audience_count)}`}
                action={
                  <Button
                    onClick={() => {
                      setScheduled(null);
                      setDraftId("");
                      setTitle("");
                      setBody("");
                      setSaved(false);
                    }}
                  >
                    إعلان جديد
                  </Button>
                }
              >
                <p className="acc-lead">
                  يُرسل قبل النافذة بساعة وعند بدئها وعند انتهائها. الحالة «مجدول» قابلة للإلغاء حتى
                  دقيقة الإرسال، والإلغاء يُسجَّل باسم من نفّذه.
                </p>
              </Notice>
            ) : null}
            {state === "saving" ? (
              <Notice kind="info" title="جارٍ الجدولة">
                <p className="acc-lead">
                  إعلان الصيانة يُجدول قبل موعده بوقت كافٍ، والجدولة تُسجَّل ولا تُرسل.
                </p>
                <p className="acc-choice__note">
                  <strong>نافذة الصيانة</strong> · تُعرض بتوقيت المستأجر لا بتوقيت الخادم. «٢ ص»
                  لمن؟ السؤال يُجاب هنا لا في ذهن القارئ.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="warning" title="إعلان يَعِد بما ليس في الباقة">
                <p className="acc-lead">
                  نصٌّ يذكر ميزة غير متاحة لكل الجماهير المختارة (ACC-104).
                </p>
                <p className="acc-choice__note">
                  <strong>نُطابق النصّ بالجمهور</strong> · ونمنع الإرسال حتى يُضيَّق الجمهور أو
                  يُعدَّل النصّ. إعلانٌ مضلِّل من المنصّة أسوأ من إعلان تاجر.
                </p>
                <p className="acc-choice__note">
                  <strong>قيد</strong> · لا يمكن اختيار «ميزة سوق مميّزة» في نص موجَّه لباقة لا
                  تشملها — الحقل يمنع الصياغة المضلِّلة عند الاختيار.{" "}
                  {preview ? (
                    <>
                      <span className="sting-mono">{preview.outside_count}</span>{" "}
                      {preview.outside_count === 1 ? "متجر" : "متاجر"} بلا سوق في الجمهور المختار.
                    </>
                  ) : null}
                </p>
              </Notice>
            ) : null}
            {err && err !== "promise_outside_plan" ? (
              <Notice kind="warning" title="لم يُحفظ">
                <p className="acc-lead">
                  {err === "window_invalid"
                    ? "نهاية النافذة قبل بدايتها."
                    : err === "window_in_past"
                      ? "النافذة في الماضي — الإعلان يُجدول قبل موعده بوقت كافٍ."
                      : err === "title_and_body_required"
                        ? "العنوان والنص مطلوبان."
                        : err}
                </p>
              </Notice>
            ) : null}

            {!scheduled ? (
              <>
                <div className="acc-actions">
                  {saved ? <Status state="saved_local" label="تم الحفظ" /> : null}
                </div>
                <h3 className="cat-head__title">صياغة إعلان صيانة مجدولة</h3>
                <p className="acc-choice__note">
                  نافذة صيانة على مزامنة السوق — لا تمسّ POS المحلي
                </p>
                <div className="pos-chips" role="group" aria-label="النوع">
                  {(
                    [
                      ["maintenance", "صيانة مجدولة"],
                      ["notice", "إعلان"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`pos-chip${kind === k ? " pos-chip--on" : ""}`}
                      onClick={() => setKind(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <TextField
                  label="العنوان"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <TextField
                  label="النص المعروض للتاجر"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  hint="نقاط البيع تعمل بالكامل محلياً والمزامنة تُستأنف تلقائياً بعد النافذة."
                />
                <TextField
                  label="بداية النافذة (بتوقيتك)"
                  kind="text"
                  mono
                  value={starts}
                  onChange={(e) => setStarts(e.target.value)}
                />
                <TextField
                  label="نهاية النافذة (بتوقيتك)"
                  kind="text"
                  mono
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
                />
                <div className="pos-chips" role="group" aria-label="الجمهور">
                  {(
                    [
                      ["market", "متاجر ذات مزامنة سوق فعّالة"],
                      ["all", "كل المتاجر"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`pos-chip${audience === k ? " pos-chip--on" : ""}`}
                      onClick={() => setAudience(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="acc-choice__note">
                  <strong>قيد</strong> · لا يمكن اختيار «ميزة سوق مميّزة» في نص موجَّه لباقة لا
                  تشملها — الحقل يمنع الصياغة المضلِّلة عند الاختيار.
                </p>

                <h3 className="cat-head__title">الجمهور المتأثّر — قبل الجدولة</h3>
                {preview ? (
                  <>
                    <ul className="cus-list">
                      {preview.segments.map((s) => (
                        <li key={s.label}>
                          <strong>{s.label}</strong>
                          <div className="cus-sub">{s.note}</div>
                          <Status
                            state={s.fixed ? "expired" : s.included ? "success" : "stale"}
                            label={s.fixed ? "مستبعَد" : `${s.count} مستهدَف`}
                          />
                        </li>
                      ))}
                    </ul>
                    <p className="acc-choice__note">
                      <span className="sting-mono">{preview.targeted}</span> مستهدَف · الرقم أعلاه
                      يتحدّث حيّاً مع كل تعديل في الاستهداف. لا يُجدول الإعلان قبل أن يؤكّد المشغّل
                      هذا العدد.
                    </p>
                  </>
                ) : null}
                <div className="acc-actions">
                  <Button
                    loading={busy === "save"}
                    onClick={() => void onSave()}
                    disabledReason={
                      !title.trim() || !body.trim() ? "العنوان والنص مطلوبان" : undefined
                    }
                  >
                    حفظ
                  </Button>
                  <Button
                    pos
                    loading={busy === "schedule"}
                    onClick={() => void onSchedule()}
                    disabledReason={
                      !title.trim() || !body.trim()
                        ? "العنوان والنص مطلوبان"
                        : preview?.promise_outside_plan
                          ? "النصّ يَعِد بما ليس في الباقة"
                          : undefined
                    }
                  >
                    جدولة — {preview ? storesWord(preview.targeted) : "…"}
                  </Button>
                </div>
              </>
            ) : null}

            {rows.length ? (
              <>
                <h3 className="cat-head__title">الإعلانات</h3>
                <ul className="cus-list">
                  {rows.map((a) => (
                    <li key={a.id}>
                      <strong>{a.title}</strong>
                      <div className="cus-sub">
                        {a.kind_label} · {a.audience_label} · <When iso={a.starts_at} /> —{" "}
                        <span className="sting-mono">{hhmm(a.ends_at)}</span>
                        {a.status === "scheduled" ? ` · ${storesWord(a.audience_count)}` : ""}
                        {a.cancelled_by_name ? ` · ألغاه ${a.cancelled_by_name}` : ""}
                      </div>
                      <Status
                        state={
                          a.status === "scheduled"
                            ? "success"
                            : a.status === "cancelled"
                              ? "expired"
                              : "saved_local"
                        }
                        label={a.status_label}
                      />
                      {a.status === "scheduled" ? (
                        <Button
                          variant="quiet"
                          loading={busy === `cancel:${a.id}`}
                          onClick={() => void cancel(a)}
                        >
                          إلغاء — يُسجَّل باسمك
                        </Button>
                      ) : null}
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
