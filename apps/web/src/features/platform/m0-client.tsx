"use client";

import { Button, formatMinor, Notice, Status } from "@sting/ui-web";
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
import { hhmm, MONTHS_AR } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformFrame } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "empty" | "stale";

interface Stage {
  key: string;
  label: string;
  value: number;
  note: string;
  ratio: string;
}
interface Snapshot {
  month: string;
  computed_at: string;
  stages: Stage[];
  trade: {
    executed_value_minor: string;
    executed_count: number;
    partial_count: number;
    partial_value_minor: string;
    disputed_count: number;
  };
  targets: {
    opportunities: number;
    opportunities_min: number;
    conclusive: boolean;
    mediation: number;
    avg_accept_minutes: number | null;
    accept_target_minutes: number;
    campaign_messages: number;
  };
}
interface Payload {
  state: "loading" | "ready" | "empty" | "stale";
  month: string;
  computed_at?: string;
  computed_by_name?: string;
  snapshot: Snapshot | null;
}

const monthName = (m: string) => MONTHS_AR[Number(m.slice(5, 7)) - 1] ?? m;
const ordersWord = (n: number) =>
  n === 1 ? "طلب واحد" : n === 2 ? "طلبان" : n <= 10 ? `${n} طلبات` : `${n} طلباً`;
const SMALL = [
  "",
  "فرصة واحدة",
  "فرصتين",
  "ثلاث فرص",
  "أربع فرص",
  "خمس فرص",
  "ست فرص",
  "سبع فرص",
  "ثماني فرص",
  "تسع فرص",
  "عشر فرص",
];
/** «ثلاث فرص» بالكلمات حتى العشرة — الإطار يكتبها كلمات لا أرقاماً. */
const oppsWord = (n: number) => SMALL[n] ?? `${n} فرصة`;
const oppsUnit = (n: number) => (n === 1 ? "فرصة" : n === 2 ? "فرصتان" : n <= 10 ? "فرص" : "فرصة");

/** PLT-11 — لوحة الاكتساب M0 (08-D4 · 39-D31): كل رقم بمقامه؛ قيمة التجارة مرة لا مرتين (ACC-142)؛ غير حاسم يُقال كذلك (ACC-146). */
export function M0Client() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [computing, setComputing] = useState(false);
  const month = new Date().toISOString().slice(0, 7);

  const load = useCallback(async () => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    const { data, response } = await platformApi().GET("/api/platform/m0", {
      params: { query: { month } },
    });
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, [router, month]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const compute = async () => {
    if (computing) return;
    setComputing(true);
    try {
      const r = await platformApi().POST("/api/platform/m0", { body: { month } as never });
      const b = r.data as unknown as Payload | undefined;
      if (r.response.ok && b) setData(b);
    } finally {
      setComputing(false);
    }
  };

  const state: State = !data || computing || data.state === "loading" ? "loading" : data.state;
  const snap = data?.snapshot ?? null;
  const t = snap?.targets;

  return (
    <PlatformFrame current="m0">
      <div className="sys mp cus plt-frame" data-screen="PLT-11" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">لوحة الاكتساب M0 — كل رقم بمقامه</h2>
            <span className="cat-head__hint">
              قيمة التجارة لا تُضاعف بين المشتري والبائع. نطاق الإصدار الأول لا يُقرأ كنتيجة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جارٍ الحساب">
                <p className="acc-lead">
                  تجميعٌ عبر كل المستأجرين، ويستغرق. نعرض المدى والعدد أثناءه.
                </p>
                <p className="acc-choice__note">
                  المدى: {monthName(month)} ·{" "}
                  <span className="sting-mono">{snap?.targets.opportunities ?? 0}</span> فرص حتى آخر
                  تجميع
                </p>
                {!computing && data && data.state === "loading" ? (
                  <div className="acc-actions">
                    <Button loading={computing} onClick={() => void compute()}>
                      احسب الآن
                    </Button>
                  </div>
                ) : null}
              </Notice>
            ) : null}
            {state === "stale" && data?.computed_at ? (
              <Notice
                kind="warning"
                title="بيانات قديمة"
                action={
                  <Button loading={computing} onClick={() => void compute()}>
                    أعِد التجميع
                  </Button>
                }
              >
                <p className="acc-lead">
                  أرقام {monthName(month)} غير مكتملة: التجميع اليومي يقف عند{" "}
                  <span className="sting-mono">{hhmm(data.computed_at)}</span> ولم يُحدَّث بعد. لن
                  نعرضها كأنها حتى اللحظة، ولن نخفيها — تُقرأ بختمها الزمني.
                </p>
              </Notice>
            ) : null}
            {state === "empty" && t && snap ? (
              <Notice kind="warning" title="فرص غير كافية للحكم">
                <p className="acc-lead">
                  المدى فيه <span className="sting-mono">{t.opportunities}</span>{" "}
                  {oppsUnit(t.opportunities)}، والحكم على M0 يحتاج عدداً أكبر.
                </p>
                <p className="acc-choice__note">
                  <strong>نتيجة غير حاسمة</strong> · نقولها كذلك ولا نعرض نسبةً من{" "}
                  {oppsWord(t.opportunities)}. «غير حاسم — يحتاج{" "}
                  <span className="sting-mono">{t.opportunities_min}</span> فرصة» أصدق من «
                  <span className="sting-mono">
                    {t.opportunities
                      ? Math.round((snap.trade.executed_count * 100) / t.opportunities)
                      : 0}
                    %
                  </span>{" "}
                  نجاح».
                </p>
                <p className="acc-choice__note">
                  <strong>لا توقف البناء</strong> · النتيجة غير الحاسمة معلومة لا حكم. الشاشة لا
                  تقترح قراراً — تعرض ما يكفي وما لا يكفي.
                </p>
              </Notice>
            ) : null}

            {snap && t ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={state === "stale" ? "stale" : state === "empty" ? "partial" : "synced"}
                    label={
                      state === "stale" ? "بيانات قديمة" : state === "empty" ? "غير حاسم" : "محسوب"
                    }
                  />
                  <span className="acc-choice__note">
                    محسوب{" "}
                    <span className="sting-mono">
                      {data?.computed_at ? hhmm(data.computed_at) : "—"}
                    </span>
                    {state === "stale" ? " · التجميع اليومي لم يكتمل بعد" : ""}
                  </span>
                </div>
                <h3 className="cat-head__title">مؤشرات M0</h3>
                <p className="acc-choice__note">
                  الفرص والوساطة والدقائق والكلفة مقابل الأهداف المعلنة. وقيمة التجارة تُحسب مرة لا
                  مرتين للطرفين.
                </p>
                <dl className="mp-preview">
                  <dt>الفرص (طلبات سوق أُرسلت)</dt>
                  <dd>
                    <span className="sting-mono">{t.opportunities}</span> /{" "}
                    <span className="sting-mono">{t.opportunities_min}</span>
                    <div className="mp-reason">
                      {t.conclusive ? "عدد كافٍ للحكم" : "غير حاسم — يحتاج عدداً أكبر"}
                    </div>
                  </dd>
                  <dt>الوساطة (طلبات وسيط)</dt>
                  <dd>
                    <span className="sting-mono">{t.mediation}</span>
                    <div className="mp-reason">المنصة تُيسّر ولا تحكم</div>
                  </dd>
                  <dt>الدقائق حتى القبول</dt>
                  <dd>
                    {t.avg_accept_minutes === null ? (
                      "—"
                    ) : (
                      <span className="sting-mono">{t.avg_accept_minutes}</span>
                    )}
                    <div className="mp-reason">
                      الهدف المعلَن <span className="sting-mono">{t.accept_target_minutes}</span>{" "}
                      دقيقة
                    </div>
                  </dd>
                  <dt>الكلفة (رسائل حملات)</dt>
                  <dd>
                    <span className="sting-mono">{t.campaign_messages}</span>
                    <div className="mp-reason">من حصص الباقات لا من ميزانية المنصة</div>
                  </dd>
                </dl>
                <p className="acc-choice__note">
                  <strong>لا مضاعفة</strong> · صفقةٌ بين مشترٍ وبائع قيمةٌ واحدة. عدّها عند الطرفين
                  يُضاعف الرقم ويُفسد القرار المبنيّ عليه.
                </p>

                <h3 className="cat-head__title">الاكتساب والنشاط — {monthName(month)}</h3>
                <p className="acc-choice__note">
                  <strong>لا نسبة واحدة</strong> · الخمسة أرقام مراحل منفصلة لا قمعاً واحداً.
                  الزيارة مجهولة، والتسجيل بحساب، والنشاط بمنشأة، والطلب بطرفين، والدفع باشتراك.
                  قسمة «دفع ÷ زيارة» تجمع مقامات مختلفة وتنتج نسبة لا تصف شيئاً. تحويل كل مرحلة إلى
                  التي تليها معروض داخل بطاقتها، وهو الرقم الوحيد الذي له معنى.
                </p>
                <ul className="cus-list">
                  {snap.stages.map((s) => (
                    <li key={s.key}>
                      <strong>{s.label}</strong>
                      <div className="cus-sub">
                        <span className="sting-mono">{s.value}</span>
                        {s.ratio ? ` · ${s.ratio}` : ""} · {s.note}
                      </div>
                    </li>
                  ))}
                </ul>

                <h3 className="cat-head__title">قيمة التجارة — مرة واحدة لا مرتين</h3>
                <dl className="mp-preview">
                  <dt>قيمة الطلبات المنفَّذة</dt>
                  <dd>
                    <span className="sting-mono">
                      {formatMinor(snap.trade.executed_value_minor)}
                    </span>
                    <div className="mp-reason">المستلم والمؤكد من الطرفين · مرة واحدة لكل طلب</div>
                  </dd>
                  <dt>طلبات جزئية — المستلم وحده</dt>
                  <dd>
                    <span className="sting-mono">{snap.trade.partial_count}</span> ·{" "}
                    <span className="sting-mono">
                      {formatMinor(snap.trade.partial_value_minor)}
                    </span>
                    <div className="mp-reason">المشحون غير المستلم غير محتسب</div>
                  </dd>
                  <dt>محل خلاف — غير محتسب</dt>
                  <dd>
                    {ordersWord(snap.trade.disputed_count)} في خلاف مفتوح · لا تُضاف ولا تُخصم حتى
                    الحسم
                  </dd>
                  <dt>ما لا نجمعه</dt>
                  <dd>
                    <Status state="expired" label="ممتنع" />
                    <div className="mp-reason">
                      قيمة الطلب من دفتر المشتري + قيمته من دفتر البائع = ضعف مخترع
                    </div>
                  </dd>
                </dl>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </PlatformFrame>
  );
}
