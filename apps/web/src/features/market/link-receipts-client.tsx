"use client";

import { Button, formatMinor, Frame, Notice, Status } from "@sting/ui-web";
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
import { PhaseScreenClient } from "@/features/phase/phase-screen-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "conflict" | "success";

interface ShipmentRow {
  shipment_id: string;
  ref_label: string;
  order_id: string;
  order_label: string;
  supplier_name: string;
  received_at: string;
  received_by_name: string;
  converted: boolean;
  local_number: string;
  mode: string;
}
interface PreviewLine {
  offer_id: string;
  offer_name: string;
  supplier_unit: string;
  received: number;
  shipped: number;
  price_minor: number;
  item_name: string;
  unit_name: string;
  factor_milli: number;
  my_qty_milli: number;
  value_minor: number;
}
interface Duplicate {
  receipt_id: string;
  receipt_number: string;
  occurred_at: string;
  user_name: string;
  lines: { item_name: string; qty_milli: string; unit_code: string }[];
}
interface Preview {
  shipment: ShipmentRow;
  party_linked: boolean;
  party_name: string;
  branch_id: string;
  branch_name: string;
  lines: PreviewLine[];
  unmapped: { offer_id: string; name: string; unit_name: string; qty: number }[];
  payable_minor: string;
  state: "ready" | "unmapped" | "duplicate" | "converted";
  duplicates: Duplicate[];
  link: { local_number: string; mode: string } | null;
}
interface Payload {
  state: "ready" | "phase_locked";
  can_convert: boolean;
  shipments: ShipmentRow[];
  pending_count: number;
}

const itemsWord = (n: number) =>
  n === 1
    ? "صنف واحد"
    : n === 2
      ? "صنفان"
      : n === 3
        ? "ثلاثة أصناف"
        : n <= 10
          ? `${n} أصناف`
          : `${n} صنفاً`;
const qty = (milli: number | string) => {
  const n = Number(milli) / 1000;
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "");
};
const dm = (iso: string) => {
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};

/** LINK-03 — تحويل استلام إلى مستند (29-D22 ready/conflict · 38-D30 validation_error/success): معاينة الأثر ومصدر واحد لا تكرار (ACC-130). */
export function LinkReceiptsClient() {
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("shipment") ?? "";
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; extra: Record<string, unknown> } | null>(null);
  const [done, setDone] = useState<{ local_number: string; mode: string } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/link/receipts");
    const b = data as unknown as Payload | undefined;
    if (response.ok && b) setData(b);
  }, []);

  const refreshPreview = useCallback(async (shipmentId: string) => {
    const { data, response } = await api().GET("/api/market/link/receipts/{shipment_id}/{action}", {
      params: { path: { shipment_id: shipmentId, action: "preview" } },
    });
    const b = data as unknown as Preview | undefined;
    if (response.ok && b) setPv(b);
  }, []);

  const open = useCallback(async (shipmentId: string) => {
    setErr(null);
    setDone(null);
    const { data, response } = await api().GET("/api/market/link/receipts/{shipment_id}/{action}", {
      params: { path: { shipment_id: shipmentId, action: "preview" } },
    });
    const b = data as unknown as Preview | undefined;
    if (response.ok && b) setPv(b);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(
        `/login?next=${encodeURIComponent(`/market/link/receipts${wanted ? `?shipment=${wanted}` : ""}`)}`,
      );
      return;
    }
    void (async () => {
      await load();
      if (wanted) await open(wanted);
    })().catch(() => undefined);
  }, [router, load, open, wanted]);

  const convert = async (body: Record<string, unknown> = {}) => {
    if (busy || !pv) return;
    setBusy("convert");
    setErr(null);
    try {
      const r = await api().POST("/api/market/link/receipts/{shipment_id}/{action}", {
        params: { path: { shipment_id: pv.shipment.shipment_id, action: "convert" } },
        body: body as never,
      });
      const b = (r.data ?? r.error) as unknown as
        | {
            link?: { local_number: string; mode: string };
            detail?: string;
            extra?: Record<string, unknown>;
          }
        | undefined;
      if (r.response.ok && b?.link) {
        setDone(b.link);
        await load();
        await refreshPreview(pv.shipment.shipment_id);
        return;
      }
      setErr({ code: b?.detail ?? "server_error", extra: b?.extra ?? {} });
    } finally {
      setBusy("");
    }
  };

  if (data && data.state === "phase_locked") return <PhaseScreenClient id="LINK-03" />;

  const state: State = done
    ? "success"
    : err?.code === "unmapped_items" || pv?.state === "unmapped"
      ? "validation_error"
      : err?.code === "duplicate_receipt" || pv?.state === "duplicate"
        ? "conflict"
        : "ready";
  const dup = pv?.duplicates[0] ?? null;

  return (
    <Frame title="الربط" nav={<AppNav currentId="inventory" />} footer={null}>
      <div className="sys mp cus" data-screen="LINK-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              تحويل استلام إلى مستند — معاينة الأثر ومصدر واحد لا تكرار
            </h2>
            <span className="cat-head__hint">
              شحنة وصلت عبر طلب سوق تصبح مستند استلام في دفترك. الخطر: أن تُسجّلها يدوياً أيضاً
              فيصير المخزون ضعف الحقيقة. لذلك المصدر واحد ومعلَن.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "validation_error" && pv ? (
              <Notice
                kind="warning"
                title="صنف بلا مطابقة"
                action={
                  <Button onClick={() => router.push("/market/link/items")}>
                    طابق الأصناف (LINK-02)
                  </Button>
                }
              >
                <p className="acc-lead">
                  الاستلام فيه صنف لم يُطابَق بعد، فلا يُعرف أيّ مخزون يدخل.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نُنشئ تلقائياً</strong> · إنشاء صنف من اسم المورد يملأ كتالوجك بأسماء
                  غيرك. نطلب المطابقة أو الإنشاء الصريح.
                </p>
                <ul className="cus-list">
                  {(pv.unmapped.length
                    ? pv.unmapped
                    : ((err?.extra.unmapped as Preview["unmapped"] | undefined) ?? [])
                  ).map((u) => (
                    <li key={u.offer_id}>
                      <strong>{u.name}</strong>
                      <div className="cus-sub">
                        <span className="sting-mono">{u.qty}</span> {u.unit_name} — بلا مطابقة
                      </div>
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {state === "conflict" && pv && dup ? (
              <Notice kind="warning" title="هذه الشحنة سُجِّلت يدوياً بالفعل">
                <p className="acc-lead">
                  <strong>وجدنا مستند استلام</strong>{" "}
                  <span className="sting-mono">{dup.receipt_number}</span> بنفس الكميات وتاريخ قريب.
                  نوقف التحويل ونعرض المستندين جنباً إلى جنب: إمّا تربط هذا بذاك فيبقى مستند واحد،
                  أو تؤكّد أنهما شحنتان مختلفتان. لا نُضيف ولا نحذف تلقائياً — الرقم المزدوج في
                  المخزون لا يظهر إلا في الجرد بعد شهر.
                </p>
                <dl className="mp-preview">
                  <dt>شحنة السوق {pv.shipment.ref_label}</dt>
                  <dd>
                    {pv.lines.map((l) => (
                      <div key={l.offer_id}>
                        {l.item_name} · <span className="sting-mono">{qty(l.my_qty_milli)}</span>{" "}
                        {l.unit_name}
                      </div>
                    ))}
                    <div className="mp-reason">
                      استلمها {pv.shipment.received_by_name} · {dm(pv.shipment.received_at)}
                    </div>
                  </dd>
                  <dt>مستند الاستلام اليدوي {dup.receipt_number}</dt>
                  <dd>
                    {dup.lines.map((l, i) => (
                      <div key={i}>
                        {l.item_name} · <span className="sting-mono">{qty(l.qty_milli)}</span>{" "}
                        {l.unit_code}
                      </div>
                    ))}
                    <div className="mp-reason">
                      سجّله {dup.user_name} · {dm(dup.occurred_at)}
                    </div>
                  </dd>
                </dl>
                <div className="acc-actions">
                  <Button
                    pos
                    loading={busy === "convert"}
                    onClick={() => void convert({ attach_receipt_id: dup.receipt_id })}
                  >
                    اربط الشحنة بـ{dup.receipt_number} — مستند واحد
                  </Button>
                  <Button
                    loading={busy === "convert"}
                    onClick={() => void convert({ distinct_receipt_ids: [dup.receipt_id] })}
                  >
                    شحنتان مختلفتان — حوّل مستنداً جديداً
                  </Button>
                </div>
              </Notice>
            ) : null}
            {state === "success" && done ? (
              <Notice
                kind="success"
                title={
                  done.mode === "attached"
                    ? "رُبطت الشحنة بمستند قائم — مستند واحد"
                    : "أُنشئ المستند"
                }
                action={
                  <Button
                    onClick={() => {
                      setDone(null);
                      setPv(null);
                    }}
                  >
                    التالي
                  </Button>
                }
              >
                <p className="acc-lead">
                  {done.mode === "attached"
                    ? "لا مستند ثانٍ: الشحنة تشير إلى مستند الاستلام اليدوي كمصدرها."
                    : "مستند شراء في دفترك مرتبطٌ بطلب السوق. الأثر مُعلن: المخزون والذمّة والتكلفة."}
                </p>
                <p className="acc-choice__note">
                  <strong>لا أثر مزدوج</strong> · المستند يُنشأ مرة واحدة ولو أُعيد التحويل
                  (ACC-130) — والرابط بينهما هو الحارس.
                </p>
                <p className="acc-choice__note">
                  <span className="sting-mono">{done.local_number}</span>
                </p>
              </Notice>
            ) : null}
            {err && !["unmapped_items", "duplicate_receipt"].includes(err.code) ? (
              <Notice kind="warning" title="لم يُحوَّل">
                <p className="acc-lead">
                  {err.code === "party_not_linked"
                    ? "اربط الطرف أولاً (LINK-01)."
                    : err.code === "permission_denied"
                      ? "التحويل للمالك ومدير الفرع — التزام مالي."
                      : err.code}
                </p>
              </Notice>
            ) : null}

            {data && !pv ? (
              <>
                <h3 className="cat-head__title">
                  شحنات مستلَمة بانتظار التحويل —{" "}
                  <span className="sting-mono">{data.pending_count}</span>
                </h3>
                {data.shipments.length === 0 ? (
                  <p className="acc-choice__note">لا شحنات مستلَمة من منشآت مربوطة بعد.</p>
                ) : null}
                <ul className="cus-list">
                  {data.shipments.map((s) => (
                    <li key={s.shipment_id}>
                      <Button variant="quiet" onClick={() => void open(s.shipment_id)}>
                        {s.ref_label} من {s.order_label} · {s.supplier_name}
                      </Button>
                      <div className="cus-sub">استُلمت {dm(s.received_at)}</div>
                      {s.converted ? (
                        <Status state="success" label={`حُوِّلت — ${s.local_number}`} />
                      ) : (
                        <Status state="stale" label="بانتظار التحويل" />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {pv ? (
              <>
                <h3 className="cat-head__title">معاينة الأثر قبل التحويل</h3>
                <p className="acc-choice__note">
                  شحنة <span className="sting-mono">{pv.shipment.ref_label}</span> من الطلب{" "}
                  <span className="sting-mono">{pv.shipment.order_label}</span> ·{" "}
                  {pv.shipment.supplier_name}
                  {pv.party_linked
                    ? ` · الطرف في دفترك: ${pv.party_name}`
                    : " · الطرف غير مربوط (LINK-01)"}
                </p>
                <dl className="mp-preview">
                  <dt>مستند استلام جديد في دفترك</dt>
                  <dd>
                    {pv.link ? <span className="sting-mono">{pv.link.local_number}</span> : "PD-…"}
                    <div className="mp-reason">
                      يشير إلى شحنة السوق {pv.shipment.ref_label} كمصدر — مصدر واحد معلَن
                    </div>
                  </dd>
                  <dt>المخزون — {pv.branch_name}</dt>
                  <dd>
                    {pv.lines.map((l) => (
                      <div key={l.offer_id}>
                        {l.item_name} · <span className="sting-mono">{qty(l.my_qty_milli)}</span>{" "}
                        {l.unit_name} (<span className="sting-mono">{l.received}</span>{" "}
                        {l.supplier_unit} ×{" "}
                        <span className="sting-mono">{qty(l.factor_milli)}</span>)
                      </div>
                    ))}
                    <div className="mp-reason">
                      {itemsWord(pv.lines.length)} بوحداتك بعد التحويل المؤكَّد
                    </div>
                  </dd>
                  <dt>ذمّة المورد</dt>
                  <dd>
                    <span className="sting-mono">{formatMinor(pv.payable_minor)}</span>
                    <div className="mp-reason">
                      تُسجَّل كما في الطلب المؤكَّد، لا كما في أي سعر حالي
                    </div>
                  </dd>
                  <dt>ما لا يحدث</dt>
                  <dd>
                    <strong>لا سداد</strong>
                    <div className="mp-reason">التحويل يسجّل الالتزام ولا يدفع شيئاً</div>
                  </dd>
                </dl>
                <p className="acc-choice__note">
                  لا شيء من هذا يحدث قبل ضغطك. المعاينة هي العقد: تقرأ الأثر كاملاً ثم تُقرّه.
                </p>
                <div className="acc-actions">
                  {pv.state === "ready" && data?.can_convert ? (
                    <Button pos loading={busy === "convert"} onClick={() => void convert()}>
                      أقرّ الأثر وحوّل إلى مستند
                    </Button>
                  ) : null}
                  {pv.state === "converted" ? (
                    <Status state="success" label={`حُوِّلت — ${pv.link?.local_number ?? ""}`} />
                  ) : null}
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setPv(null);
                      setErr(null);
                      setDone(null);
                    }}
                  >
                    رجوع
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
