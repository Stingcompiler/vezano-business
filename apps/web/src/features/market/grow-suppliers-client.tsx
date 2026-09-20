"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
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
import { agoParts, dayMonth } from "@/features/home/format";
import { PhaseScreenClient } from "@/features/phase/phase-screen-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "loading" | "ready" | "empty" | "stale" | "permission_denied";

interface Doc {
  document_id: string;
  number: string;
  approved_at: string;
  summary: string;
  label: "متأخر" | "مطابق" | "مرتجع";
}
interface Supplier {
  supplier_id: string;
  supplier_name: string;
  documents: number;
  months: number;
  enough: boolean;
  on_time: number;
  with_order: number;
  on_time_line: string;
  returns: number;
  returns_line: string;
  price_moves: number;
  price_line: string;
  recent: Doc[];
  min_docs: number;
}
interface Payload {
  state: "ready" | "empty" | "stale" | "phase_locked" | "permission_denied";
  role_name?: string;
  computed_at?: string;
  newer_documents?: string[];
  suppliers?: Supplier[];
}

const docsWord = (n: number) =>
  n === 1 ? "مستند واحد" : n === 2 ? "مستندان" : n <= 10 ? `${n} مستندات` : `${n} مستنداً`;
const monthsWord = (n: number) =>
  n === 1 ? "شهر" : n === 2 ? "شهران" : n <= 10 ? `${n} أشهر` : `${n} شهراً`;
const agoWord = (iso: string) => {
  const { n, unit } = agoParts(iso);
  if (unit === "minute") return "قبل دقائق";
  if (unit === "hour")
    return n === 1
      ? "قبل ساعة"
      : n === 2
        ? "قبل ساعتين"
        : n <= 10
          ? `قبل ${n} ساعات`
          : `قبل ${n} ساعة`;
  return n === 1 ? "قبل يوم" : n === 2 ? "قبل يومين" : `قبل ${n} أيام`;
};
const dm = (iso: string) => {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}
    </>
  );
};

/** GROW-02 — تحليلات المورد (32-D24 ready/loading/empty/stale): يُحاسَب على ما وعد به لا على ما نتمنّاه؛ ثلاثة أرقام لا درجة. */
export function GrowSuppliersClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async (compute = false) => {
    const { data, error, response } = await api().GET("/api/grow/suppliers", {
      params: { query: compute ? { compute: "1" } : {} },
    });
    const b = (data ?? error) as unknown as Payload | undefined;
    if ((response.ok || response.status === 403) && b) setData(b);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fgrow%2Fsuppliers");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  if (data && data.state === "phase_locked") return <PhaseScreenClient id="GROW-02" />;

  const state: State = !data
    ? "loading"
    : data.state === "permission_denied"
      ? "permission_denied"
      : data.state === "stale"
        ? "stale"
        : data.state === "empty"
          ? "empty"
          : "ready";
  const suppliers = data?.suppliers ?? [];

  return (
    <Frame title="النموّ" nav={<AppNav currentId="parties" />} footer={null}>
      <div className="sys mp cus" data-screen="GROW-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              تحليلات المورد — يُحاسَب على ما وعد به لا على ما نتمنّاه
            </h2>
            <span className="cat-head__hint">
              ثلاثة أرقام لا أكثر: التزامه بالمواعيد، ونسبة ما رُدَّ إليه، وثبات أسعاره. كلها محسوبة
              من مستندات حقيقية في نطاقك، وكلها تُفتح على المستندات التي بنَتها.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="حساب من المستندات">
                <p className="acc-lead">
                  ثلاثة هياكل بمواضع الأرقام الثلاثة. لا نُظهر رقماً جزئياً يتغيّر أمام العين —
                  القارئ يتذكّر أول رقم رآه.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نُظهر</strong> · قيماً وسيطة ولا صفراً مؤقتاً. «71%» بعد ثانيتين خيرٌ
                  من «0%» ثم «71%».
                </p>
                <dl className="mp-preview" aria-hidden="true">
                  <dt>التزام بالمواعيد</dt>
                  <dd>
                    <span className="sting-mono">—</span>
                  </dd>
                  <dt>نسبة المرتجع</dt>
                  <dd>
                    <span className="sting-mono">—</span>
                  </dd>
                  <dt>ثبات السعر</dt>
                  <dd>
                    <span className="sting-mono">—</span>
                  </dd>
                </dl>
              </Notice>
            ) : null}
            {state === "permission_denied" ? (
              <Notice kind="locked" title="تحليلات المورد للمالك ومدير الفرع وأمين المخزن">
                <p className="acc-lead">
                  الأرقام تُبنى على مستندات الشراء — من لا يراها لا يرى تحليلها.
                </p>
              </Notice>
            ) : null}
            {state === "stale" && data ? (
              <Notice
                kind="warning"
                title={`محسوبة ${data.computed_at ? agoWord(data.computed_at) : ""}`}
              >
                <div className="acc-actions">
                  <Button
                    loading={busy}
                    onClick={() => {
                      setBusy(true);
                      void load(true).finally(() => setBusy(false));
                    }}
                  >
                    أعِد الحساب الآن
                  </Button>
                </div>
                <p className="acc-lead">
                  المؤشرات تُحسب ليلاً لا لحظياً. نُظهر وقت الحساب لأن{" "}
                  {data.newer_documents?.length ? (
                    <>
                      مستند <span className="sting-mono">{data.newer_documents[0]}</span> اعتُمد
                      بعده ولم يدخل
                    </>
                  ) : (
                    "قد يكون مستند اعتُمد بعده ولم يدخل"
                  )}
                  .
                </p>
              </Notice>
            ) : null}
            {state === "empty" && suppliers.length ? (
              <Notice
                kind="info"
                title={`${docsWord(suppliers[0]!.documents)} لا ${suppliers[0]!.documents === 2 ? "يكفيان" : "يكفي"}`}
              >
                <p className="acc-lead">
                  مورد جديد بمستندين. لا نحسب نسبة التزام من مستندين ونعرضها كأنها حكم — «50%» من
                  اثنين ليست معلومة.
                </p>
                <p className="acc-choice__note">
                  <strong>نعرض</strong> · المستندين كما هما بتواريخهما، وسطر: «تُحسب المؤشرات بعد{" "}
                  <span className="sting-mono">{suppliers[0]!.min_docs}</span> مستندات».
                </p>
              </Notice>
            ) : null}
            {state === "empty" && !suppliers.length ? (
              <Notice kind="empty" title="لا مستندات شراء بعد">
                <p className="acc-lead">التحليل يبدأ من أول مستند شراء معتمد (PUR-03).</p>
              </Notice>
            ) : null}

            {data && state !== "loading" && state !== "permission_denied"
              ? suppliers.map((s) => (
                  <section key={s.supplier_id} className="pos-card">
                    <h3 className="cat-head__title">
                      {s.supplier_name} — {docsWord(s.documents)} · {monthsWord(s.months)}
                    </h3>
                    {s.enough ? (
                      <dl className="mp-preview">
                        <dt>التزام بالمواعيد</dt>
                        <dd>
                          <span className="sting-mono">
                            {s.with_order ? Math.round((s.on_time * 100) / s.with_order) : 0}%
                          </span>
                          <div className="mp-reason">{s.on_time_line}</div>
                        </dd>
                        <dt>نسبة المرتجع</dt>
                        <dd>
                          <span className="sting-mono">
                            {Math.round((s.returns * 100) / s.documents)}%
                          </span>
                          <div className="mp-reason">{s.returns_line}</div>
                        </dd>
                        <dt>ثبات السعر</dt>
                        <dd>
                          <span className="sting-mono">{s.price_moves}</span>
                          <div className="mp-reason">{s.price_line}</div>
                        </dd>
                      </dl>
                    ) : (
                      <p className="acc-choice__note">
                        تُحسب المؤشرات بعد <span className="sting-mono">{s.min_docs}</span> مستندات
                        — الآن {docsWord(s.documents)}.
                      </p>
                    )}
                    <h3 className="cat-head__title">آخر خمسة مستندات</h3>
                    <ul className="cus-list">
                      {s.recent.map((d) => (
                        <li key={d.document_id}>
                          <strong>
                            <span className="sting-mono">{d.number}</span> · {dm(d.approved_at)}
                          </strong>
                          <div className="cus-sub">{d.summary}</div>
                          <Status
                            state={
                              d.label === "متأخر"
                                ? "conflict"
                                : d.label === "مرتجع"
                                  ? "partial"
                                  : "success"
                            }
                            label={d.label}
                          />
                        </li>
                      ))}
                    </ul>
                    <p className="acc-choice__note">
                      حساب من {docsWord(s.documents)} — لا درجة إجمالية ولا نجوم. الرقم الواحد الذي
                      يلخّص مورداً يُخفي أيَّ الثلاثة ساء — والقرار يختلف: من يتأخر يُطلب منه
                      مبكراً، ومن يُرَدّ إليه كثيراً يُراجَع صنفه، ومن يتذبذب سعره يُثبَّت بعقد.
                    </p>
                  </section>
                ))
              : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
