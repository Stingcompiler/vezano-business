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
import { hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "server_error" | "success";

interface Backup {
  id: string;
  kind: "nightly" | "weekly";
  kind_label: string;
  taken_at: string;
  size_bytes: number;
  status: "ok" | "failed" | "incomplete";
  status_label: string;
  note: string;
  integrity_label: string;
  last_drill: { at: string; result: string; integrity_pct: number; by_name: string } | null;
  usable: boolean;
}
interface Payload {
  state: "ready" | "server_error";
  measured_at: string;
  achieved: {
    rpo_minutes: number | null;
    rto_minutes: number | null;
    integrity_pct: number | null;
    drill_at: string;
    drill_by_name: string;
    backup_taken_at: string;
  };
  nightly_failed: boolean;
  last_valid_at: string;
  backups: Backup[];
  live_restore_requirements: string[];
}
interface Drill {
  result: string;
  rpo_minutes: number;
  rto_minutes: number;
  integrity_pct: number;
  detail: string;
  by_name: string;
  finished_at: string;
}

const short = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d ?? ""}/${m ?? ""}`;
};
const size = (b: number) =>
  b >= 1_073_741_824
    ? `${(b / 1_073_741_824).toFixed(1)} GB`
    : b >= 1_048_576
      ? `${(b / 1_048_576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(b / 1024))} KB`;

/** PLT-10 — نسخ خادمية وتجربة استعادة (26-D19 · 39-D31): RPO/RTO نتيجةً لا وعداً، ولا زرّ مدمّر بلا مسار مخوَّل (ACC-75). */
export function BackupsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [liveFor, setLiveFor] = useState("");
  const [env, setEnv] = useState("");
  const [approver, setApprover] = useState("");
  const [missing, setMissing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/backups");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const runDrill = async (b: Backup) => {
    if (busy) return;
    setBusy(`drill:${b.id}`);
    try {
      const r = await platformApi().POST("/api/platform/backups/{backup_id}/{action}", {
        params: { path: { backup_id: b.id, action: "drill" } },
        body: {} as never,
      });
      const p = r.data as unknown as (Payload & { drill: Drill }) | undefined;
      if (r.response.ok && p) {
        setDrill(p.drill);
        setData(p);
      }
    } finally {
      setBusy("");
    }
  };

  const requestLive = async (b: Backup) => {
    if (busy) return;
    setBusy(`live:${b.id}`);
    setMissing(null);
    try {
      const r = await platformApi().POST("/api/platform/backups/{backup_id}/{action}", {
        params: { path: { backup_id: b.id, action: "live" } },
        body: { environment: env, second_approver: approver } as never,
      });
      const e = r.error as unknown as
        { detail?: string; extra?: { missing?: string[] } } | undefined;
      if (!r.response.ok) setMissing(e?.extra?.missing ?? [e?.detail ?? "server_error"]);
      else setMissing([]);
    } finally {
      setBusy("");
    }
  };

  const state: State = !data
    ? "loading"
    : drill
      ? "success"
      : data.state === "server_error"
        ? "server_error"
        : "ready";
  const columns = [
    {
      key: "backup",
      header: "النسخة",
      render: (b: Backup) => (
        <>
          <strong>
            {b.kind_label} · <span className="sting-mono">{short(b.taken_at)}</span>
            {b.kind === "nightly" ? (
              <>
                {" "}
                <span className="sting-mono">{hhmm(b.taken_at)}</span>
              </>
            ) : null}
          </strong>
          {b.note ? <div className="mp-check__hint">{b.note}</div> : null}
        </>
      ),
    },
    {
      key: "size",
      header: "الحجم",
      render: (b: Backup) =>
        b.size_bytes ? <span className="sting-mono">{size(b.size_bytes)}</span> : "—",
    },
    {
      key: "integrity",
      header: "تحقّق السلامة",
      render: (b: Backup) => (
        <Status
          state={
            b.status !== "ok"
              ? "conflict"
              : b.last_drill?.result === "ok"
                ? "success"
                : "saved_local"
          }
          label={b.integrity_label}
        />
      ),
    },
    {
      key: "drill",
      header: "آخر تجربة استعادة",
      render: (b: Backup) => (
        <>
          {b.status === "incomplete" ? (
            "لم تكتمل — أُعيدت الجدولة"
          ) : b.status === "failed" ? (
            "فشلت — لا تُستعاد"
          ) : b.last_drill ? (
            b.last_drill.result === "ok" ? (
              <>
                {b.kind === "weekly" ? "استُعيدت" : "استُعيدت بنجاح"}{" "}
                <span className="sting-mono">{short(b.last_drill.at)}</span> — سلامة{" "}
                <span className="sting-mono">{b.last_drill.integrity_pct}%</span>
              </>
            ) : (
              <>
                فشلت التجربة <span className="sting-mono">{short(b.last_drill.at)}</span> — سلامة{" "}
                <span className="sting-mono">{b.last_drill.integrity_pct}%</span>
              </>
            )
          ) : (
            "صالحة — لم تُختبر بعد"
          )}
          {b.usable ? (
            <div className="acc-actions">
              <Button
                variant="quiet"
                loading={busy === `drill:${b.id}`}
                onClick={() => void runDrill(b)}
              >
                تشغيل تجربة استعادة معزولة
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setLiveFor(liveFor === b.id ? "" : b.id);
                  setMissing(null);
                }}
              >
                استعادة حيّة — تتطلّب موافقة ثانية
              </Button>
            </div>
          ) : null}
          {liveFor === b.id ? (
            <>
              <TextField
                label="اكتب اسم البيئة تأكيداً"
                mono
                value={env}
                onChange={(e) => setEnv(e.target.value)}
              />
              <TextField
                label="اسم المشغّل الثاني الموافق"
                value={approver}
                onChange={(e) => setApprover(e.target.value)}
              />
              <div className="acc-actions">
                <Button loading={busy === `live:${b.id}`} onClick={() => void requestLive(b)}>
                  تسجيل طلب الاستعادة الحيّة
                </Button>
              </div>
              {missing && missing.length ? (
                <Notice kind="locked" title="مُنعت — شروط ناقصة">
                  <ul className="acc-list">
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Notice>
              ) : missing ? (
                <Notice kind="success" title="سُجّل الطلب بأثر كامل">
                  <p className="acc-lead">
                    التنفيذ بمسار مخوَّل خارج هذه الواجهة — لا زرّ واحد يستبدل قاعدة الإنتاج.
                  </p>
                </Notice>
              ) : null}
            </>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <PlatformFrame current="backups">
      <div className="sys mp cus plt-frame" data-screen="PLT-10" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              نسخ خادمية وتجربة استعادة — RPO/RTO نتيجةً لا وعداً، ولا زرّ مدمّر بلا مسار مخوَّل
            </h2>
            <span className="cat-head__hint">
              النسخ تُختبر باستعادة فعلية دورية. الأرقام معروضة كقياس محقَّق، والاستعادة فوق بيانات
              حيّة محكومة بمسار متعدّد الموافقات (ACC-75).
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب سجل النسخ">
                <p className="acc-lead">
                  مع نتائج آخر تجربة استعادة — وهي المعلومة الحقيقية لا وجود النسخة.
                </p>
                <p className="acc-choice__note">
                  <strong>RPO وRTO قياسان</strong> · يُعرضان كنتيجة مقاسة لا كوعد (ACC-75). النسخة
                  التي لم تُستعَد تجريبياً مجهولة الصلاحية.
                </p>
              </Notice>
            ) : null}
            {state === "server_error" && data ? (
              <Notice kind="error" title="فشلت آخر محاولة نسخ ليلية">
                <p className="acc-lead">
                  النسخة الأخيرة الصالحة هي{" "}
                  {data.last_valid_at ? (
                    <span className="sting-mono">{short(data.last_valid_at)}</span>
                  ) : (
                    "—"
                  )}
                  . لا نعرض «محميّ» بينما الفشل قائم؛ يُرفع تنبيه للمشغّل ويُمنع أي إجراء استعادة
                  يعتمد على النسخة الفاشلة.
                </p>
              </Notice>
            ) : null}
            {state === "success" && drill ? (
              <Notice
                kind={drill.result === "ok" ? "success" : "warning"}
                title={drill.result === "ok" ? "تجربة ناجحة" : "فشلت التجربة"}
                action={<Button onClick={() => setDrill(null)}>إغلاق</Button>}
              >
                <p className="acc-lead">
                  {drill.detail} · سلامة <span className="sting-mono">{drill.integrity_pct}%</span>{" "}
                  · RPO <span className="sting-mono">{drill.rpo_minutes} min</span> · RTO{" "}
                  <span className="sting-mono">{drill.rto_minutes} min</span> · نفّذها{" "}
                  {drill.by_name}
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={data.achieved.rpo_minutes === null ? "stale" : "success"}
                    label={data.achieved.rpo_minutes === null ? "لم تُجرَّب بعد" : "تجربة ناجحة"}
                  />
                </div>
                <dl className="mp-preview">
                  <dt>RPO المحقَّق — أقصى فقد محتمل</dt>
                  <dd>
                    {data.achieved.rpo_minutes === null ? (
                      "—"
                    ) : (
                      <span className="sting-mono">≤ {data.achieved.rpo_minutes} min</span>
                    )}
                    <div className="mp-reason">قياس من آخر تجربة استعادة فعلية، لا هدف نظري</div>
                  </dd>
                  <dt>RTO المحقَّق — زمن العودة للخدمة</dt>
                  <dd>
                    {data.achieved.rto_minutes === null ? (
                      "—"
                    ) : (
                      <span className="sting-mono">{data.achieved.rto_minutes} min</span>
                    )}
                    <div className="mp-reason">
                      {data.achieved.drill_at ? (
                        <>
                          من تجربة{" "}
                          <span className="sting-mono">{short(data.achieved.drill_at)}</span> على
                          بيئة معزولة
                        </>
                      ) : (
                        "لا تجربة بعد"
                      )}
                    </div>
                  </dd>
                  <dt>آخر تجربة استعادة ناجحة</dt>
                  <dd>
                    {data.achieved.drill_at ? (
                      <span className="sting-mono">
                        {short(data.achieved.drill_at)} · {hhmm(data.achieved.drill_at)}
                      </span>
                    ) : (
                      "—"
                    )}
                    <div className="mp-reason">
                      {data.achieved.integrity_pct === null ? (
                        "النسخة التي لم تُجرَّب ليست نسخة"
                      ) : (
                        <>
                          تحقّق سلامة تلقائي:{" "}
                          <span className="sting-mono">{data.achieved.integrity_pct}%</span> من
                          الجداول
                        </>
                      )}
                    </div>
                  </dd>
                </dl>
                <h3 className="cat-head__title">النسخ المتاحة وتجارب الاستعادة</h3>
                <Table
                  caption="النسخ المتاحة وتجارب الاستعادة"
                  columns={columns}
                  rows={data.backups}
                  rowKey={(b) => b.id}
                  empty={
                    <Notice kind="empty" title="لا نسخ مسجَّلة بعد">
                      <p className="acc-lead">
                        يسجّل مسار النسخ كل نسخة هنا — ووجودها ليس صلاحية حتى تُجرَّب.
                      </p>
                    </Notice>
                  }
                />
                <h3 className="cat-head__title">استعادة فوق بيانات حيّة — إجراء مدمّر محكوم</h3>
                <p className="acc-choice__note">
                  لا زرّ واحد يستبدل قاعدة الإنتاج. الاستعادة الحيّة تتطلّب: تأكيد كتابيّ لاسم
                  البيئة، وموافقة مشغّل ثانٍ، ونافذة صيانة معلَنة للتجار، وأثراً كاملاً. الافتراضي
                  دائماً هو الاستعادة إلى بيئة معزولة أولاً.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
