"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
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
import { agoParts } from "@/features/home/format";
import type { Detail, Version } from "@/features/market/order-detail-client";
import type { OrderRow } from "@/features/market/orders-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "expired" | "conflict" | "success";

interface Row {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  requested_qty: number;
  requested_price_minor: string;
  shown_qty: number | null;
  shown_price_minor: string;
  current_qty: number | null;
  current_price_minor: string;
  diff_label: string;
  increase_reason: string;
  version_diff_label: string;
}

interface Compare {
  order: OrderRow;
  request: Version | null;
  shown: Version | null;
  latest: Version | null;
  rows: Row[];
  conflict: boolean;
  expired: boolean;
  seconds_left: number;
  shown_total_minor: string;
  latest_total_minor: string;
  request_total_minor: string;
  accepted: number | null;
}

const hms = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}`;
};
const agoWord = (iso: string) => {
  const { n, unit } = agoParts(iso);
  if (unit === "minute")
    return n <= 1
      ? "قبل دقيقة"
      : n === 2
        ? "قبل دقيقتين"
        : n <= 10
          ? `قبل ${n} دقائق`
          : `قبل ${n} دقيقة`;
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
const daysWord = (n: number) =>
  n === 1 ? "يوم واحد" : n === 2 ? "يومان" : n <= 10 ? `${n} أيام` : `${n} يوماً`;
const daysDiff = (n: number) =>
  n === 1 ? "+يوم" : n === 2 ? "+يومان" : n <= 10 ? `+${n} أيام` : `+${n} يوماً`;
const lineDiff = (r: Row) => {
  const q = r.shown_qty ?? r.requested_qty;
  const dp = Number(r.shown_price_minor || 0) - Number(r.requested_price_minor || 0);
  if (!dp && q === r.requested_qty) return "بلا تغيير";
  const parts: string[] = [];
  if (dp) parts.push(`${dp > 0 ? "+" : "−"}${formatMinor(String(Math.abs(dp)))} لل${r.unit_name}`);
  if (dp && q) parts.push(`${dp > 0 ? "+" : "−"}${formatMinor(String(Math.abs(dp) * q))} للبند`);
  if (q !== r.requested_qty)
    parts.push(`الكمية ${q - r.requested_qty > 0 ? "+" : ""}${q - r.requested_qty}`);
  return parts.join(" · ");
};

/** ORD-07 — مقارنة العرض وقبوله أو رفضه (41-D33 ready/validation_error/expired/success · 08-D4 conflict): لا زرّ قبول قبل عرض الفرق. */
export function CompareClient({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const opened = params.get("version") ?? "";
  const app = useApp();
  const [cmp, setCmp] = useState<Compare | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState("");
  const [superseded, setSuperseded] = useState<number | null>(null);
  const [accepted, setAccepted] = useState<Detail | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejected, setRejected] = useState(false);
  const [requoted, setRequoted] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(
    async (version: string) => {
      const { data, response } = await api().GET("/api/market/orders/{order_id}/compare", {
        params: { path: { order_id: id }, query: version ? { version: Number(version) } : {} },
      });
      if (response.status === 404) {
        router.replace(`/market/orders/${id}`);
        return;
      }
      const body = data as unknown as Compare | undefined;
      if (response.ok && body) {
        setCmp(body);
        setLeft(body.seconds_left);
      }
    },
    [id, router],
  );

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/compare`)}`);
      return;
    }
    void load(opened).catch(() => undefined);
  }, [router, load, id, opened]);

  useEffect(() => {
    if (!left) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [left]);

  const accept = async (n: number) => {
    if (busy) return;
    setBusy("accept");
    try {
      const r = await api().POST("/api/market/orders/{order_id}/accept", {
        params: { path: { order_id: id } },
        body: { version: n } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { detail?: string; extra?: { latest?: number } } | Detail | undefined;
      if (r.response.ok && b && "order" in b) {
        setAccepted(b);
        return;
      }
      const err = b as { detail?: string; extra?: { latest?: number } } | undefined;
      if (err?.detail === "version_superseded") {
        setSuperseded(err.extra?.latest ?? null);
        await load("");
      } else if (err?.detail === "version_expired") {
        await load(opened);
      }
    } finally {
      setBusy("");
    }
  };

  const reject = async () => {
    if (busy || !cmp?.shown || !rejectReason.trim()) return;
    setBusy("reject");
    try {
      const r = await api().POST("/api/market/orders/{order_id}/reject", {
        params: { path: { order_id: id } },
        body: { version: cmp.latest?.number ?? cmp.shown.number, reason: rejectReason } as never,
      });
      if (r.response.ok) setRejected(true);
    } finally {
      setBusy("");
    }
  };

  const requote = async () => {
    if (busy) return;
    setBusy("requote");
    try {
      const r = await api().POST("/api/market/orders/{order_id}/requote", {
        params: { path: { order_id: id } },
        body: {} as never,
      });
      if (r.response.ok) setRequoted(true);
    } finally {
      setBusy("");
    }
  };

  const state: State = accepted
    ? "success"
    : superseded !== null
      ? "validation_error"
      : cmp?.expired
        ? "expired"
        : cmp?.conflict
          ? "conflict"
          : "ready";
  const shown = cmp?.shown ?? null;
  const latest = cmp?.latest ?? null;
  const request = cmp?.request ?? null;
  const targetVersion = state === "conflict" ? latest : shown;
  // في التعارض النسخة الحالية موجودة بالضرورة؛ خارجه تساوي المعروضة
  const cur: Version | null = latest ?? shown;
  const EMPTY_VERSION: Version = {
    id: "",
    number: 0,
    kind: "quote",
    kind_label: "",
    author_side: "supplier",
    lines: [],
    delivery_fee_minor: "",
    delivery_days: null,
    valid_until: "",
    rejected_at: "",
    note: "",
    summary: "",
    draft: false,
    sent_at: "",
    accepted_at: "",
    is_agreement: false,
    created_at: "",
  };
  const curV: Version = cur ?? EMPTY_VERSION;

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-orders" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-07" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">قبول عرض سعر — لا موافقة على نسخة قديمة</h2>
            <span className="cat-head__hint">
              فرق النسخة معروض سطراً بسطر، والقبول يخص النسخة المعروضة وحدها. لا زرّ قبول قبل عرض
              الفرق: القبول بضغطةٍ من قائمة يُنتج اتفاقاً لم يُقرأ. الشاشة تُجبر على المقابلة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && accepted ? (
              <Notice
                kind="success"
                title="قُبل العرض"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  الإصدار المقبول يُثبَّت نسخةً من الاتفاق: كمياته وأسعاره ورسومه ومدته كما كانت
                  لحظة القبول. الاتفاق: الإصدار{" "}
                  <span className="sting-mono">{accepted.agreed_version ?? ""}</span>.
                </p>
                <p className="acc-choice__note">
                  <strong>نسخة لا مرجع</strong> · انتهاء الكتالوج بعد القبول لا يمسّ الاتفاق. مرجعٌ
                  متحرّك يعني عقداً يتغيّر بلا توقيع.
                </p>
              </Notice>
            ) : null}
            {rejected ? (
              <Notice
                kind="info"
                title="رُفض العرض وطُلب تعديل"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">عاد الطلب إلى «بانتظار رد المورد» وسببك يظهر له.</p>
              </Notice>
            ) : null}
            {requoted ? (
              <Notice
                kind="info"
                title="طُلب تأكيد جديد"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  عاد الطلب إلى «بانتظار رد المورد» — لا قبول صامت لسعر انتهت صلاحيته.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="warning" title="قبول إصدار ليس الأحدث">
                <p className="acc-lead">
                  الرابط المفتوح للإصدار <span className="sting-mono">{shown?.number ?? ""}</span>{" "}
                  والمورد أرسل الإصدار <span className="sting-mono">{superseded ?? ""}</span>.
                </p>
                <p className="acc-choice__note">
                  <strong>رفض صريح</strong> · لا نُحوّل القبول إلى الأحدث ضمناً. نعرض الإصدار الجديد
                  وفرقه ونطلب قبولاً جديداً.
                </p>
                <div className="acc-actions">
                  <Button
                    onClick={() => {
                      setSuperseded(null);
                    }}
                  >
                    اعرض الإصدار الجديد وفرقه
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "expired" && shown ? (
              <Notice kind="warning" title="انتهت صلاحية العرض أثناء المراجعة">
                <p className="acc-lead">
                  صلاحية الإصدار <span className="sting-mono">{shown.number}</span> كانت حتى{" "}
                  <span className="sting-mono">
                    {shown.valid_until.slice(8, 10)}/{shown.valid_until.slice(5, 7)}
                  </span>
                  .
                </p>
                <p className="acc-choice__note">
                  <strong>لا قبول صامت</strong> · التأكيد الخادمي يمنع اعتباره سعراً حالياً.
                  المعروض: «اطلب تأكيداً جديداً» لا «تابع».
                </p>
                <div className="acc-actions">
                  <Button pos loading={busy === "requote"} onClick={() => void requote()}>
                    اطلب تأكيداً جديداً
                  </Button>
                  <Button disabledReason="انتهت صلاحية العرض — لا قبول لسعر منتهٍ">
                    قبول — مغلق
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "conflict" && shown && latest ? (
              <Notice kind="warning" title="نسخة أحدث متاحة">
                <p className="acc-lead">
                  فتحتَ النسخة <span className="sting-mono">{shown.number}</span> · المورد أصدر
                  النسخة <span className="sting-mono">{curV.number}</span> {agoWord(curV.sent_at)}.
                  لم نقبل نيابة عنك ولم نستبدل الشاشة من تحتك.
                </p>
                <p className="acc-choice__note">
                  ما يلي فرق النسختين. القبول ينشئ اتفاقاً على النسخة{" "}
                  <span className="sting-mono">{curV.number}</span> بعد قراءتك للفرق؛ النسخة{" "}
                  <span className="sting-mono">{shown.number}</span> لم تعد قابلة للقبول.
                </p>
              </Notice>
            ) : null}

            {cmp && shown && request && !accepted && !rejected && !requoted ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={
                      state === "conflict" ? "conflict" : state === "expired" ? "expired" : "stale"
                    }
                    label={state === "conflict" ? "تعارض" : "عرض سعر"}
                  />
                </div>
                <h3 className="cat-head__title">
                  <span className="sting-mono">Q-{cmp.order.number}</span> —{" "}
                  {cmp.order.supplier_name}
                </h3>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">البند</th>
                      <th scope="col">طلبك</th>
                      <th scope="col">
                        {state === "conflict"
                          ? `النسخة ${shown.number} — التي فتحتها`
                          : `عرض المورد — النسخة ${shown.number}`}
                      </th>
                      {state === "conflict" ? (
                        <th scope="col">النسخة {curV.number} — الحالية</th>
                      ) : null}
                      <th scope="col">الفرق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmp.rows.map((r) => (
                      <tr key={r.offer_id}>
                        <td>
                          <strong>
                            {r.public_name}
                            {r.pack_label ? ` — ${r.pack_label}` : ""}
                          </strong>
                        </td>
                        <td>
                          <span className="sting-mono">{r.requested_qty}</span> ×{" "}
                          <span className="sting-mono">
                            {r.requested_price_minor ? formatMinor(r.requested_price_minor) : "—"}
                          </span>
                        </td>
                        <td>
                          <span className="sting-mono">{r.shown_qty ?? "—"}</span> ×{" "}
                          <span className="sting-mono">
                            {r.shown_price_minor ? formatMinor(r.shown_price_minor) : "—"}
                          </span>
                          {r.increase_reason ? (
                            <div className="mp-reason">سبب الزيادة: {r.increase_reason}</div>
                          ) : null}
                        </td>
                        {state === "conflict" ? (
                          <td>
                            <span className="sting-mono">{r.current_qty ?? "—"}</span> ×{" "}
                            <span className="sting-mono">
                              {r.current_price_minor ? formatMinor(r.current_price_minor) : "—"}
                            </span>
                          </td>
                        ) : null}
                        <td>
                          {state === "conflict"
                            ? r.version_diff_label === "بلا تغيير"
                              ? "بلا تغيير"
                              : lineDiff({
                                  ...r,
                                  requested_qty: r.shown_qty ?? r.requested_qty,
                                  requested_price_minor: r.shown_price_minor,
                                  shown_qty: r.current_qty,
                                  shown_price_minor: r.current_price_minor,
                                })
                            : `${r.diff_label}${r.diff_label !== "بلا تغيير" ? ` · ${lineDiff(r)}` : ""}`}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>رسوم التوصيل</td>
                      <td>—</td>
                      <td>
                        {shown.delivery_fee_minor ? (
                          <span className="sting-mono">
                            {formatMinor(shown.delivery_fee_minor)}
                          </span>
                        ) : (
                          "مشمول"
                        )}
                      </td>
                      {state === "conflict" ? (
                        <td>
                          {curV.delivery_fee_minor ? (
                            <span className="sting-mono">
                              {formatMinor(curV.delivery_fee_minor)}
                            </span>
                          ) : (
                            "مشمول"
                          )}
                        </td>
                      ) : null}
                      <td>
                        {state === "conflict" && cur
                          ? cur.delivery_fee_minor && !shown.delivery_fee_minor
                            ? `بند جديد لم يكن في النسخة ${shown.number}`
                            : "بلا تغيير"
                          : shown.delivery_fee_minor
                            ? "رسمٌ مضاف"
                            : "بلا تغيير"}
                      </td>
                    </tr>
                    <tr>
                      <td>مهلة التسليم</td>
                      <td>—</td>
                      <td>{shown.delivery_days ? daysWord(shown.delivery_days) : "—"}</td>
                      {state === "conflict" ? (
                        <td>{curV.delivery_days ? daysWord(curV.delivery_days) : "—"}</td>
                      ) : null}
                      <td>
                        {state === "conflict" &&
                        curV.delivery_days &&
                        shown.delivery_days &&
                        curV.delivery_days > shown.delivery_days
                          ? daysDiff(curV.delivery_days - shown.delivery_days)
                          : state !== "conflict" && shown.delivery_days
                            ? "مدةٌ معلنة"
                            : "بلا تغيير"}
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <strong>الإجمالي</strong>
                      </td>
                      <td className="sting-mono">
                        {cmp.request_total_minor ? formatMinor(cmp.request_total_minor) : "—"}
                      </td>
                      <td className="sting-mono">
                        {cmp.shown_total_minor ? formatMinor(cmp.shown_total_minor) : "—"}
                      </td>
                      {state === "conflict" ? (
                        <td className="sting-mono">
                          {cmp.latest_total_minor ? formatMinor(cmp.latest_total_minor) : "—"}
                        </td>
                      ) : null}
                      <td>
                        {(() => {
                          const a = Number(
                            state === "conflict"
                              ? cmp.shown_total_minor || 0
                              : cmp.request_total_minor || 0,
                          );
                          const b = Number(
                            state === "conflict"
                              ? cmp.latest_total_minor || 0
                              : cmp.shown_total_minor || 0,
                          );
                          const dd = b - a;
                          return dd
                            ? `${dd > 0 ? "+" : "−"}${formatMinor(String(Math.abs(dd)))}`
                            : "بلا تغيير";
                        })()}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="acc-choice__note">
                  <strong>طلبك · عرض المورد · الفرق</strong> · ثلاثة أعمدة بالوحدة الأساسية، والفرق
                  مسمّى: سعرٌ أعلى، كميةٌ أقل، رسمٌ مضاف، مدةٌ أطول.
                </p>
                {targetVersion?.valid_until && state !== "expired" ? (
                  <p className="acc-choice__note">
                    صلاحية النسخة <span className="sting-mono">{targetVersion.number}</span> تنتهي
                    بعد <span className="sting-mono">{hms(left)}</span>. عند انتهائها لا يصبح القبول
                    تلقائياً ولا ملغى تلقائياً — يعود الطلب إلى «بانتظار تأكيد جديد».
                  </p>
                ) : null}
                {state !== "expired" ? (
                  <div className="acc-actions">
                    <Button
                      pos
                      loading={busy === "accept"}
                      onClick={() => void accept(targetVersion?.number ?? shown.number)}
                    >
                      قبول النسخة {targetVersion?.number ?? shown.number} كما هي
                    </Button>
                    {state === "conflict" ? (
                      <Button
                        disabledReason={`النسخة ${shown.number} لم تعد قابلة للقبول — الأحدث ${curV.number}`}
                      >
                        قبول النسخة {shown.number} — مغلق
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <TextField
                  label="سبب الرفض أو التعديل المطلوب — يظهر للمورد"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="acc-actions">
                  <Button
                    loading={busy === "reject"}
                    onClick={() => void reject()}
                    disabledReason={
                      rejectReason.trim() ? undefined : "الرفض يحتاج سبباً يظهر للمورد"
                    }
                  >
                    رفض وطلب تعديل
                  </Button>
                </div>
              </>
            ) : null}
            {cmp && !shown && !accepted ? (
              <Notice kind="empty" title="لا عرض من المورد بعد">
                <div className="acc-actions">
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                </div>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
