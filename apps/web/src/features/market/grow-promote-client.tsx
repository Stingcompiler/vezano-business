"use client";

import { Button, formatMinor, Frame, Notice, PhaseLocked, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import { PhaseScreenClient } from "@/features/phase/phase-screen-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "permission_denied";

interface Req {
  id: string;
  offer_id: string;
  offer_name: string;
  audience: string;
  audience_label: string;
  area: string;
  duration_days: number;
  status: "draft" | "pricing_pending" | "cancelled";
  status_label: string;
  prepared_by_name: string;
  requested_by_name: string;
}
interface Payload {
  state: "ready" | "phase_locked";
  pricing_locked: boolean;
  pricing_lock_label: string;
  can_request: boolean;
  can_prepare: boolean;
  offers: { offer_id: string; public_name: string; pack_label: string }[];
  audiences: { code: string; label: string }[];
  requests: Req[];
}
interface Preview {
  promoted: { public_name: string; pack_label: string; price_minor: string; tag: string };
  neighbors: { public_name: string; pack_label: string; price_minor: string }[];
}

/** GROW-03 — طلب عرض ممول ومعاينته (21-D16 ready · 38-D30 validation_error/permission_denied): الإعلان يُوسم إعلاناً؛ قفلان لا واحد. */
export function GrowPromoteClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [offerId, setOfferId] = useState("");
  const [audience, setAudience] = useState("");
  const [area, setArea] = useState("");
  const [duration, setDuration] = useState("");
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; missing: string[] } | null>(null);
  const [saved, setSaved] = useState<Req | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/grow/promote");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fgrow%2Fpromote");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const preview = async (id: string) => {
    setOfferId(id);
    const { data, response } = await api().GET("/api/grow/promote", {
      params: { query: { preview: id } },
    });
    const b = data as unknown as Preview | undefined;
    if (response.ok && b?.promoted) setPv(b);
  };

  const submit = async (action: "save" | "request") => {
    if (busy) return;
    setBusy(action);
    setErr(null);
    try {
      const r = await api().POST("/api/grow/promote", {
        body: {
          offer_id: offerId,
          audience,
          area,
          duration_days: duration ? Number(duration) : 0,
          action,
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        | {
            request?: Req;
            detail?: string;
            extra?: { missing?: string[]; owner_required?: boolean };
          }
        | undefined;
      if (r.response.ok && b?.request) {
        setSaved(b.request);
        await load();
        return;
      }
      setErr({ code: b?.detail ?? "server_error", missing: b?.extra?.missing ?? [] });
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreenClient id="GROW-03" />;

  const state: State =
    err?.code === "permission_denied"
      ? "permission_denied"
      : err?.code === "audience_or_duration_required"
        ? "validation_error"
        : "ready";

  return (
    <Frame title="النموّ" nav={<AppNav currentId="market-share" />} footer={null}>
      <div className="sys mp cus" data-screen="GROW-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">GROW-03 — عرض ممول</h2>
            <span className="cat-head__hint">الإعلان يُوسم إعلاناً</span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice
                kind="locked"
                title="الطلب للمالك"
                action={<Button onClick={() => setErr(null)}>فهمت</Button>}
              >
                <p className="acc-lead">
                  ناشر الكتالوج يُعدّ العرض ولا يطلب تمويله — الطلب التزام مالي.
                </p>
                <p className="acc-choice__note">
                  <strong>المخرج</strong> · يُعدّه ويحفظه ويطلب من المالك إرساله، فلا يُهدر عمله.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="warning" title="طلب بلا جمهور أو مدة">
                <p className="acc-lead">الجمهور غير محدَّد أو المدة فارغة.</p>
                <p className="acc-choice__note">
                  <strong>لا افتراض</strong> · لا نفترض «كل المشترين» جمهوراً افتراضياً. الجمهور
                  الواسع بلا اختيار صريح إنفاقٌ بلا قصد.
                </p>
              </Notice>
            ) : null}
            {err && !["permission_denied", "audience_or_duration_required"].includes(err.code) ? (
              <Notice kind="warning" title="لم يُحفظ الطلب">
                <p className="acc-lead">
                  {err.code === "area_required"
                    ? "اختر منطقة الخدمة."
                    : err.code === "already_requested"
                      ? "الطلب مرسَل من قبل — بانتظار التسعير."
                      : err.code}
                </p>
              </Notice>
            ) : null}
            {saved ? (
              <Notice
                kind="success"
                title={
                  saved.status === "pricing_pending"
                    ? "أُرسل الطلب — التسعير غير معتمد، يتواصل الفريق"
                    : "حُفظ الطلب — بانتظار المالك ليرسله"
                }
                action={<Button onClick={() => setSaved(null)}>التالي</Button>}
              >
                <p className="acc-lead">
                  {saved.offer_name} · {saved.audience_label} ·{" "}
                  <span className="sting-mono">{saved.duration_days}</span> يوماً ·{" "}
                  {saved.status_label}
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                <div className="acc-actions">
                  <Status state="stale" label={data.pricing_lock_label} />
                </div>
                <ul className="pub-list">
                  <li>
                    <span className="pub-mark">·</span>
                    <span>وسم «عرض ممول» ظاهر في نتيجة البحث بحجم نص العنوان لا بخط صغير.</span>
                  </li>
                  <li>
                    <span className="pub-mark">·</span>
                    <span>
                      الترتيب الممول لا يُخفي نتيجة أقرب أو أرخص — يظهر بجوارها لا مكانها.
                    </span>
                  </li>
                  <li>
                    <span className="pub-mark">·</span>
                    <span>المعاينة تُري التاجر شكل إعلانه كما يراه المشتري قبل الدفع.</span>
                  </li>
                  <li>
                    <span className="pub-mark">·</span>
                    <span>
                      تفاصيل التسعير قرار مفتوح خارج التصميم؛ الشاشة تعرض الهيكل وتترك الرقم لقرار
                      تجاري.
                    </span>
                  </li>
                </ul>
                <PhaseLocked
                  kind="M4"
                  title="التسعير غير معتمد"
                  explanation="M4 مفتوحة، والتسعير نفسه قرار مفتوح (G-04) — لا واجهة دفع ولا رقم؛ الطلب داخلي: وسم وجمهور ومدة."
                  activateLabel="التسعير قرار تجاري خارج الشاشة"
                >
                  <p className="acc-choice__note">لا واجهة دفع · طلب داخلي بلا رقم</p>
                </PhaseLocked>

                <h3 className="cat-head__title">العرض</h3>
                <div className="pos-chips" role="group" aria-label="العرض">
                  {data.offers.map((o) => (
                    <button
                      key={o.offer_id}
                      type="button"
                      className={`pos-chip${offerId === o.offer_id ? " pos-chip--on" : ""}`}
                      onClick={() => void preview(o.offer_id)}
                    >
                      {o.public_name}
                    </button>
                  ))}
                </div>
                {pv ? (
                  <>
                    <h3 className="cat-head__title">المعاينة — كما يراه المشتري</h3>
                    <ul className="cus-list">
                      <li>
                        <strong>
                          {pv.promoted.public_name} · {pv.promoted.pack_label}
                        </strong>
                        <div className="cus-sub">
                          {pv.promoted.price_minor ? (
                            <span className="sting-mono">
                              {formatMinor(pv.promoted.price_minor)}
                            </span>
                          ) : (
                            "اطلب تأكيد سعر"
                          )}
                        </div>
                        <Status state="stale" label={pv.promoted.tag} />
                      </li>
                      {pv.neighbors.map((n, i) => (
                        <li key={i}>
                          <strong>
                            {n.public_name} · {n.pack_label}
                          </strong>
                          <div className="cus-sub">
                            {n.price_minor ? (
                              <span className="sting-mono">{formatMinor(n.price_minor)}</span>
                            ) : (
                              "اطلب تأكيد سعر"
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <h3 className="cat-head__title">الجمهور</h3>
                <div className="pos-chips" role="group" aria-label="الجمهور">
                  {data.audiences.map((a) => (
                    <button
                      key={a.code}
                      type="button"
                      className={`pos-chip${audience === a.code ? " pos-chip--on" : ""}`}
                      onClick={() => setAudience(a.code)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                {audience === "area" ? (
                  <TextField
                    label="منطقة الخدمة"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                  />
                ) : null}
                <TextField
                  label="المدة بالأيام"
                  kind="number"
                  mono
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
                <div className="acc-actions">
                  <Button
                    pos
                    loading={busy === "request"}
                    onClick={() => void submit("request")}
                    disabledReason={offerId ? undefined : "اختر العرض"}
                  >
                    اطلب العرض الممول
                  </Button>
                  <Button
                    loading={busy === "save"}
                    onClick={() => void submit("save")}
                    disabledReason={offerId ? undefined : "اختر العرض"}
                  >
                    احفظ واطلب من المالك إرساله
                  </Button>
                </div>
                {data.requests.length ? (
                  <>
                    <h3 className="cat-head__title">طلباتك</h3>
                    <ul className="cus-list">
                      {data.requests.map((q) => (
                        <li key={q.id}>
                          <strong>{q.offer_name}</strong>
                          <div className="cus-sub">
                            {q.audience_label}
                            {q.area ? ` (${q.area})` : ""} ·{" "}
                            <span className="sting-mono">{q.duration_days}</span> يوماً ·{" "}
                            {q.status === "draft"
                              ? `أعدّه ${q.prepared_by_name}`
                              : `طلبه ${q.requested_by_name}`}
                          </div>
                          <Status
                            state={q.status === "pricing_pending" ? "stale" : "saved_local"}
                            label={q.status_label}
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
