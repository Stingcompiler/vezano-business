"use client";

import { Button, Frame, Notice, Status, TextField } from "@sting/ui-web";
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
import { dayMonth, hhmm } from "@/features/home/format";
import type { OrderRow } from "@/features/market/orders-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "conflict" | "stale" | "permission_denied" | "success";

interface Ev {
  id: string;
  kind: string;
  side: string;
  title: string;
  detail: string;
  ref_label: string;
  at: string;
  needs_decision: boolean;
  decision: string;
  decision_reason: string;
}

interface Payload {
  order: OrderRow;
  side: "buyer" | "supplier";
  restore_point: string;
  reconciling: boolean;
  can_review: boolean;
  pending: Ev[];
  decided: Ev[];
  confirmed: Ev[];
  blocked_transfers: { title: string; ref: string; detail: string }[];
}

const When = ({ iso }: { iso: string }) => {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};
const countWord = (n: number) => (n === 1 ? "حدث واحد" : n === 2 ? "حدثان" : `${n} أحداث`);
const countWordGen = (n: number) => (n === 1 ? "حدث واحد" : n === 2 ? "حدثين" : `${n} أحداث`);
const pendingHeading = (n: number) =>
  n === 2
    ? "حدثان بعد النسخة — يحتاجان قراراً واحداً واحداً"
    : `${countWord(n)} بعد النسخة — يحتاج قراراً واحداً واحداً`;

/** ORD-15 — استعادة طلب بعد فقد خادمي (10-D6 conflict · 41-D33 stale/permission_denied/success): نُعلن الجهل ولا قيد صامت. */
export function RestoreClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [started, setStarted] = useState(false);
  const [denied, setDenied] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}/restore", {
      params: { path: { order_id: id } },
    });
    if (response.status === 404) {
      router.replace(`/market/orders/${id}`);
      return;
    }
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) setP(body);
  }, [id, router]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/restore`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const decide = async (e: Ev, decision: "reapply" | "void") => {
    if (busy) return;
    setBusy(e.id);
    try {
      const r = await api().POST("/api/market/orders/{order_id}/restore/events/{event_id}", {
        params: { path: { order_id: id, event_id: e.id } },
        body: { decision, reason: reasons[e.id] ?? "" } as never,
      });
      if (r.response.status === 403) {
        setDenied(true);
        return;
      }
      const b = r.data as unknown as Payload | undefined;
      if (r.response.ok && b) setP(b);
    } finally {
      setBusy("");
    }
  };

  const begin = () => {
    if (!p?.can_review) {
      setDenied(true);
      return;
    }
    setStarted(true);
  };

  const state: State = denied
    ? "permission_denied"
    : p && p.restore_point && !p.reconciling
      ? "success"
      : p && p.reconciling && (started || p.decided.length)
        ? "conflict"
        : "stale";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-orders" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-15" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">استعادة طلب بعد فقد خادمي</h2>
            <span className="cat-head__hint">
              الاستعادة توقف التحويلات المتأثرة وتطلب مراجعة موثقة. الاستعادة لا تُنشئ قيداً ولا
              تُلغيه — كل فرق يبقى بنداً معلَناً حتى يُقرَّر.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="warning" title="المراجعة للمالك">
                <p className="acc-lead">
                  مشغّل الخدمة يرى ويشخّص، ولا يعدّل دفاتر الأطراف ولا يُقرّ كميةً.
                </p>
                <p className="acc-choice__note">
                  <strong>حدٌّ ثابت</strong> · إشراف المنصة لا يمسّ دفتر مستأجر. القرار في طلبٍ بين
                  منشأتين لهما لا لنا.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                </div>
              </Notice>
            ) : null}
            {state === "stale" && p ? (
              <Notice kind="warning" title="حالةٌ من قبل الفقد">
                <p className="acc-lead">
                  الخادم استُعيد إلى نسخة أقدم، وحالة الطلب المعروضة تسبق آخر ما جرى.
                  {p.restore_point ? (
                    <>
                      {" "}
                      «ما بعد <When iso={p.restore_point} /> غير معروف — قيد المصالحة».
                    </>
                  ) : null}
                </p>
                <p className="acc-choice__note">
                  <strong>نُعلن الجهل</strong> · حالةٌ قديمة تُعرض بلا وسم تُقرأ حالةً حاضرة.
                </p>
                <p className="acc-choice__note">
                  <strong>التنفيذ يتوقف</strong> · لا شحن ولا استلام على هذا الطلب حتى تنتهي
                  المصالحة. فعلٌ على أساسٍ مشكوك يضاعف الضرر.
                </p>
                {p.restore_point ? (
                  <div className="acc-actions">
                    <Button pos onClick={begin}>
                      ابدأ المراجعة — {countWord(p.pending.length)} بعد النسخة
                    </Button>
                  </div>
                ) : (
                  <p className="acc-choice__note">لا استعادة على هذا الطلب.</p>
                )}
              </Notice>
            ) : null}
            {state === "conflict" && p ? (
              <>
                <div className="acc-actions">
                  <Status state="conflict" label="تعارض" />
                </div>
                <h3 className="cat-head__title">
                  استُعيد الطلب <span className="sting-mono">{p.order.number_label}</span> إلى نسخة{" "}
                  <When iso={p.restore_point} />
                </h3>
                <p className="acc-choice__note">
                  الاستعادة أعادت الطلب إلى ما قبل{" "}
                  {countWordGen(p.pending.length + p.decided.length)} سُجِّلا بعد النسخة. الأحداث لم
                  يُمحَ ذكرها وهي بانتظار مراجعتك.
                </p>
                <h3 className="cat-head__title">{pendingHeading(p.pending.length)}</h3>
                <ul className="cus-list">
                  {p.pending.map((e) => (
                    <li key={e.id}>
                      <strong>{e.title}</strong>
                      <div className="cus-sub">
                        <When iso={e.at} />
                        {e.detail ? ` · ${e.detail}` : ""}
                      </div>
                      <TextField
                        label={`سبب تركه ملغى — ${e.title}`}
                        value={reasons[e.id] ?? ""}
                        onChange={(ev) => setReasons((c) => ({ ...c, [e.id]: ev.target.value }))}
                      />
                      <div className="acc-actions">
                        <Button
                          pos
                          loading={busy === e.id}
                          onClick={() => void decide(e, "reapply")}
                        >
                          إعادة تطبيقه
                        </Button>
                        <Button
                          loading={busy === e.id}
                          onClick={() => void decide(e, "void")}
                          disabledReason={
                            (reasons[e.id] ?? "").trim() ? undefined : "تركه ملغى يحتاج سبباً"
                          }
                        >
                          تركه ملغى مع سبب
                        </Button>
                      </div>
                    </li>
                  ))}
                  {p.decided.map((e) => (
                    <li key={e.id}>
                      <strong>{e.title}</strong>
                      <div className="cus-sub">
                        <When iso={e.at} />
                      </div>
                      <Status
                        state={e.decision === "reapply" ? "success" : "expired"}
                        label={
                          e.decision === "reapply"
                            ? "أُعيد تطبيقه"
                            : `تُرك ملغى — ${e.decision_reason}`
                        }
                      />
                    </li>
                  ))}
                </ul>
                <h3 className="cat-head__title">التحويلات المتأثرة موقوفة.</h3>
                <ul className="cus-list">
                  {p.blocked_transfers.map((t) => (
                    <li key={t.ref}>
                      <strong>{t.title}</strong>{" "}
                      <Button variant="quiet" onClick={() => router.push("/market/link/receipts")}>
                        <span className="sting-mono">{t.ref}</span>
                      </Button>
                      <div className="cus-sub">{t.detail}</div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {state === "success" && p ? (
              <Notice
                kind="success"
                title="أُعيد بناء الطلب"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  من أحداث الطرفين بهوياتها الأصلية: ما اتفق عليه الدفتران أُثبت، وما لا يُسنَد إلى
                  حدث بقي محجوزاً.
                </p>
                <p className="acc-choice__note">
                  <strong>لا تحويل مالي صامت</strong> · الاستعادة لا تُنشئ قيداً ولا تُلغيه. كل فرق
                  يبقى بنداً معلَناً حتى يُقرَّر.
                </p>
                <p className="acc-choice__note">
                  <strong>الأثر معروض</strong> · ما أُثبت وما حُجز وما يحتاج قراراً — ثلاث قوائم لا
                  رسالة «تمت الاستعادة».
                </p>
                <div className="pub-cols">
                  <div>
                    <strong>ما أُثبت</strong>
                    <ul className="pub-list">
                      {p.confirmed.map((e) => (
                        <li key={e.id}>
                          <span className="pub-mark">نعم</span>
                          <span>{e.title}</span>
                        </li>
                      ))}
                      {p.decided
                        .filter((e) => e.decision === "reapply")
                        .map((e) => (
                          <li key={e.id}>
                            <span className="pub-mark">نعم</span>
                            <span>{e.title} — أُعيد تطبيقه</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                  <div>
                    <strong>ما حُجز</strong>
                    <ul className="pub-list">
                      {p.decided
                        .filter((e) => e.decision === "void")
                        .map((e) => (
                          <li key={e.id}>
                            <span className="pub-mark">لا</span>
                            <span>
                              {e.title} — {e.decision_reason}
                            </span>
                          </li>
                        ))}
                      {p.decided.filter((e) => e.decision === "void").length === 0 ? (
                        <li>
                          <span className="pub-mark">—</span>
                          <span>لا شيء</span>
                        </li>
                      ) : null}
                    </ul>
                  </div>
                  <div>
                    <strong>ما يحتاج قراراً</strong>
                    <ul className="pub-list">
                      <li>
                        <span className="pub-mark">—</span>
                        <span>{p.pending.length ? countWord(p.pending.length) : "لا شيء"}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
