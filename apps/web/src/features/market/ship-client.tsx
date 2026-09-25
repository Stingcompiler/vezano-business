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

type State = "ready" | "validation_error" | "partial" | "success";

interface ShipLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  confirmed: number;
  shipped: number;
  remaining: number;
}

interface Shipment {
  id: string;
  number: number;
  ref_label: string;
  lines: { offer_id: string; public_name: string; qty: number }[];
  carrier_ref: string;
  eta_note: string;
  note: string;
  shipped_at: string;
  received_at: string;
}

export interface Shipments {
  order: OrderRow;
  lines: ShipLine[];
  shipments: Shipment[];
  next_ref: string;
  percent: number;
  can_ship: boolean;
  side: "buyer" | "supplier";
  shipped?: string;
}

const ordinal = (n: number) =>
  ["", "الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة"][n] ?? `رقم ${n}`;
const ordinalIndef = (n: number) =>
  ["", "أولى", "ثانية", "ثالثة", "رابعة", "خامسة", "سادسة"][n] ?? `رقم ${n}`;

/** ORD-08 — تجهيز وتسليم جزئي (27-D20 validation_error/partial/success · 12-D7 ready): التراكم لا يتجاوز المؤكَّد أبداً. */
export function ShipClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [d, setD] = useState<Shipments | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState("");
  const [eta, setEta] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Shipments | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}/shipments", {
      params: { path: { order_id: id } },
    });
    if (response.status === 404) {
      router.replace(`/market/orders/${id}`);
      return;
    }
    const body = data as unknown as Shipments | undefined;
    if (response.ok && body) {
      setD(body);
      setQty(Object.fromEntries(body.lines.map((l) => [l.offer_id, "0"])));
    }
  }, [id, router]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/ship`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const over = (d?.lines ?? []).filter((l) => Number(qty[l.offer_id] || 0) > l.remaining);
  const any = (d?.lines ?? []).some((l) => Number(qty[l.offer_id] || 0) > 0);

  const submit = async () => {
    setAttempted(true);
    if (over.length || !any || busy || !d) return;
    setBusy(true);
    try {
      const r = await api().POST("/api/market/orders/{order_id}/shipments", {
        params: { path: { order_id: id } },
        body: {
          lines: d.lines.map((l) => ({ offer_id: l.offer_id, qty: Number(qty[l.offer_id] || 0) })),
          carrier_ref: carrier,
          eta_note: eta,
        } as never,
      });
      const b = r.data as unknown as Shipments | undefined;
      if (r.response.ok && b) setDone(b);
    } finally {
      setBusy(false);
    }
  };

  const state: State = done
    ? "success"
    : attempted && over.length
      ? "validation_error"
      : d && d.shipments.length
        ? "partial"
        : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-incoming" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-08" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              تجهيز وتسليم جزئي — التراكم لا يتجاوز المؤكَّد أبداً
            </h2>
            <span className="cat-head__hint">
              شحنة بعد شحنة على الطلب نفسه. الحدّ الصلب: مجموع المشحون ≤ المؤكَّد لكل صنف، وكل شحنة
              لها مرجع مستقل يُطابق عند الاستلام.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && done ? (
              <Notice
                kind="success"
                title={`شُحنت ${done.shipped ?? ""}`}
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  {done.percent >= 100 ? (
                    "اكتمل المشحون — بانتظار الاستلام والعدّ عند المشتري."
                  ) : (
                    <>
                      حالة الطلب صارت «مشحون جزئياً —{" "}
                      <span className="sting-mono">{done.percent}</span>%». المتبقّي معلَن للطرفين،
                      وللمشتري أن يلغيه أو ينتظر شحنة {ordinalIndef(done.shipments.length + 1)}.
                    </>
                  )}
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice
                kind="warning"
                title={`validation_error على ${over.length === 1 ? "صف" : "صفوف"} — يتجاوز المؤكَّد`}
              >
                <p className="acc-lead">
                  أُدخل <span className="sting-mono">{qty[over[0]?.offer_id ?? ""] ?? ""}</span>{" "}
                  {over[0]?.unit_name ?? ""} والمتبقّي{" "}
                  <span className="sting-mono">{over[0]?.remaining ?? 0}</span> فقط. لا نقبل الشحنة
                  ولا نقتطع الفائض صامتين — نوقف الحفظ ونعرض الرقم الأقصى المسموح. لو أراد المورد
                  شحن أكثر فذلك <strong>تعديل على الطلب</strong> يحتاج موافقة المشتري، لا شحنة
                  زائدة.
                </p>
              </Notice>
            ) : null}
            {state === "ready" && d ? (
              <Notice kind="info" title="الشحنة — بيان المورد كما هو">
                <p className="acc-lead">
                  بيان التحميل معروض بلا تعديل. وصول الشحنة لا يكتب مخزوناً — المخزون يُكتب بعدّك
                  عند الاستلام.
                </p>
                <p className="acc-choice__note">
                  رقم الناقل ووقت الوصول حقول اختيارية للاستدلال لاحقاً عند الخلاف، لا شروطاً لتسجيل
                  الاستلام.
                </p>
              </Notice>
            ) : null}

            {d && !done ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={state === "partial" ? "partial" : "stale"}
                    label={state === "partial" ? "جزئي" : "تجهيز"}
                  />
                </div>
                <h3 className="cat-head__title">
                  تجهيز شحنة — <span className="sting-mono">{d.order.number_label}</span>
                </h3>
                <p className="acc-choice__note">
                  المشتري: {d.order.buyer_name} · الشحنة {ordinal(d.shipments.length + 1)} على هذا
                  الطلب · مرجع الشحنة <span className="sting-mono">{d.next_ref}</span>
                </p>
                {d.side === "supplier" && d.can_ship ? (
                  <>
                    <table className="pur-lines">
                      <thead>
                        <tr>
                          <th scope="col">الصنف والوحدة</th>
                          <th scope="col">مؤكَّد</th>
                          <th scope="col">شُحن سابقاً</th>
                          <th scope="col">هذه الشحنة</th>
                          <th scope="col">المتبقّي</th>
                          <th scope="col">الحدّ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.lines.map((l) => {
                          const q = Number(qty[l.offer_id] || 0);
                          const isOver = q > l.remaining;
                          return (
                            <tr
                              key={l.offer_id}
                              className={isOver ? "cus-item--expired" : undefined}
                            >
                              <td>
                                <strong>{l.public_name}</strong>
                                <div className="mp-check__hint">{l.pack_label || l.unit_name}</div>
                              </td>
                              <td className="sting-mono">{l.confirmed}</td>
                              <td className="sting-mono">{l.shipped}</td>
                              <td>
                                <TextField
                                  label={`هذه الشحنة — ${l.public_name}`}
                                  kind="number"
                                  mono
                                  value={qty[l.offer_id] ?? "0"}
                                  onChange={(e) =>
                                    setQty((c) => ({ ...c, [l.offer_id]: e.target.value }))
                                  }
                                  disabledReason={
                                    l.remaining === 0
                                      ? "اكتمل الصنف. الحقل مغلق لا معطَّل بلا تفسير."
                                      : undefined
                                  }
                                  error={
                                    attempted && isOver
                                      ? `الأقصى المسموح ${l.remaining}`
                                      : undefined
                                  }
                                />
                              </td>
                              <td className="sting-mono">{l.remaining}</td>
                              <td>
                                {l.remaining === 0
                                  ? "اكتمل الصنف. الحقل مغلق لا معطَّل بلا تفسير."
                                  : isOver
                                    ? `يتجاوز المؤكَّد بـ${q - l.remaining}. الأقصى المسموح ${l.remaining} — الحفظ موقوف.`
                                    : q === l.remaining && q > 0
                                      ? "يُكمل الصنف بهذه الشحنة."
                                      : `الحدّ الأقصى لهذه الشحنة ${l.remaining} — ضمن الحدّ.`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <TextField
                      label="رقم الناقل (اختياري)"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                    />
                    <TextField
                      label="وقت الوصول المتوقع (اختياري)"
                      value={eta}
                      onChange={(e) => setEta(e.target.value)}
                    />
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy}
                        onClick={() => void submit()}
                        disabledReason={
                          !any && attempted ? "أدخل كمية في سطر واحد على الأقل" : undefined
                        }
                      >
                        احفظ الشحنة {d.next_ref}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="acc-choice__note">
                    {d.side === "buyer"
                      ? "بيان المورد كما هو — المخزون يُكتب بعدّك عند الاستلام."
                      : "لا شحن قبل اتفاق مثبَّت أو بعد اكتمال الطلب."}
                  </p>
                )}
                <h3 className="cat-head__title">مرجع الشحنة — لماذا مستقلّ</h3>
                <p className="acc-choice__note">
                  كل شحنة تحمل مرجعاً خاصاً <span className="sting-mono">SH-01/02/03</span> ومستند
                  تسليم منفصلاً. المشتري يستلم بمرجع الشحنة لا بالطلب كله، فيكون واضحاً أيّ شحنة
                  نقصت وأيّها وصلت سليمة. بلا هذا المرجع يصبح فرق الكمية بلا عنوان ويُحسب جدلاً بين
                  طرفين.
                </p>
                {d.shipments.length ? (
                  <ul className="cus-list">
                    {d.shipments.map((sh) => (
                      <li key={sh.id}>
                        <strong className="sting-mono">{sh.ref_label}</strong>
                        <div className="cus-sub">
                          <span className="sting-mono">{dayMonth(sh.shipped_at).day}</span>{" "}
                          {dayMonth(sh.shipped_at).month}{" "}
                          <span className="sting-mono">{hhmm(sh.shipped_at)}</span> ·{" "}
                          {sh.lines.map((x) => `${x.public_name} ×${x.qty}`).join(" · ")}
                          {sh.carrier_ref ? ` · ${sh.carrier_ref}` : ""}
                        </div>
                        <Status
                          state={sh.received_at ? "success" : "stale"}
                          label={sh.received_at ? "استُلمت" : "بانتظار الاستلام"}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
