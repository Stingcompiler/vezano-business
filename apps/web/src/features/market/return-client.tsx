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
import type { OrderRow } from "@/features/market/orders-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "partial" | "success";

interface RLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  received: number;
  returned_before: number;
  returnable: number;
  rejected_at_receipt: number;
}

interface ReturnDoc {
  id: string;
  number: number;
  ref_label: string;
  lines: {
    offer_id: string;
    public_name: string;
    qty: number;
    approved_qty: number | null;
    reason: string;
  }[];
  status: "requested" | "approved" | "partial" | "rejected" | "executed";
  status_label: string;
  decision_note: string;
  requested_at: string;
  decided_at: string;
}

interface Payload {
  order: OrderRow;
  side: "buyer" | "supplier";
  lines: RLine[];
  returns: ReturnDoc[];
  steps: { title: string; detail: string }[];
  next_ref: string;
  created?: ReturnDoc;
}

/** ORD-11 — طلب مرتجع تجاري (27-D20 ready/validation_error/partial/success): موافقة ثم تنفيذ، ومستند مستقلّ لكل خطوة. */
export function ReturnClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState("");
  const [created, setCreated] = useState<ReturnDoc | null>(null);
  const [approved, setApproved] = useState<Record<string, string>>({});
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}/returns", {
      params: { path: { order_id: id } },
    });
    if (response.status === 404) {
      router.replace(`/market/orders/${id}`);
      return;
    }
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) {
      setP(body);
      setQty(Object.fromEntries(body.lines.map((l) => [l.offer_id, "0"])));
      setReason(Object.fromEntries(body.lines.map((l) => [l.offer_id, ""])));
    }
  }, [id, router]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/return`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const lines = p?.lines ?? [];
  const n = (v: string | undefined) => Number(v || 0);
  const over = lines.filter((l) => n(qty[l.offer_id]) > l.returnable);
  const missingReason = lines.filter(
    (l) => n(qty[l.offer_id]) > 0 && !(reason[l.offer_id] ?? "").trim(),
  );
  const any = lines.some((l) => n(qty[l.offer_id]) > 0);

  const submit = async () => {
    setAttempted(true);
    if (over.length || missingReason.length || !any || busy) return;
    setBusy("request");
    try {
      const r = await api().POST("/api/market/orders/{order_id}/returns", {
        params: { path: { order_id: id } },
        body: {
          lines: lines
            .filter((l) => n(qty[l.offer_id]) > 0)
            .map((l) => ({
              offer_id: l.offer_id,
              qty: n(qty[l.offer_id]),
              reason: reason[l.offer_id] ?? "",
            })),
        } as never,
      });
      const b = r.data as unknown as Payload | undefined;
      if (r.response.ok && b?.created) {
        setCreated(b.created);
        setP(b);
      }
    } finally {
      setBusy("");
    }
  };

  const decide = async (doc: ReturnDoc) => {
    if (busy) return;
    setBusy(doc.id);
    try {
      const r = await api().POST("/api/market/orders/{order_id}/returns/{return_id}/decide", {
        params: { path: { order_id: id, return_id: doc.id } },
        body: {
          lines: doc.lines.map((l) => ({
            offer_id: l.offer_id,
            approved_qty: n(approved[`${doc.id}:${l.offer_id}`] ?? String(l.qty)),
          })),
        } as never,
      });
      if (r.response.ok) await load();
    } finally {
      setBusy("");
    }
  };

  const pending = (p?.returns ?? []).find((r) => r.status === "requested") ?? null;
  const partialDoc = (p?.returns ?? []).find((r) => r.status === "partial") ?? null;
  const state: State = created
    ? "success"
    : attempted && (over.length || missingReason.length)
      ? "validation_error"
      : partialDoc
        ? "partial"
        : "ready";

  return (
    <Frame
      title="السوق"
      nav={<AppNav currentId={p?.side === "supplier" ? "market-incoming" : "market-orders"} />}
      footer={null}
    >
      <div className="sys mp cus" data-screen="ORD-11" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              طلب مرتجع تجاري — موافقة ثم تنفيذ، ومستند مستقلّ لكل خطوة
            </h2>
            <span className="cat-head__hint">
              المرتجع ثلاث خطوات لا خطوة: طلب، موافقة مورد، ثم تنفيذ مادّي بمستند عكسي. لا خصم من
              الذمّة قبل التنفيذ، ولا تجاوز للمستلَم غير المُعاد.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && created ? (
              <Notice
                kind="success"
                title={`أُرسل طلب المرتجع ${created.ref_label}`}
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  بانتظار موافقة المورد. مرتجع قيد الموافقة — لم يُخصم بعد.
                </p>
                <p className="acc-choice__note">
                  <strong>لا خصم من الذمّة قبل التنفيذ</strong> · طلب المرتجع وحده لا يغيّر رصيداً.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" && (over[0] || missingReason[0]) ? (
              <Notice kind="warning" title="validation_error: يتجاوز القابل للإرجاع">
                <p className="acc-lead">
                  {over[0] ? (
                    <>
                      طُلب إرجاع <span className="sting-mono">{n(qty[over[0].offer_id])}</span>{" "}
                      والقابل للإرجاع <span className="sting-mono">{over[0].returnable}</span>
                      {over[0].returned_before ? (
                        <>
                          {" "}
                          — لأن <span className="sting-mono">{over[0].returned_before}</span> أُرجعت
                          في مرتجع سابق
                        </>
                      ) : null}
                      . المجموع لا يتجاوز المستلَم بأي حال، وحتى لو أُدخل الطلب من جهازين في وقت
                      واحد فالفحص على الخادم لا على الشاشة.
                    </>
                  ) : (
                    "كل سطر يُرجَع يحتاج سبباً مكتوباً."
                  )}
                </p>
              </Notice>
            ) : null}
            {state === "partial" && partialDoc ? (
              <Notice kind="info" title={`موافقة جزئية — ${partialDoc.ref_label}`}>
                <p className="acc-lead">
                  {partialDoc.lines
                    .map((l) => `${l.public_name}: ${l.approved_qty ?? 0} من ${l.qty}`)
                    .join(" · ")}
                  {partialDoc.decision_note ? ` — ${partialDoc.decision_note}` : ""}
                </p>
                <p className="acc-choice__note">
                  الموافقة الجزئية حالة معلَنة (partial). ما لم يوافَق عليه يبقى في مخزونك وذمّتك،
                  وبابه خلاف.
                </p>
              </Notice>
            ) : null}

            {p && !created ? (
              <>
                <div className="acc-actions">
                  <Status
                    state={pending ? "stale" : partialDoc ? "partial" : "synced"}
                    label={pending ? "بانتظار موافقة" : partialDoc ? "موافقة جزئية" : "مرتجع"}
                  />
                </div>
                <h3 className="cat-head__title">
                  مرتجع على الطلب <span className="sting-mono">{p.order.number_label}</span> —
                  الكميات القابلة للإرجاع
                </h3>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">مستلَم</th>
                      <th scope="col">أُرجع سابقاً</th>
                      <th scope="col">القابل للإرجاع</th>
                      <th scope="col">هذا الطلب</th>
                      <th scope="col">السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const q = n(qty[l.offer_id]);
                      const isOver = q > l.returnable;
                      return (
                        <tr key={l.offer_id} className={isOver ? "cus-item--expired" : undefined}>
                          <td>
                            <strong>{l.public_name}</strong>
                            <div className="mp-check__hint">{l.pack_label || l.unit_name}</div>
                          </td>
                          <td className="sting-mono">{l.received}</td>
                          <td className="sting-mono">{l.returned_before}</td>
                          <td className="sting-mono">{l.returnable}</td>
                          <td>
                            {p.side === "buyer" ? (
                              <TextField
                                label={`هذا الطلب — ${l.public_name}`}
                                kind="number"
                                mono
                                value={qty[l.offer_id] ?? "0"}
                                onChange={(e) =>
                                  setQty((c) => ({ ...c, [l.offer_id]: e.target.value }))
                                }
                                disabledReason={
                                  l.returnable === 0 ? "لا مستلَم غير مُعاد" : undefined
                                }
                                error={
                                  attempted && isOver
                                    ? `يتجاوز القابل للإرجاع — الأقصى ${l.returnable}. الفحص على الخادم لا على الشاشة.`
                                    : undefined
                                }
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            {p.side === "buyer" && q > 0 ? (
                              <TextField
                                label={`السبب — ${l.public_name}`}
                                value={reason[l.offer_id] ?? ""}
                                onChange={(e) =>
                                  setReason((c) => ({ ...c, [l.offer_id]: e.target.value }))
                                }
                                error={
                                  attempted && !(reason[l.offer_id] ?? "").trim()
                                    ? "السبب مطلوب"
                                    : undefined
                                }
                              />
                            ) : q === 0 && l.returnable > 0 ? (
                              "سليم — لا إرجاع"
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {p.side === "buyer" ? (
                  <div className="acc-actions">
                    <Button
                      pos
                      loading={busy === "request"}
                      onClick={() => void submit()}
                      disabledReason={
                        pending ? "مرتجع قيد الموافقة — انتظر قرار المورد" : undefined
                      }
                    >
                      أرسل طلب المرتجع {p.next_ref}
                    </Button>
                  </div>
                ) : null}

                {p.returns.length ? (
                  <>
                    <h3 className="cat-head__title">المرتجعات</h3>
                    <ul className="cus-list">
                      {p.returns.map((doc) => (
                        <li key={doc.id}>
                          <strong className="sting-mono">{doc.ref_label}</strong>
                          <div className="cus-sub">
                            {doc.lines
                              .map(
                                (l) =>
                                  `${l.public_name} ×${l.qty}${l.approved_qty != null ? ` (موافَق ${l.approved_qty})` : ""} — ${l.reason}`,
                              )
                              .join(" · ")}
                          </div>
                          <Status
                            state={
                              doc.status === "requested"
                                ? "stale"
                                : doc.status === "rejected"
                                  ? "expired"
                                  : doc.status === "partial"
                                    ? "partial"
                                    : "success"
                            }
                            label={doc.status_label}
                          />
                          {p.side === "supplier" && doc.status === "requested" ? (
                            <div className="acc-actions">
                              {doc.lines.map((l) => (
                                <TextField
                                  key={l.offer_id}
                                  label={`موافَق عليه — ${l.public_name} (من ${l.qty})`}
                                  kind="number"
                                  mono
                                  value={approved[`${doc.id}:${l.offer_id}`] ?? String(l.qty)}
                                  onChange={(e) =>
                                    setApproved((c) => ({
                                      ...c,
                                      [`${doc.id}:${l.offer_id}`]: e.target.value,
                                    }))
                                  }
                                />
                              ))}
                              <Button
                                pos
                                loading={busy === doc.id}
                                onClick={() => void decide(doc)}
                              >
                                سجّل قرارك
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                <h3 className="cat-head__title">الخطوات ومستنداتها</h3>
                <ul className="cus-list">
                  {p.steps.map((s, i) => (
                    <li key={s.title}>
                      <strong>{s.title}</strong>
                      <div className="cus-sub">{s.detail}</div>
                      <Status
                        state={
                          i === 0 && p.returns.length
                            ? "success"
                            : i === 1 && pending
                              ? "stale"
                              : i === 1 && partialDoc
                                ? "partial"
                                : "saved_local"
                        }
                        label={
                          i === 0 && p.returns.length
                            ? "تم"
                            : i === 1 && (pending || partialDoc)
                              ? "الآن"
                              : i === 2
                                ? "لاحقاً"
                                : i === 0
                                  ? "الآن"
                                  : "لاحقاً"
                        }
                      />
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">
                  <strong>لا خصم من الذمّة قبل التنفيذ</strong> · طلب المرتجع وحده لا يغيّر رصيداً.
                  الذمّة تتعدّل عند <strong>تنفيذ</strong> المرتجع بمستند عكسي موقَّع من الطرفين.
                  قبل ذلك تبقى القيمة قائمة، ويُعرض للتاجر «مرتجع قيد الموافقة — لم يُخصم بعد» بلا
                  إيهام.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
