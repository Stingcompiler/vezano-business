"use client";

import { Button, formatMinor, Frame, Notice, Status, SwitchField, TextField } from "@sting/ui-web";
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
import type { Detail } from "@/features/market/order-detail-client";
import type { OrderRow } from "@/features/market/orders-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "partial" | "conflict" | "success";

interface RLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  requested: number;
  confirmed: number;
  shipped_in_this: number;
  received_before: number;
  shipped_total: number;
  price_minor: string;
}

interface Payload {
  order: OrderRow;
  shipment: {
    id: string;
    number: number;
    ref_label: string;
    shipped_at: string;
    received_at: string;
    received_lines: unknown[];
    dispute_opened: boolean;
  } | null;
  pending_shipments: string[];
  lines: RLine[];
}

interface Edit {
  received: string;
  rejected: string;
  reason: string;
}

const ordinal = (n: number) =>
  ["", "الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة"][n] ?? `رقم ${n}`;

/** ORD-09 — استلام جزئي ورفض كمية (08-D4 partial · 41-D33 ready/validation_error/conflict/success): أربعة أرقام لا رقم واحد. */
export function ReceiveClient({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("shipment") ?? "";
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [openDispute, setOpenDispute] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ code: string; max: number | undefined } | null>(
    null,
  );
  const [done, setDone] = useState<
    (Detail & { received: string; gap: number; dispute_opened: boolean }) | null
  >(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}/receive", {
      params: { path: { order_id: id }, query: wanted ? { shipment: wanted } : {} },
    });
    if (response.status === 404) {
      router.replace(`/market/orders/${id}`);
      return;
    }
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) {
      setP(body);
      setEdits(
        Object.fromEntries(
          body.lines.map((l) => [
            l.offer_id,
            { received: String(l.shipped_in_this), rejected: "0", reason: "" },
          ]),
        ),
      );
    }
  }, [id, router, wanted]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/receive`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const lines = p?.lines ?? [];
  const num = (v: string) => Number(v || 0);
  const over = lines.filter((l) => {
    const e = edits[l.offer_id];
    return e && num(e.received) + num(e.rejected) > l.shipped_in_this && !e.reason.trim();
  });
  const rejectedNoReason = lines.filter((l) => {
    const e = edits[l.offer_id];
    return e && num(e.rejected) > 0 && !e.reason.trim();
  });
  const anyRejected = lines.some((l) => num(edits[l.offer_id]?.rejected ?? "0") > 0);
  const gapTotal = lines.reduce((acc, l) => {
    const e = edits[l.offer_id];
    return (
      acc + Math.max(0, l.shipped_in_this - Math.min(num(e?.received ?? "0"), l.shipped_in_this))
    );
  }, 0);
  const invalid = over.length > 0 || rejectedNoReason.length > 0;

  const submit = async (withDispute: boolean) => {
    setAttempted(true);
    setServerError(null);
    if (invalid || busy || !p?.shipment) return;
    setBusy(true);
    try {
      const r = await api().POST("/api/market/orders/{order_id}/receive", {
        params: { path: { order_id: id } },
        body: {
          shipment_id: p.shipment.id,
          open_dispute: withDispute,
          lines: lines.map((l) => ({
            offer_id: l.offer_id,
            qty_received: num(edits[l.offer_id]?.received ?? "0"),
            qty_rejected: num(edits[l.offer_id]?.rejected ?? "0"),
            reason: edits[l.offer_id]?.reason ?? "",
            disposition: num(edits[l.offer_id]?.rejected ?? "0") ? "return" : "",
          })),
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        | (Detail & { received: string; gap: number; dispute_opened: boolean })
        | { detail?: string; extra?: { max?: number } }
        | undefined;
      if (r.response.ok && b && "order" in b) setDone(b);
      else {
        const err = b as { detail?: string; extra?: { max?: number } } | undefined;
        setServerError({ code: err?.detail ?? "server_error", max: err?.extra?.max });
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = done
    ? "success"
    : (attempted && over.length > 0) || serverError?.code === "exceeds_shipped"
      ? "validation_error"
      : anyRejected
        ? "conflict"
        : gapTotal > 0
          ? "partial"
          : "ready";
  const firstOver =
    over[0] ?? lines.find((l) => l.offer_id === (serverError ? lines[0]?.offer_id : "")) ?? null;

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-orders" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">استلام جزئي ورفض كمية — أربعة أرقام لا رقم واحد</h2>
            <span className="cat-head__hint">
              ACC-132: دفتر المشتري ودفتر البائع مستقلان، والفارق يُسجَّل خلافاً لا يُسوّى تلقائياً.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && done ? (
              <Notice
                kind="success"
                title="سُجّل الاستلام"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  ما دخل المخزون، وما رُفض ومصيره: مرتجعٌ للمورد أو حجرٌ حتى القرار.{" "}
                  <span className="sting-mono">{done.received}</span>
                  {done.gap ? (
                    <>
                      {" "}
                      · الفارق <span className="sting-mono">{done.gap}</span>{" "}
                      {done.dispute_opened ? "— فُتح خلاف الفارق (ORD-12)" : "— محجوز حتى يُغلق"}
                    </>
                  ) : (
                    " · مطابقة"
                  )}
                </p>
                <p className="acc-choice__note">
                  <strong>الذمّة من المستلم</strong> · تُقيَّد قيمة ما استُلم فقط. والمرفوض لا
                  يُقيَّد ولا يُحذف — يبقى بندَ مطالبة. قيمة المستلم{" "}
                  <span className="sting-mono">{formatMinor(done.received_value_minor)}</span>.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="warning" title="استلام يتجاوز المتبقّي">
                <p className="acc-lead">
                  {firstOver ? (
                    <>
                      المتبقّي <span className="sting-mono">{firstOver.shipped_in_this}</span>{" "}
                      والعدّ{" "}
                      <span className="sting-mono">
                        {num(edits[firstOver.offer_id]?.received ?? "0") +
                          num(edits[firstOver.offer_id]?.rejected ?? "0")}
                      </span>
                      .
                    </>
                  ) : rejectedNoReason.length ? (
                    "رفض كمية يحتاج سبباً مكتوباً."
                  ) : serverError ? (
                    `الخادم رفض العدّ: الأقصى ${serverError.max ?? ""}.`
                  ) : null}
                </p>
                <p className="acc-choice__note">
                  <strong>رفض خادمي لا تحذير</strong> · الاستلام التراكمي لا يتجاوز المشحون
                  (ACC-128). الزيادة تُسجَّل بسبب مكتوب وتُحال إلى مراجعة الفرق.
                </p>
              </Notice>
            ) : null}
            {state === "conflict" ? (
              <Notice kind="warning" title="رفض كمية يدّعي البائع تسليمها">
                <p className="acc-lead">رفضتَ كميةً، والمورد يقول سلّمها سليمة.</p>
                <p className="acc-choice__note">
                  <strong>دفتران مستقلان</strong> · لا تسوية تلقائية ولا ترجيح (ACC-132). كلٌّ يقيّد
                  ما يقرّ به، والفرق محجوز حتى يُغلق.
                </p>
                <p className="acc-choice__note">
                  <strong>البابُ خلاف</strong> · المسار المعروض «افتح خلافاً بالأدلة» (ORD-12) لا
                  «صحّح الكمية». تصحيحُ رقمٍ يخفي نزاعاً.
                </p>
              </Notice>
            ) : null}
            {state === "ready" && p?.shipment ? (
              <Notice kind="info" title="أربعة أعمدة وعمود تعدّه">
                <p className="acc-lead">
                  مطلوب ومؤكَّد ومشحون — والخامس ما تعدّه أنت. والمشحون معروضٌ صراحةً.
                </p>
                <p className="acc-choice__note">
                  <strong>لماذا يُعرض المشحون</strong> · لأنه دعوى الطرف الآخر لا رقمُ النظام (كما
                  INV-10). أنت تُقرّ بما وصلك مقابل ما يدّعي أنه أرسله.
                </p>
              </Notice>
            ) : null}

            {p && !p.shipment && !done ? (
              <Notice kind="empty" title="لا شحنة بانتظار الاستلام">
                <div className="acc-actions">
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                </div>
              </Notice>
            ) : null}

            {p?.shipment && !done ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={state === "partial" || state === "conflict" ? "partial" : "stale"}
                    label={
                      state === "partial" ? "تنفيذ جزئي" : state === "conflict" ? "خلاف" : "استلام"
                    }
                  />
                </div>
                <h3 className="cat-head__title">
                  استلام الشحنة <span className="sting-mono">{p.shipment.ref_label}</span> من الطلب{" "}
                  <span className="sting-mono">{p.order.number_label}</span>
                </h3>
                <p className="acc-choice__note">
                  الشحنة {ordinal(p.shipment.number)} · {p.order.supplier_name} · المستلم:{" "}
                  {app.session.displayName ?? "—"}
                </p>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">مطلوب</th>
                      <th scope="col">مؤكد</th>
                      <th scope="col">مشحون</th>
                      <th scope="col">مستلم فعلاً</th>
                      <th scope="col">الفارق وسببه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const e = edits[l.offer_id] ?? { received: "0", rejected: "0", reason: "" };
                      const gap = l.shipped_in_this - Math.min(num(e.received), l.shipped_in_this);
                      return (
                        <tr key={l.offer_id} className={gap > 0 ? "cus-item--expired" : undefined}>
                          <td>
                            <strong>{l.public_name}</strong>
                            <div className="mp-check__hint">{l.pack_label || l.unit_name}</div>
                          </td>
                          <td className="sting-mono">{l.requested}</td>
                          <td className="sting-mono">{l.confirmed}</td>
                          <td className="sting-mono">{l.shipped_in_this}</td>
                          <td>
                            <TextField
                              label={`مستلم فعلاً — ${l.public_name}`}
                              kind="number"
                              mono
                              value={e.received}
                              onChange={(ev) =>
                                setEdits((c) => ({
                                  ...c,
                                  [l.offer_id]: { ...e, received: ev.target.value },
                                }))
                              }
                            />
                            <TextField
                              label={`مرفوض — ${l.public_name}`}
                              kind="number"
                              mono
                              value={e.rejected}
                              onChange={(ev) =>
                                setEdits((c) => ({
                                  ...c,
                                  [l.offer_id]: { ...e, rejected: ev.target.value },
                                }))
                              }
                            />
                          </td>
                          <td>
                            {gap > 0 || num(e.rejected) > 0 ? (
                              <>
                                <div>
                                  فارق <span className="sting-mono">{gap}</span>
                                  {num(e.rejected) ? (
                                    <>
                                      {" "}
                                      · مرفوض <span className="sting-mono">{num(e.rejected)}</span>
                                    </>
                                  ) : null}
                                </div>
                                <TextField
                                  label={`سبب الفارق — ${l.public_name}`}
                                  value={e.reason}
                                  onChange={(ev) =>
                                    setEdits((c) => ({
                                      ...c,
                                      [l.offer_id]: { ...e, reason: ev.target.value },
                                    }))
                                  }
                                  error={
                                    attempted &&
                                    !e.reason.trim() &&
                                    (num(e.rejected) > 0 ||
                                      num(e.received) + num(e.rejected) > l.shipped_in_this)
                                      ? "سبب مكتوب مطلوب"
                                      : undefined
                                  }
                                />
                              </>
                            ) : (
                              "مطابق"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="pub-cols">
                  <div>
                    <strong>ما يكتبه هذا الإجراء في دفترك:</strong>
                    <p className="acc-choice__note">
                      إدخال مخزون بالكميات المستلمة فعلاً، وذمة للمورد بقيمة المستلم وحده. المشحون
                      غير المستلم لا يُخصم من مخزونك ولا يُحتسب عليك.
                    </p>
                  </div>
                  <div>
                    <strong>ما لا يكتبه:</strong>
                    <p className="acc-choice__note">
                      لا يُعدّل دفتر المورد ولا يُلغي مطالبته. هو يقول «شحنت 8»، وأنت تقول «استلمت
                      7». الرقمان يبقيان، ويُفتح خلاف في ORD-12 يحمله موظف من الطرفين لا خوارزمية.
                    </p>
                  </div>
                </div>
                {gapTotal > 0 ? (
                  <SwitchField
                    label="افتح خلافاً بالأدلة (ORD-12)"
                    checked={openDispute}
                    onChange={setOpenDispute}
                    hint="الفارق يُحسم في مساره لا بتصحيح رقم"
                  />
                ) : null}
                <div className="acc-actions">
                  {gapTotal > 0 ? (
                    <>
                      <Button pos loading={busy} onClick={() => void submit(true)}>
                        تسجيل الاستلام وفتح خلاف الفارق
                      </Button>
                      <Button loading={busy} onClick={() => void submit(false)}>
                        تسجيل الاستلام دون خلاف
                      </Button>
                    </>
                  ) : (
                    <Button pos loading={busy} onClick={() => void submit(false)}>
                      تسجيل الاستلام
                    </Button>
                  )}
                  <Button
                    variant="quiet"
                    onClick={() => router.push(`/market/orders/${id}/cancel-remaining`)}
                  >
                    إلغاء المتبقي — ORD-10
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/market/link/receipts")}>
                    تحويل الاستلام إلى مستند مخزني — LINK-03
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
