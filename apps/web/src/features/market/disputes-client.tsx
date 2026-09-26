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
import { dayMonth, hhmm } from "@/features/home/format";
import type { OrderRow } from "@/features/market/orders-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "empty" | "partial" | "permission_denied" | "success";

interface DLine {
  offer_id: string;
  public_name: string;
  unit_name: string;
  shipped: number;
  received: number;
  rejected: number;
  gap: number;
  reason: string;
  price_minor: string;
  buyer_value_minor: string;
  supplier_value_minor: string;
  gap_value_minor: string;
}

interface Evidence {
  side: "buyer" | "supplier";
  title: string;
  note?: string;
  at: string;
  kind: string;
  by?: string;
}

export interface Dispute {
  id: string;
  number: number;
  ref_label: string;
  title: string;
  shipment_ref: string;
  status: "open" | "closed";
  status_label: string;
  turn: "buyer" | "supplier";
  turn_label: string;
  turn_deadline: string;
  days_open: number;
  lines: DLine[];
  evidence: Evidence[];
  outcome: string;
  outcome_label: string;
  outcome_ref: string;
  mediator_requested_at: string;
  opened_at: string;
  closed_at: string;
  buyer_name: string;
  supplier_name: string;
  order_number_label: string;
  order_id: string;
}

interface Payload {
  order: OrderRow;
  side: "buyer" | "supplier";
  disputes: Dispute[];
  can_settle: boolean;
  turn_hours: number;
  dispute?: Dispute;
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
const daysWord = (n: number) =>
  n === 0 ? "اليوم" : n === 1 ? "يوم" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوماً`;
const unitsWord = (n: number, unit: string) =>
  n === 1
    ? `${unit} واحدة`
    : n === 2
      ? `${unit.replace(/ة$/, "ت")}ان`
      : n <= 10
        ? `${n} ${unit === "كرتونة" ? "كراتين" : unit}`
        : `${n} ${unit}`;

/** ORD-12 — خلاف وأدلته وتطور حالته (10-D6 partial · 41-D33 ready/empty/permission_denied/success): دفتران مستقلان وموظف مسؤول. */
export function DisputesClient({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("d") ?? "";
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [evTitle, setEvTitle] = useState("");
  const [evNote, setEvNote] = useState("");
  const [closeRef, setCloseRef] = useState("");
  const [closeOutcome, setCloseOutcome] = useState<"return" | "credit" | "accept">("credit");
  const [busy, setBusy] = useState("");
  const [denied, setDenied] = useState(false);
  const [closed, setClosed] = useState<Dispute | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}/disputes", {
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
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/disputes`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const act = async (
    d: Dispute,
    action: "evidence" | "accept-supplier" | "close" | "mediator",
    body: Record<string, unknown> = {},
  ) => {
    if (busy) return;
    setBusy(action);
    setDenied(false);
    try {
      const r = await api().POST("/api/market/orders/{order_id}/disputes/{dispute_id}/{action}", {
        params: { path: { order_id: id, dispute_id: d.id, action } },
        body: body as never,
      });
      const b = r.data as unknown as Payload | undefined;
      if (r.response.status === 403) {
        setDenied(true);
        return;
      }
      if (r.response.ok && b) {
        setP(b);
        if (b.dispute?.status === "closed") setClosed(b.dispute);
        if (action === "evidence") {
          setEvTitle("");
          setEvNote("");
        }
      }
    } finally {
      setBusy("");
    }
  };

  const open = (p?.disputes ?? []).filter((d) => d.status === "open");
  const current = (p?.disputes ?? []).find((d) => d.id === wanted) ?? open[0] ?? null;
  const state: State = closed
    ? "success"
    : denied
      ? "permission_denied"
      : p && p.disputes.length === 0
        ? "empty"
        : current && current.status === "open"
          ? "partial"
          : "ready";

  return (
    <Frame
      title="السوق"
      nav={<AppNav currentId={p?.side === "supplier" ? "market-incoming" : "market-orders"} />}
      footer={null}
    >
      <div className="sys mp cus" data-screen="ORD-12" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الخلاف — دفتران مستقلان وموظف مسؤول</h2>
            <span className="cat-head__hint">
              إغلاق تذكرة الدعم لا يسوّي دفتراً. ما يُغلق هو التذكرة، وما يسوّي هو إجراء مخوَّل من
              الطرف نفسه.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && closed ? (
              <Notice
                kind="success"
                title="أُغلق الخلاف"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  بالنتيجة المتفَق عليها ومرجعها: مرتجعٌ أو خصمٌ أو قبولٌ بالحالة.{" "}
                  {closed.ref_label} — {closed.outcome_label}
                  {closed.outcome_ref ? ` · ${closed.outcome_ref}` : ""}.
                </p>
                <p className="acc-choice__note">
                  <strong>الإغلاق لا يُحرّك دفتراً</strong> · ما يُسوّى يُسوّى بمستند مستقل يُرى في
                  كشف الطرف. إغلاقُ تذكرةٍ ليس قيداً.
                </p>
              </Notice>
            ) : null}
            {state === "permission_denied" ? (
              <Notice kind="warning" title="مسؤول الاستلام يرفع الدليل ولا يسوّي">
                <p className="acc-lead">يصوّر التالف ويكتب الواقعة، ولا يقبل تسويةً مالية.</p>
                <p className="acc-choice__note">
                  <strong>حدّ الدور</strong> · التسوية إقرارٌ مالي يخضع لحدّ الدور في «الأدوار
                  والصلاحيات». والشهادة على ما رآه ليست تنازلاً عن مال.
                </p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا خلافات">
                <p className="acc-lead">حالةٌ سويّة بل مرغوبة.</p>
                <p className="acc-choice__note">
                  <strong>لا لوحة مؤشرات</strong> · عددُ خلافاتٍ تاريخي لا يفيد المشتري. الفراغ يبقى
                  فراغاً.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                </div>
              </Notice>
            ) : null}
            {state === "ready" && p && p.disputes.length ? (
              <Notice kind="info" title="الخلاف ومن عليه الدور">
                <p className="acc-lead">
                  الخط الزمني وأدلة الطرفين وآخر إجراء ومهلة الرد — ومن عليه الدور معلَنٌ في
                  الترويسة.
                </p>
                <p className="acc-choice__note">
                  <strong>الدور مسمّى</strong> · خلافٌ بلا صاحب دورٍ يبقى مفتوحاً شهراً. الشاشة تقول
                  «بانتظارك» أو «بانتظار المورد» ومتى تنتهي المهلة.
                </p>
              </Notice>
            ) : null}

            {p && p.disputes.length && !closed ? (
              <ul className="cus-list">
                {p.disputes.map((d) => (
                  <li key={d.id}>
                    <Button
                      variant="quiet"
                      onClick={() => router.push(`/market/orders/${id}/disputes?d=${d.id}`)}
                    >
                      <span className="sting-mono">{d.ref_label}</span> — {d.title}
                    </Button>
                    <Status
                      state={d.status === "open" ? "conflict" : "success"}
                      label={
                        d.status === "open"
                          ? d.turn_label
                          : `${d.status_label} · ${d.outcome_label}`
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            {current && !closed && current.status === "open" && p ? (
              <>
                <div className="acc-actions">
                  <Status state="partial" label="جزئي" />
                  <Status state="conflict" label="خلاف" />
                </div>
                <h3 className="cat-head__title">
                  <span className="sting-mono">{current.ref_label}</span> — {current.title}
                </h3>
                <p className="acc-choice__note">
                  على الشحنة <span className="sting-mono">{current.shipment_ref}</span> · مفتوح{" "}
                  {daysWord(current.days_open)} · مسؤول من كل طرف
                </p>
                <div className="acc-actions">
                  <Status state="stale" label={current.turn_label} />
                  {current.turn_deadline ? (
                    <span className="acc-choice__note">
                      المهلة حتى <When iso={current.turn_deadline} />
                    </span>
                  ) : null}
                </div>
                <div className="pub-cols">
                  <div>
                    <strong>
                      دفترك — {p.side === "buyer" ? current.buyer_name : current.supplier_name}
                    </strong>
                    {current.lines.map((l) => (
                      <dl className="mp-preview" key={l.offer_id}>
                        <dt>{p.side === "buyer" ? "المستلم من الشحنة" : "المشحون من الشحنة"}</dt>
                        <dd>
                          {unitsWord(
                            p.side === "buyer" ? l.received : l.shipped,
                            l.unit_name || "وحدة",
                          )}
                        </dd>
                        <dt>{p.side === "buyer" ? "الذمة المسجَّلة" : "المطالبة المسجَّلة"}</dt>
                        <dd className="sting-mono">
                          {formatMinor(
                            p.side === "buyer" ? l.buyer_value_minor : l.supplier_value_minor,
                          )}
                        </dd>
                        <dt>إدخال المخزون</dt>
                        <dd>
                          {p.side === "buyer"
                            ? "بعدّك عند الاستلام — لا حركة حتى «تحويل الاستلام»"
                            : "—"}
                        </dd>
                      </dl>
                    ))}
                  </div>
                  <div>
                    <strong>
                      {p.side === "buyer"
                        ? "دفتر المورد — كما يعرضه هو"
                        : "دفتر المشتري — كما يعرضه هو"}
                    </strong>
                    {current.lines.map((l) => (
                      <dl className="mp-preview" key={l.offer_id}>
                        <dt>{p.side === "buyer" ? "المشحون من الشحنة" : "المستلم من الشحنة"}</dt>
                        <dd>
                          {unitsWord(
                            p.side === "buyer" ? l.shipped : l.received,
                            l.unit_name || "وحدة",
                          )}
                        </dd>
                        <dt>{p.side === "buyer" ? "المطالبة المسجَّلة" : "الذمة المسجَّلة"}</dt>
                        <dd className="sting-mono">
                          {formatMinor(
                            p.side === "buyer" ? l.supplier_value_minor : l.buyer_value_minor,
                          )}
                        </dd>
                        <dt>الفارق المتنازع</dt>
                        <dd>
                          {unitsWord(l.gap, l.unit_name || "وحدة")} ·{" "}
                          <span className="sting-mono">{formatMinor(l.gap_value_minor)}</span>
                        </dd>
                      </dl>
                    ))}
                    <p className="acc-choice__note">
                      نعرض رقمه كما هو ولا نعدّله ولا نضعه في دفترك. الاختلاف حقيقة قائمة لا خطأ
                      يُصحّح تلقائياً.
                    </p>
                  </div>
                </div>

                <h3 className="cat-head__title">الأدلة وآخر إجراء</h3>
                <div className="pub-cols">
                  {(["buyer", "supplier"] as const).map((side) => (
                    <div key={side}>
                      <strong>
                        {side === p.side ? "أنت" : side === "supplier" ? "المورد" : "المشتري"}
                      </strong>
                      <ul className="cus-list">
                        {current.evidence
                          .filter((e) => e.side === side)
                          .map((e, i) => (
                            <li key={`${side}-${i}`}>
                              <strong>{e.title}</strong>
                              <div className="cus-sub">
                                <When iso={e.at} />
                                {e.note ? ` · ${e.note}` : ""}
                              </div>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="acc-choice__note">
                  <strong>لا تسوية تلقائية</strong> · حين يتفق الطرفان، يسجّل كل طرف إجراءه في دفتره
                  بصلاحيته: أنت تقبل الكرتونة كمستلمة، أو هو يصدر إشعاراً دائناً. لا زر «حلّ الخلاف»
                  يكتب في الدفترين معاً — من يملك الدفتر يملك القيد.
                </p>

                <TextField
                  label="عنوان الدليل أو التعليق"
                  value={evTitle}
                  onChange={(e) => setEvTitle(e.target.value)}
                />
                <TextField
                  label="الواقعة (اختياري)"
                  value={evNote}
                  onChange={(e) => setEvNote(e.target.value)}
                />
                <div className="acc-actions">
                  <Button
                    loading={busy === "evidence"}
                    onClick={() => void act(current, "evidence", { title: evTitle, note: evNote })}
                    disabledReason={evTitle.trim() ? undefined : "اكتب عنواناً للدليل"}
                  >
                    إضافة دليل أو تعليق
                  </Button>
                  {p.side === "buyer" ? (
                    <Button
                      pos
                      loading={busy === "accept-supplier"}
                      onClick={() => void act(current, "accept-supplier")}
                    >
                      قبول رقم المورد وتعديل دفتري
                    </Button>
                  ) : null}
                  <Button
                    loading={busy === "mediator"}
                    onClick={() => void act(current, "mediator")}
                    disabledReason={
                      current.mediator_requested_at ? "طُلب الوسيط من قبل" : undefined
                    }
                  >
                    طلب وسيط من فيزانو بلص
                  </Button>
                </div>
                <h3 className="cat-head__title">الإغلاق بالنتيجة المتفَق عليها</h3>
                <div className="pos-chips" role="group" aria-label="النتيجة">
                  {(
                    [
                      ["return", "مرتجع"],
                      ["credit", "خصم/إشعار دائن"],
                      ["accept", "قبول بالحالة"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`pos-chip${closeOutcome === k ? " pos-chip--on" : ""}`}
                      onClick={() => setCloseOutcome(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <TextField
                  label="مرجع المستند المستقل (مرتجع/إشعار دائن/إقرار)"
                  value={closeRef}
                  onChange={(e) => setCloseRef(e.target.value)}
                />
                <div className="acc-actions">
                  <Button
                    loading={busy === "close"}
                    onClick={() =>
                      void act(current, "close", { outcome: closeOutcome, ref: closeRef })
                    }
                    disabledReason={
                      closeRef.trim() ? undefined : "الإغلاق يحتاج مرجع المستند المستقل"
                    }
                  >
                    أغلق الخلاف بمرجعه
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
