"use client";

import {
  Button,
  formatMinor,
  Frame,
  Notice,
  OrderTimeline,
  type OrderStage,
  Status,
} from "@sting/ui-web";
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

type State = "loading" | "ready" | "partial" | "conflict" | "permission_denied";

export interface VersionLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  qty_requested: number;
  qty_confirmed: number | null;
  price_minor: string;
  increase_reason: string;
}

export interface Version {
  id: string;
  number: number;
  kind: "request" | "quote" | "revision";
  kind_label: string;
  author_side: "buyer" | "supplier";
  lines: VersionLine[];
  delivery_fee_minor: string;
  delivery_days: number | null;
  valid_until: string;
  rejected_at: string;
  note: string;
  summary: string;
  draft: boolean;
  sent_at: string;
  accepted_at: string;
  is_agreement: boolean;
  created_at: string;
}

interface Event {
  id: string;
  kind: string;
  side: string;
  title: string;
  detail: string;
  ref_label: string;
  at: string;
}

interface LadderRow {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  requested: number;
  confirmed: number | null;
  shipped: number;
  received: number;
  gap: number;
  price_minor: string;
  status: string;
}

export interface Detail {
  order: OrderRow;
  side: "buyer" | "supplier";
  versions: Version[];
  events: Event[];
  agreed_version: number | null;
  latest_version: number;
  conflict: boolean;
  partial: boolean;
  ladder: LadderRow[];
  received_value_minor: string;
  gap_value_minor: string;
  ladder_rule: string;
  open_disputes?: string[];
}

const DM = ({ iso }: { iso: string }) => {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}
    </>
  );
};
const When = ({ iso }: { iso: string }) => (
  <>
    <DM iso={iso} /> <span className="sting-mono">{hhmm(iso)}</span>
  </>
);

/** ORD-05 — تفاصيل الطلب وسجل الإصدارات (41-D33 ready/loading/conflict/permission_denied · 10-D6 partial): سلّم الكميات، والاتفاق هو المقبول لا الأحدث. */
export function OrderDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [d, setD] = useState<Detail | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}", {
      params: { path: { order_id: id } },
    });
    if (response.status === 404) {
      setDenied(true);
      return;
    }
    const body = data as unknown as Detail | undefined;
    if (response.ok && body) setD(body);
  }, [id]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const accept = async (n: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, response } = await api().POST("/api/market/orders/{order_id}/accept", {
        params: { path: { order_id: id } },
        body: { version: n } as never,
      });
      const body = data as unknown as Detail | undefined;
      if (response.ok && body) setD(body);
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : !d
      ? "loading"
      : d.conflict
        ? "conflict"
        : d.partial
          ? "partial"
          : "ready";
  const agreed = d?.versions.find((v) => v.is_agreement) ?? null;
  const latest = d ? d.versions.filter((v) => !v.draft).at(-1) : null;
  const stages: OrderStage[] = d
    ? [
        { id: "sent", label: "أُرسل", state: "done", atLabel: hhmm(d.order.sent_at) },
        {
          id: "quoted",
          label: "عرض المورد",
          state: d.versions.some((v) => v.kind !== "request" && !v.draft)
            ? "done"
            : d.order.status === "sent"
              ? "current"
              : "upcoming",
        },
        {
          id: "agreed",
          label: "اتفاق مثبَّت",
          state: d.agreed_version ? "done" : d.order.status === "quoted" ? "current" : "upcoming",
          detail: d.agreed_version ? `الإصدار ${d.agreed_version}` : undefined,
        },
        {
          id: "delivery",
          label: "شحن واستلام",
          state: d.partial
            ? "partial"
            : d.order.status === "received"
              ? "done"
              : d.agreed_version
                ? "current"
                : "upcoming",
        },
      ]
    : [];

  return (
    <Frame
      title="السوق"
      nav={<AppNav currentId={d?.side === "supplier" ? "market-incoming" : "market-orders"} />}
      footer={null}
    >
      <div className="sys mp cus" data-screen="ORD-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تفاصيل الطلب وسجل الإصدارات — سلّم الكميات</h2>
            <span className="cat-head__hint">
              الشاشة التي يُفتحها الطرفان عند الخلاف. أربعة أرقام لكل سطر، كلٌّ منها يعني فعلاً
              مختلفاً — وخلطها يصنع ديناً لم يقع.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="empty" title="الرابط لم يعد صالحاً">
                <p className="acc-lead">لا طلب بهذا الرابط، أو لم يعد ضمن ما يُعرض لك.</p>
                <p className="acc-choice__note">
                  <strong>رفض عام</strong> · لا اسم مورد ولا صنف ولا سعر ولا حتى «هذا الطلب موجود»
                  (ACC-60 · ACC-121). وجودُ المستند سِرٌّ أيضاً.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/orders")}>طلباتي</Button>
                </div>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="بناء الخط الزمني">
                <p className="acc-lead">
                  الخط يُبنى من أحداث الطرفين مرتَّبةً، ولا تُعرض حالة الطلب قبل اكتمال السلسلة.
                </p>
                <p className="acc-choice__note">
                  <strong>لا حالة جزئية</strong> · حالةٌ محسوبة من نصف الأحداث تُظهر «مؤكَّد» لطلبٍ
                  شُحن. والحالة هنا تُقرأ قراراً.
                </p>
              </Notice>
            ) : null}

            {d ? (
              <>
                <div className="cus-head">
                  <div className="acc-actions">
                    <Status state="synced" label={d.order.kind_label} />
                    <Status
                      state={
                        d.conflict
                          ? "conflict"
                          : d.partial
                            ? "partial"
                            : d.order.status === "received"
                              ? "success"
                              : "stale"
                      }
                      label={d.partial ? "مستلم جزئياً" : d.order.list_status_label}
                    />
                  </div>
                  <h2 className="cat-head__title">
                    <span className="sting-mono">{d.order.number_label}</span> —{" "}
                    {d.side === "buyer" ? d.order.supplier_name : d.order.buyer_name}
                  </h2>
                  <div className="cus-sub">
                    {agreed ? (
                      <>
                        الاتفاق: الإصدار <span className="sting-mono">{agreed.number}</span> · مقبول{" "}
                        <DM iso={agreed.accepted_at} />
                      </>
                    ) : (
                      "لا اتفاق مثبَّت بعد — الطلب التزامُ شراء لا دين"
                    )}
                  </div>
                </div>
                <OrderTimeline label="مسار الطلب" stages={stages} />

                {state === "conflict" && agreed && latest ? (
                  <Notice kind="warning" title="إصداران متوازيان">
                    <p className="acc-lead">
                      المورد أرسل الإصدار <span className="sting-mono">{latest.number}</span> بينما
                      كان المشتري يقبل الإصدار <span className="sting-mono">{agreed.number}</span>.
                    </p>
                    <p className="acc-choice__note">
                      <strong>الاتفاق هو المشار إليه في القبول</strong> · الإصدار{" "}
                      <span className="sting-mono">{agreed.number}</span> لا الأحدث (ACC-125).
                      والإصدار <span className="sting-mono">{latest.number}</span> يُعرض اقتراحاً
                      يحتاج قبولاً جديداً.
                    </p>
                    <p className="acc-choice__note">
                      <strong>لا إخفاء</strong> · الإصداران معروضان معاً بفرقهما. إخفاء الأحدث يجعل
                      المورد يتصرف على أساسٍ لا يراه المشتري.
                    </p>
                    <table className="pur-lines">
                      <thead>
                        <tr>
                          <th scope="col">الصنف</th>
                          <th scope="col">الإصدار {agreed.number} — الاتفاق</th>
                          <th scope="col">الإصدار {latest.number} — اقتراح</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latest.lines.map((ln) => {
                          const a = agreed.lines.find((x) => x.offer_id === ln.offer_id);
                          return (
                            <tr key={ln.offer_id}>
                              <td>{ln.public_name}</td>
                              <td>
                                {a ? (
                                  <>
                                    <span className="sting-mono">{a.qty_confirmed ?? 0}</span> ×{" "}
                                    <span className="sting-mono">
                                      {a.price_minor ? formatMinor(a.price_minor) : "—"}
                                    </span>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td>
                                <span className="sting-mono">{ln.qty_confirmed ?? 0}</span> ×{" "}
                                <span className="sting-mono">
                                  {ln.price_minor ? formatMinor(ln.price_minor) : "—"}
                                </span>
                                {a && a.price_minor !== ln.price_minor ? (
                                  <div className="mp-reason">
                                    الفرق{" "}
                                    <span className="sting-mono">
                                      {formatMinor(
                                        String(
                                          Number(ln.price_minor || 0) - Number(a.price_minor || 0),
                                        ),
                                      )}
                                    </span>
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {d.side === "buyer" ? (
                      <div className="acc-actions">
                        <Button pos loading={busy} onClick={() => void accept(latest.number)}>
                          اقبل الإصدار {latest.number}
                        </Button>
                        <Button onClick={() => router.push(`/market/orders/${id}/compare`)}>
                          قارن (ORD-07)
                        </Button>
                      </div>
                    ) : null}
                  </Notice>
                ) : null}

                {state === "partial" ? (
                  <Notice kind="warning" title="منفَّذ جزئياً">
                    <p className="acc-lead">
                      ACC-145: انتهاء الكتالوج بعد قبول العرض لا يمس الاتفاق. الإلغاء يخص غير
                      المسلَّم وحده.
                    </p>
                    <p className="acc-choice__note">
                      إلغاء المتبقي — ماذا يُلغى بالضبط: يحتاج سبباً مكتوباً يظهر لطرفي الطلب
                      (ORD-10).
                    </p>
                  </Notice>
                ) : null}

                <h3 className="cat-head__title">سلّم الكميات</h3>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف والوحدة</th>
                      <th scope="col">مطلوب</th>
                      <th scope="col">مؤكَّد</th>
                      <th scope="col">مشحون</th>
                      <th scope="col">مستلم</th>
                      <th scope="col">فارق</th>
                      <th scope="col">وضع السطر</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.ladder.map((r) => (
                      <tr key={r.offer_id} className={r.gap ? "cus-item--expired" : undefined}>
                        <td>
                          <strong>{r.public_name}</strong>
                          <div className="mp-check__hint">{r.pack_label || r.unit_name}</div>
                        </td>
                        <td className="sting-mono">{r.requested}</td>
                        <td className="sting-mono">{r.confirmed ?? "—"}</td>
                        <td className="sting-mono">{r.shipped}</td>
                        <td className="sting-mono">{r.received}</td>
                        <td className="sting-mono">{r.gap}</td>
                        <td>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="acc-choice__note">{d.ladder_rule}</p>
                <div className="home-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">قيمة المستلم — تُقيَّد</div>
                    <div className="home-kpi__value sting-mono">
                      {formatMinor(d.received_value_minor)}
                    </div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">قيمة الفارق — محجوزة</div>
                    <div className="home-kpi__value sting-mono">
                      {formatMinor(d.gap_value_minor)}
                    </div>
                  </div>
                </div>

                <h3 className="cat-head__title">
                  سجل الإصدارات — النسخة المقبولة مثبَّتة لا مرجع متحرّك
                </h3>
                <ul className="cus-list">
                  {d.versions.map((v) => (
                    <li
                      key={v.id}
                      className={
                        v.is_agreement
                          ? undefined
                          : v.kind === "revision"
                            ? "cus-item--expired"
                            : undefined
                      }
                    >
                      <strong>
                        الإصدار <span className="sting-mono">{v.number}</span> · {v.kind_label}
                        {v.draft ? " · مسودة عندك" : ""}
                      </strong>
                      <div className="cus-sub">
                        {v.sent_at ? <DM iso={v.sent_at} /> : "لم تُرسل"} · {v.summary}
                        {v.valid_until ? (
                          <>
                            {" "}
                            · صالح حتى{" "}
                            <span className="sting-mono">
                              {v.valid_until.slice(8, 10)}/{v.valid_until.slice(5, 7)}
                            </span>
                          </>
                        ) : null}
                      </div>
                      {v.is_agreement ? (
                        <Status state="success" label="هذه نسخة الاتفاق المثبَّتة" />
                      ) : v.kind === "revision" ? (
                        <Status state="stale" label="لا يُلزم أحداً: الأحدث ليس الاتفاق" />
                      ) : null}
                    </li>
                  ))}
                </ul>

                <h3 className="cat-head__title">الخط الزمني</h3>
                <ul className="cus-list">
                  {d.events.map((e) => (
                    <li key={e.id}>
                      <strong>{e.title}</strong>
                      <div className="cus-sub">
                        <When iso={e.at} />
                        {e.detail ? ` · ${e.detail}` : ""}
                      </div>
                      {e.ref_label ? <span className="mp-check__hint">{e.ref_label}</span> : null}
                    </li>
                  ))}
                </ul>

                <div className="acc-actions">
                  {d.side === "supplier" &&
                  (d.order.status === "sent" ||
                    d.order.status === "quoted" ||
                    d.order.status === "accepted") ? (
                    <Button pos onClick={() => router.push(`/market/orders/${id}/quote`)}>
                      {d.agreed_version ? "أرسل تعديلاً (إصدار جديد)" : "أعِدّ عرض سعر"}
                    </Button>
                  ) : null}
                  {d.side === "supplier" &&
                  d.agreed_version &&
                  (d.order.status === "accepted" || d.order.status === "preparing") ? (
                    <Button onClick={() => router.push(`/market/orders/${id}/ship`)}>
                      جهّز شحنة
                    </Button>
                  ) : null}
                  {d.side === "buyer" && (d.order.status === "quoted" || d.conflict) ? (
                    <Button pos onClick={() => router.push(`/market/orders/${id}/compare`)}>
                      قارن العرض واقبله أو ارفضه
                    </Button>
                  ) : null}
                  {d.agreed_version ? (
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/market/orders/${id}/ship`)}
                    >
                      الشحنات
                    </Button>
                  ) : null}
                  {d.side === "buyer" && d.ladder.some((r) => r.shipped > r.received) ? (
                    <Button pos onClick={() => router.push(`/market/orders/${id}/receive`)}>
                      استلم وافحص الكميات
                    </Button>
                  ) : null}
                  {d.side === "buyer" && d.agreed_version && !d.order.remaining_cancelled ? (
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/market/orders/${id}/cancel-remaining`)}
                    >
                      إلغاء المتبقّي
                    </Button>
                  ) : null}
                  {d.side === "buyer" && d.ladder.some((r) => r.received > 0) ? (
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/market/orders/${id}/return`)}
                    >
                      طلب مرتجع
                    </Button>
                  ) : null}
                  {d.agreed_version && d.ladder.some((r) => r.received > 0) ? (
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/market/orders/${id}/payment`)}
                    >
                      إثبات الدفع
                    </Button>
                  ) : null}
                  {d.order.reconciling || d.order.restore_point ? (
                    <Button onClick={() => router.push(`/market/orders/${id}/restore`)}>
                      المصالحة بعد الاستعادة
                    </Button>
                  ) : null}
                  {d.open_disputes?.length || d.order.status === "disputed" ? (
                    <Button onClick={() => router.push(`/market/orders/${id}/disputes`)}>
                      الخلاف {d.open_disputes?.join(" · ") ?? ""}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
