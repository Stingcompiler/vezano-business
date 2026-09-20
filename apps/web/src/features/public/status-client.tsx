"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "./public.css";
import { hhmm } from "@/features/home/format";
import { PublicNav } from "@/features/public/public-nav";
import { apiBaseUrl } from "@/lib/api";

type State = "ready" | "stale" | "server_error";

interface Component {
  id: string;
  name: string;
  state: "ok" | "affected" | "down" | "not_launched";
  detail: string;
}

interface StatusPayload {
  checked_at: string;
  interval_seconds: number;
  components: Component[];
  maintenance: { notice: string; from: string; until: string };
  events: { at: string; text: string }[];
  overall: "ok" | "affected" | "down";
}

const SNAPSHOT_KEY = "pub.status";

/** حين لا يردّ الخادم: ما نعرفه يقيناً — البيع محلي، والباقي متوقف. */
const OUTAGE: StatusPayload = {
  checked_at: "",
  interval_seconds: 60,
  components: [
    {
      id: "pos",
      name: "البيع على الأجهزة المثبَّتة",
      state: "ok",
      detail: "محلي — لا يعتمد على الخادم",
    },
    { id: "sync", name: "المزامنة", state: "down", detail: "الرفع متوقف · المعلّق محفوظ عندك" },
    { id: "market", name: "السوق والطلبات", state: "down", detail: "التصفح والإرسال متوقفان" },
    {
      id: "sms",
      name: "بوابة الزبون والحملات",
      state: "affected",
      detail: "الطابور متوقف · لا رسائل ضائعة",
    },
  ],
  maintenance: { notice: "", from: "", until: "" },
  events: [
    { at: "", text: "تأكيد التعطل في المزامنة والسوق. البيع المحلي غير متأثر." },
    {
      at: "",
      text: "تقارير عن فشل المزامنة قيد التحقق. لم نؤكد بعد ولن نعلن «كل شيء سليم» قبل التحقق.",
    },
  ],
  overall: "down",
};

const LABEL: Record<Component["state"], string> = {
  ok: "يعمل",
  affected: "متوقفة جزئياً",
  down: "متوقفة",
  not_launched: "لم يُفتح بعد",
};

const TONE: Record<Component["state"], "success" | "stale" | "validation_error" | "phase_locked"> =
  {
    ok: "success",
    affected: "stale",
    down: "validation_error",
    not_launched: "phase_locked",
  };

function readSnapshot(): StatusPayload | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as StatusPayload) : null;
  } catch {
    return null;
  }
}

const hms = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** PUB-03 — حالة الخدمة والصيانة (37-D29 ready/stale · 09-D5 server_error). الصفحة تقرأ الخادم ولا تعتمد عليه. */
export function StatusClient() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setChecking(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`${apiBaseUrl()}/api/public/status`, {
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!r.ok) throw new Error(String(r.status));
      const body = (await r.json()) as StatusPayload;
      setData(body);
      setFetchFailed(false);
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(body));
      } catch {
        /* لا تخزين — لا بأس */
      }
    } catch {
      setFetchFailed(true);
      setData((d) => d ?? readSnapshot());
    } finally {
      clearTimeout(t);
      setNow(Date.now());
      if (manual) {
        setChecking(false);
        setCheckedAt(Date.now());
      }
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const shown = data ?? (fetchFailed ? OUTAGE : null);
  const state: State = !shown
    ? "ready"
    : fetchFailed && data
      ? "stale"
      : shown.overall === "down" || (fetchFailed && !data)
        ? "server_error"
        : "ready";
  const minutesAgo = shown?.checked_at
    ? Math.max(0, Math.round((now - new Date(shown.checked_at).getTime()) / 60_000))
    : null;

  return (
    <Frame title="فيزانو" footer={null}>
      <div className="sys pub" data-screen="PUB-03" data-state={state}>
        <PublicNav current="status" />
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">حالة خدمة فيزانو</h2>
            <span className="cat-head__hint">
              status.sting — استضافة مستقلة عن الخادم. قائمة الخدمات بحالة كلٍّ، وتاريخ الأحداث
              الأخيرة. على بنية مستقلة تماماً عن المنتج.
            </span>
          </div>
          <div className="acc-card__body">
            {shown?.maintenance.notice ? (
              <Notice kind="warning" title="صيانة مجدولة">
                <p className="acc-lead">{shown.maintenance.notice}</p>
                {shown.maintenance.until ? (
                  <p className="acc-choice__note">
                    حتى <span className="sting-mono">{shown.maintenance.until}</span>
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {state === "ready" && shown ? (
              <Notice
                kind={shown.overall === "ok" ? "success" : "warning"}
                title={shown.overall === "ok" ? "كل الخدمات تعمل" : "تعطل جزئي"}
              >
                <p className="acc-choice__note">
                  آخر تحديث للصفحة نفسها مكتوب بوقته:{" "}
                  <span className="sting-mono">{hhmm(shown.checked_at)}</span>. صفحة حالة قديمة تقول
                  «كل شيء سليم» أسوأ من غيابها.
                </p>
              </Notice>
            ) : null}

            {state === "stale" && shown ? (
              <Notice kind="warning" title="الفحص متعثّر">
                <p className="acc-lead">
                  آخر فحص آلي قبل <span className="sting-mono">{minutesAgo ?? 0}</span> دقيقة
                  والمعتاد كل دقيقة. الحالة المعروضة قد لا تكون الحالية.
                </p>
                <p className="acc-choice__note">
                  <strong>نعترف</strong> · «آخر فحص قبل{" "}
                  <span className="sting-mono">{minutesAgo ?? 0}</span> دقيقة — قد لا يعكس الوضع
                  الآن». صفحةٌ تقول «كل شيء يعمل» بناءً على فحصٍ قديم تكذب في أسوأ لحظة.
                </p>
              </Notice>
            ) : null}

            {state === "server_error" && shown ? (
              <Notice kind="error" title="تعطل جزئي">
                <p className="acc-lead">
                  <strong>ما يعمل عندك الآن رغم التعطل:</strong> البيع وإصدار الفواتير والورديات على
                  الأجهزة المثبَّتة. العمليات تُحفظ محلياً وتُزامَن عند العودة. المتوقف هو السوق
                  والطلبات والتقارير الخادمية.
                </p>
                <p className="acc-choice__note">
                  سبب التعطل محدَّد ويجري الإصلاح. المعلّق على الأجهزة سيُرفع تلقائياً عند العودة
                  بلا تدخل منك.
                </p>
              </Notice>
            ) : null}

            {shown ? (
              <ul className="pub-status">
                {shown.components.map((c) => (
                  <li key={c.id}>
                    <span>
                      <strong>{c.name}</strong>
                      <div className="pub-status__detail">{c.detail}</div>
                    </span>
                    <Status state={TONE[c.state]} label={LABEL[c.state]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="acc-choice__note">يُفحص الآن…</p>
            )}
          </div>
        </div>

        <div className="cat-table pos-card">
          <div className="cat-head">
            <h3 className="cat-head__title">سجل التحديثات</h3>
            <span className="cat-head__hint">
              لا أخضر دائم: نعرض تاريخ الأعطال السابقة ولو كانت قصيرة. صفحةٌ لم تُسجّل عطباً قط لا
              يصدّقها أحد.
            </span>
          </div>
          <div className="acc-card__body">
            {shown && shown.events.length ? (
              <ul className="pub-list pub-events">
                {shown.events.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="sting-mono">{e.at ? hhmm(e.at) : ""}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="acc-choice__note">لا أحداث مسجَّلة بعد — وهذا يُقال لا يُخفى.</p>
            )}
            <div className="acc-actions">
              <Button loading={checking} onClick={() => void load(true)}>
                أعد الفحص
              </Button>
              {checkedAt !== null && !checking ? (
                <Status
                  state={fetchFailed ? "server_error" : "success"}
                  label={
                    <>
                      {fetchFailed ? "تعذّر الفحص" : "فُحص الآن"} ·{" "}
                      <span className="sting-mono">{hms(checkedAt)}</span>
                    </>
                  }
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
