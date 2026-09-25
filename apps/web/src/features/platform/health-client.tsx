"use client";

import { Button, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "@/features/market/market.css";
import "./platform.css";
import { hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "stale" | "server_error";

interface Row {
  key: string;
  label: string;
  value: string;
  value_note: string;
  status: "ok" | "stuck" | "degraded" | "waiting" | "stalled";
  status_label: string;
  meaning: string;
}
interface Payload {
  state: "ready" | "server_error";
  measured_at: string;
  cards: {
    online_devices: number;
    late_devices: number;
    late_tenants: number;
    queue_pending: number;
    queue_trend: string;
    p95_ms: number;
    p95_samples: number;
    p95_within_limit: boolean;
    p95_limit_ms: number;
    generation: string;
    stale_replies_pending: number;
  };
  rows: Row[];
  node: {
    name: string;
    stalled: boolean;
    last_ok_at: string;
    tenants_scope: number;
    held_queue: number;
  };
}

const POLL_MS = 30_000;
const STALE_AFTER_S = 60;
const STATUS_STATE = {
  ok: "success",
  stuck: "conflict",
  degraded: "partial",
  waiting: "stale",
  stalled: "conflict",
} as const;
const devicesWord = (n: number) =>
  n === 1 ? "جهاز واحد" : n === 2 ? "جهازان" : n <= 10 ? `${n} أجهزة` : `${n} جهازاً`;
const shopsWord = (n: number) =>
  n === 1 ? "متجر واحد" : n === 2 ? "متجرين" : n <= 10 ? `${n} متاجر` : `${n} متجراً`;

/** PLT-09 — صحة المزامنة والخادم (18-D13 · 39-D31): تشخيص مخوّل لا نافذة على الدفاتر؛ لا كاش. */
export function HealthClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [ageS, setAgeS] = useState(0);
  const [busy, setBusy] = useState(false);
  const measuredRef = useRef<number>(0);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    setBusy(true);
    try {
      const { data, response } = await platformApi().GET("/api/platform/health");
      const b = data as unknown as Payload | undefined;
      if (response.ok && b) {
        setData(b);
        setFailed(false);
        measuredRef.current = Date.now();
        setAgeS(0);
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const tick = setInterval(() => {
      if (measuredRef.current) setAgeS(Math.floor((Date.now() - measuredRef.current) / 1000));
    }, 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const state: State = !data
    ? "loading"
    : data.state === "server_error"
      ? "server_error"
      : failed || ageS > STALE_AFTER_S
        ? "stale"
        : "ready";
  const columns = [
    { key: "label", header: "المؤشر", render: (r: Row) => <strong>{r.label}</strong> },
    {
      key: "value",
      header: "القيمة",
      render: (r: Row) => (
        <>
          <span className="sting-mono">{r.value}</span>
          {r.value_note ? ` ${r.value_note}` : ""}
        </>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (r: Row) => <Status state={STATUS_STATE[r.status]} label={r.status_label} />,
    },
    { key: "meaning", header: "ما يعنيه للمشغّل", render: (r: Row) => r.meaning },
  ];

  return (
    <PlatformFrame current="health">
      <div className="sys mp cus plt-frame" data-screen="PLT-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              صحة المزامنة والخادم — تشخيص مخوّل لا نافذة على الدفاتر
            </h2>
            <span className="cat-head__hint">
              ما يحتاجه المشغّل ليعرف أن الخدمة سليمة: أطوار المزامنة، وطابور الرفع، وصحة الجيل
              الخادمي — بلا محتوى معاملة واحدة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب المؤشرات">
                <p className="acc-lead">مؤشرات حيّة لا مخزّنة، مع وقت آخر قياس.</p>
                <p className="acc-choice__note">
                  <strong>لا كاش هنا</strong> · لوحةٌ تقول «كل شيء سليم» بناءً على قياس قديم هي أخطر
                  ما في غرفة العمليات.
                </p>
              </Notice>
            ) : null}
            {state === "stale" && data ? (
              <Notice
                kind="warning"
                title="قياس متقادم"
                action={
                  <Button loading={busy} onClick={() => void load()}>
                    قياس الآن
                  </Button>
                }
              >
                <p className="acc-lead">
                  {failed
                    ? "تعذّر القياس الأخير — المعروض من آخر قياس ناجح"
                    : "المعروض من قياس مضى عليه أكثر من دقيقة"}{" "}
                  ({hhmm(data.measured_at)}). لا نقول «سليم» بناءً على قياس قديم.
                </p>
              </Notice>
            ) : null}
            {state === "server_error" && data ? (
              <Notice kind="error" title="عقدة خادمية متعثّرة">
                <p className="acc-lead">
                  عند تعثُّر عقدة خادمية: تُعرض العقدة المتأثرة ونطاق المستأجرين عليها ووقت آخر نجاح
                  — ولا يُطبَّق ردّ جيل قديم فوق ما نجح على أجهزة التجار. الأثر يُصف طابوراً
                  معلَّقاً يحسمه مسار مخوَّل.
                </p>
                <p className="acc-choice__note">
                  العقدة <span className="sting-mono">{data.node.name}</span> · نطاقها{" "}
                  <span className="sting-mono">{data.node.tenants_scope}</span>{" "}
                  {shopsWord(data.node.tenants_scope).replace(/^\d+ /, "")} · آخر نجاح{" "}
                  {data.node.last_ok_at ? (
                    <span className="sting-mono">{hhmm(data.node.last_ok_at)}</span>
                  ) : (
                    "—"
                  )}{" "}
                  · طابور معلَّق <span className="sting-mono">{data.node.held_queue}</span>
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={
                      state === "server_error"
                        ? "conflict"
                        : state === "stale"
                          ? "stale"
                          : "success"
                    }
                    label="صحة النظام"
                  />
                  <span className="acc-choice__note">
                    آخر تحديث قبل <span className="sting-mono">{ageS}</span> ثانية
                  </span>
                  <Button variant="quiet" loading={busy} onClick={() => void load()}>
                    قياس الآن
                  </Button>
                </div>
                <dl className="mp-preview">
                  <dt>أجهزة متزامنة الآن</dt>
                  <dd>
                    <span className="sting-mono">{data.cards.online_devices}</span>
                    <div className="mp-reason">
                      {data.cards.late_devices > 0 ? (
                        <>
                          <span className="sting-mono">{data.cards.late_devices}</span>{" "}
                          {devicesWord(data.cards.late_devices).replace(/^\d+ /, "")} متأخرة عبر{" "}
                          <span className="sting-mono">{data.cards.late_tenants}</span>{" "}
                          {shopsWord(data.cards.late_tenants).replace(/^\d+ /, "")}
                        </>
                      ) : (
                        "لا أجهزة متأخرة"
                      )}
                    </div>
                  </dd>
                  <dt>طابور الرفع</dt>
                  <dd>
                    <span className="sting-mono">{data.cards.queue_pending}</span>
                    <div className="mp-reason">أحداث معلّقة · {data.cards.queue_trend}</div>
                  </dd>
                  <dt>زمن الاستجابة p95</dt>
                  <dd>
                    <span className="sting-mono">{data.cards.p95_ms} ms</span>
                    <div className="mp-reason">
                      {data.cards.p95_within_limit ? "ضمن الحدّ" : "فوق الحدّ"} · قياس آخر 5 دقائق
                    </div>
                  </dd>
                  <dt>جيل الخادم</dt>
                  <dd>
                    <span className="sting-mono">{data.cards.generation}</span>
                    <div className="mp-reason">
                      {data.cards.stale_replies_pending === 0 ? (
                        "موحّد · لا ردود جيل قديم معلَّقة"
                      ) : (
                        <>
                          <span className="sting-mono">{data.cards.stale_replies_pending}</span>{" "}
                          ردود جيل قديم معلَّقة — لا تُطبَّق فوق ما نجح
                        </>
                      )}
                    </div>
                  </dd>
                </dl>
                <h3 className="cat-head__title">مؤشرات التشخيص</h3>
                <Table
                  caption="مؤشرات التشخيص"
                  columns={columns}
                  rows={data.rows}
                  rowKey={(r) => r.key}
                />
                <p className="acc-choice__note">
                  <strong>تشخيص لا محتوى.</strong> كل ما هنا عدّادات وأطوار وأزمنة استجابة — لا
                  معرّف معاملة ولا مبلغ ولا اسم زبون. حين يتعثّر مستأجر بعينه يظهر عدد أجهزته
                  المتأخرة فقط، والدخول إلى دفتره يبقى محكوماً بتذكرة وإذن مؤقت.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
