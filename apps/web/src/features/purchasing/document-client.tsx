"use client";

import { Button, formatMinor, formatQty, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./purchasing.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "permission_denied" | "success";

export interface DocLine {
  id: string;
  item_name: string;
  unit_name: string;
  ordered_qty_milli: string;
  received_qty_milli: string;
  unit_price_minor: string;
  est_unit_price_minor: string;
  line_total_minor: string;
  excess_reason: string;
  returned_qty_milli: string;
  diff: "" | "qty" | "price";
}

interface Blocker {
  code: "invoice_number_required" | "excess_reason_required";
  line_id?: string;
  item_name?: string;
  received_qty_milli?: string;
  ordered_qty_milli?: string;
}

export interface Doc {
  id: string;
  number: string;
  order_id: string;
  order_number: string;
  supplier_name: string;
  branch_name: string;
  supplier_invoice_number: string;
  status: "draft" | "referred" | "approved";
  status_label: string;
  total_minor: string;
  order_estimated_minor: string;
  diff_count: number;
  due_days: number;
  lines: DocLine[];
  approved_by_name: string;
  approved_at: string;
  referred_to_name: string;
  effects: {
    stock?: { item_name: string; qty_milli: string; unit_name: string }[];
    cost?: { item_name: string; before_minor: string; after_minor: string; unit_name: string }[];
    branch_name?: string;
    payable_minor?: string;
  };
  blockers: Blocker[];
  approval: {
    viewer_name: string;
    limit_minor: string;
    over_limit: boolean;
    can_approve: boolean;
  };
}

/** كميات الشراء غالباً صحيحة (كراتين)؛ الكسور تُعرض بثلاث منازل حين تقع. */
export const qty = (milli: string): string =>
  formatQty(milli, BigInt(milli || "0") % 1000n === 0n ? 0 : 3);

/** «حدّك 3,000 وهذا 4,415» — الكسور تُعرض حين تقع، بلا تقريب. */
const wholeMinor = (minor: string): string =>
  BigInt(minor || "0") % 100n === 0n ? formatMinor(minor).replace(/\.00$/, "") : formatMinor(minor);

/** «+8 كراتين سكر و+6 أرز و+8 زيت في المخزن الرئيسي.» */
function stockSentence(fx: Doc["effects"]): string {
  const parts = (fx.stock ?? []).map(
    (s, i) => `+${qty(s.qty_milli)} ${i === 0 ? `${s.unit_name} ` : ""}${s.item_name}`,
  );
  return `${parts.join(" و")} في ${fx.branch_name ?? ""}.`;
}

export function DocumentClient({ documentId, orderId }: { documentId?: string; orderId?: string }) {
  const router = useRouter();
  const app = useApp();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [denied, setDenied] = useState(false);
  const [invoice, setInvoice] = useState("");
  const [edits, setEdits] = useState<
    Record<string, { qty?: string; price?: string; reason?: string }>
  >({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const applyDoc = useCallback((d: Doc) => {
    setDoc(d);
    setInvoice(d.supplier_invoice_number);
    setEdits({});
  }, []);

  useEffect(() => {
    const app = appRef.current;
    const here = orderId
      ? `/purchasing/orders/${orderId}/document`
      : `/purchasing/documents/${documentId ?? ""}`;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    void (async () => {
      const r = orderId
        ? await api().POST("/api/inventory/purchasing/orders/{order_id}/document", {
            params: { path: { order_id: orderId } },
          })
        : await api().GET("/api/inventory/purchasing/documents/{document_id}", {
            params: { path: { document_id: documentId ?? "" } },
          });
      if (r.response.status === 403) {
        setDenied(true);
        return;
      }
      const body = r.data as unknown as { document: Doc } | undefined;
      if (body) applyDoc(body.document);
    })().catch(() => undefined);
  }, [router, documentId, orderId, applyDoc]);

  const lineBody = () =>
    (doc?.lines ?? []).map((l) => {
      const e = edits[l.id] ?? {};
      return {
        id: l.id,
        received_qty_milli:
          e.qty !== undefined
            ? String(Math.round(Number(e.qty || "0") * 1000))
            : l.received_qty_milli,
        unit_price_minor:
          e.price !== undefined
            ? String(Math.round(Number(e.price || "0") * 100))
            : l.unit_price_minor,
        excess_reason: e.reason ?? l.excess_reason,
      };
    });

  const save = async (): Promise<Doc | null> => {
    if (!doc) return null;
    const { data, response } = await api().PATCH(
      "/api/inventory/purchasing/documents/{document_id}",
      {
        params: { path: { document_id: doc.id } },
        body: { supplier_invoice_number: invoice, lines: lineBody() } as never,
      },
    );
    const body = data as unknown as { document: Doc } | undefined;
    if (response.ok && body) {
      applyDoc(body.document);
      return body.document;
    }
    return null;
  };

  const approve = async () => {
    if (!doc || busy) return;
    setBusy(true);
    setAttempted(true);
    try {
      const saved = await save();
      if (!saved || saved.blockers.length || saved.approval.over_limit) return;
      const { data, response } = await api().POST(
        "/api/inventory/purchasing/documents/{document_id}/{action}",
        { params: { path: { document_id: doc.id, action: "approve" } }, body: {} as never },
      );
      const body = data as unknown as { document: Doc } | undefined;
      if (response.ok && body) applyDoc(body.document);
    } finally {
      setBusy(false);
    }
  };

  const refer = async () => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      await save();
      const { data, response } = await api().POST(
        "/api/inventory/purchasing/documents/{document_id}/{action}",
        { params: { path: { document_id: doc.id, action: "refer" } }, body: {} as never },
      );
      const body = data as unknown as { document: Doc } | undefined;
      if (response.ok && body) applyDoc(body.document);
    } finally {
      setBusy(false);
    }
  };

  const state: State = denied
    ? "permission_denied"
    : doc?.status === "approved"
      ? "success"
      : doc?.approval.over_limit
        ? "permission_denied"
        : attempted && doc && doc.blockers.length
          ? "validation_error"
          : "ready";

  const myName = doc?.approval.viewer_name || (app.session.displayName ?? "");
  const invoiceMissing = doc?.blockers.some((b) => b.code === "invoice_number_required");
  const excessOf = (lineId: string) =>
    doc?.blockers.find((b) => b.code === "excess_reason_required" && b.line_id === lineId);
  const lineNote = (l: DocLine) =>
    l.diff === "qty"
      ? `${qty(l.ordered_qty_milli)} ${l.unit_name}`
      : l.diff === "price"
        ? `سعر ${l.unit_name}`
        : "كما في الأمر";

  return (
    <Frame title="المشتريات" nav={<AppNav currentId="purchasing" />} footer={null}>
      <div className="sys pur" data-screen="PUR-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مستند الشراء واعتماده — الاعتماد توقيع على مبلغ</h2>
            <span className="cat-head__hint">
              هنا يتحرّك المخزون وتتحرّك الذمّة. المستند يُعرض كما سيُحفظ تماماً — بأرقامه وفروقه عن
              الأمر — والاعتماد فعلٌ باسمٍ ووقت لا ضغطةُ مرور.
            </span>
          </div>
          <div className="acc-card__body">
            {denied ? (
              <Notice kind="locked" title="الاعتماد للمالك والمحاسب">
                <p className="acc-lead">الاعتماد توقيع على مبلغ — أمين المخزن يستلم ولا يعتمد.</p>
              </Notice>
            ) : null}

            {doc ? (
              <div className="acc-choice">
                <div className="acc-choice__head">
                  <strong>
                    مستند شراء <span className="sting-mono">{doc.number}</span>
                  </strong>
                  <Status
                    state={
                      doc.status === "approved"
                        ? "success"
                        : doc.status === "referred"
                          ? "pending_sync"
                          : "ready"
                    }
                    label={doc.status_label}
                  />
                </div>
                <p className="acc-choice__note">
                  {doc.supplier_name} · {doc.branch_name}
                  {doc.order_number ? (
                    <>
                      {" · "}
                      {doc.diff_count ? "فروق عن الأمر" : "على الأمر"}{" "}
                      <span className="sting-mono">{doc.order_number}</span>
                    </>
                  ) : null}
                </p>
                {doc.diff_count && doc.status !== "approved" ? (
                  <p className="acc-lead">
                    الفروق تُعرض ولا تُخفى في تفصيل. من يعتمد يوقّع على{" "}
                    <span className="sting-mono">{formatMinor(doc.total_minor)}</span> لا على{" "}
                    <span className="sting-mono">{formatMinor(doc.order_estimated_minor)}</span> —
                    والرقمان متجاوران هنا لأن الفارق هو ما يُعتمد عليه.
                  </p>
                ) : null}
              </div>
            ) : null}

            {doc && state === "permission_denied" && !denied ? (
              <Notice
                kind="locked"
                title="الاعتماد فوق حدّ الصلاحية"
                action={
                  <Button
                    pos
                    onClick={() => void refer()}
                    loading={busy}
                    disabledReason={
                      doc.status === "referred" ? "أُحيل بالفعل — ينتظر توقيع المالك" : undefined
                    }
                  >
                    {doc.status === "referred"
                      ? `أُحيل إلى ${doc.referred_to_name}`
                      : `أحِل إلى ${doc.referred_to_name || "المالك"}`}
                  </Button>
                }
              >
                <p className="acc-lead">
                  <strong>نُظهر الرقمين</strong> · حدّك{" "}
                  <span className="sting-mono">{wholeMinor(doc.approval.limit_minor)}</span> وهذا{" "}
                  <span className="sting-mono">{wholeMinor(doc.total_minor)}</span>. الرسالة التي
                  تقول «لا تملك صلاحية» بلا رقم تجعله يحاول مرة أخرى.
                </p>
                <p className="acc-lead">
                  <strong>الإحالة</strong> · «أحِل إلى {doc.referred_to_name || "المالك"}» ترسل
                  المستند كما هو، وتُبقيه مسوّدة لا معتمداً — والاعتماد يُنسب لمن وقّع.
                </p>
                <p className="acc-choice__note">
                  ما أدخله المحاسب من أرقام يبقى؛ الإحالة لا تعيد العمل من الصفر.
                </p>
              </Notice>
            ) : null}

            {doc && state === "validation_error" ? (
              <Notice kind="error" title="مستند بلا رقم فاتورة المورد">
                <p className="acc-lead">
                  الاستلام مكتمل والاعتماد ممنوع: رقم فاتورة المورد فارغ، وصنفٌ استُلم بكمية تفوق
                  الأمر بلا سبب مكتوب.
                </p>
                {invoiceMissing ? (
                  <p className="acc-lead">
                    <strong>رقم الفاتورة</strong> · هو ما يُطابَق به الدفتران عند المراجعة. بدونه
                    يصير المستند داخلياً لا يُحاجَج به المورد.
                  </p>
                ) : null}
                {doc.blockers
                  .filter((b) => b.code === "excess_reason_required")
                  .map((b) => (
                    <p className="acc-lead" key={b.line_id}>
                      <strong>الزيادة</strong> · استلام{" "}
                      <span className="sting-mono">{qty(b.received_qty_milli ?? "0")}</span> مقابل{" "}
                      <span className="sting-mono">{qty(b.ordered_qty_milli ?? "0")}</span> مطلوبة
                      يحتاج سطراً: هديّة، أم خطأ المورد، أم تعديل متّفق عليه هاتفياً.
                    </p>
                  ))}
                <p className="acc-choice__note">
                  الاعتماد معطّل والحفظ كمسوّدة متاح — العمل لا يضيع لأن ورقةً ناقصة.
                </p>
              </Notice>
            ) : null}

            {doc && state === "success" ? (
              <Notice
                kind="success"
                title={
                  <>
                    اعتُمد المستند <span className="sting-mono">{doc.number}</span>
                  </>
                }
                action={
                  <Button pos onClick={() => router.push(`/purchasing/documents/${doc.id}/return`)}>
                    أنشئ مرتجعاً
                  </Button>
                }
              >
                <p className="acc-lead">
                  تحرّك المخزون وتحرّكت الذمّة الآن. ثلاثة آثار تُعلَن صراحةً لا تُترك ليكتشفها
                  المستخدم.
                </p>
                <p className="acc-lead">
                  <strong>المخزون</strong> · {stockSentence(doc.effects)}
                </p>
                {(doc.effects.cost ?? [])
                  .filter((c) => c.before_minor !== c.after_minor && c.before_minor !== "0")
                  .map((c) => (
                    <p className="acc-lead" key={c.item_name}>
                      <strong>التكلفة</strong> · متوسط تكلفة {c.item_name}{" "}
                      {BigInt(c.after_minor) > BigInt(c.before_minor) ? "ارتفع" : "انخفض"} من{" "}
                      <span className="sting-mono">{formatMinor(c.before_minor)}</span> إلى{" "}
                      <span className="sting-mono">{formatMinor(c.after_minor)}</span> — والهامش
                      تبعه في «التكلفة والهامش».
                    </p>
                  ))}
                <p className="acc-lead">
                  <strong>الذمّة</strong> ·{" "}
                  <span className="sting-mono">
                    {formatMinor(doc.effects.payable_minor ?? doc.total_minor)}
                  </span>{" "}
                  على المنشأة ل{doc.supplier_name}، تستحق بعد{" "}
                  <span className="sting-mono">{doc.due_days}</span> يوماً.
                </p>
                <p className="acc-choice__note">
                  اعتمده {doc.approved_by_name}. المسارات: سجّل دفعة، أنشئ مرتجعاً، اطبع المستند.
                  الاعتماد لا يُلغى — يُعكس بمستند مضادّ.
                </p>
              </Notice>
            ) : null}

            {doc ? (
              <>
                {doc.status !== "approved" ? (
                  <TextField
                    label="رقم فاتورة المورد"
                    mono
                    value={invoice}
                    onChange={(e) => setInvoice(e.target.value)}
                    error={
                      attempted && invoiceMissing && !invoice.trim()
                        ? "رقم الفاتورة مطلوب للاعتماد — هو ما يُطابَق به الدفتران عند المراجعة."
                        : undefined
                    }
                  />
                ) : (
                  <p className="acc-choice__note">
                    فاتورة المورد <span className="sting-mono">{doc.supplier_invoice_number}</span>
                  </p>
                )}
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">استُلم</th>
                      <th scope="col">سعر الوحدة</th>
                      <th scope="col">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l) => {
                      const e = edits[l.id] ?? {};
                      const ex = excessOf(l.id);
                      return (
                        <tr key={l.id} className={ex && attempted ? "pur-line--error" : undefined}>
                          <td>
                            <strong>{l.item_name}</strong> — {lineNote(l)}
                          </td>
                          <td>
                            {doc.status === "approved" ? (
                              <>
                                <span className="sting-mono">{qty(l.received_qty_milli)}</span>{" "}
                                {l.unit_name}
                              </>
                            ) : (
                              <>
                                <TextField
                                  label={`الكمية المستلمة — ${l.item_name}`}
                                  mono
                                  value={e.qty ?? qty(l.received_qty_milli).replace(/,/g, "")}
                                  onChange={(ev) =>
                                    setEdits((p) => ({
                                      ...p,
                                      [l.id]: { ...p[l.id], qty: ev.target.value },
                                    }))
                                  }
                                  hint={`${l.unit_name} · المطلوب ${qty(l.ordered_qty_milli)}`}
                                />
                                {l.diff === "qty" || ex ? (
                                  <TextField
                                    label={`سبب الزيادة — ${l.item_name}`}
                                    value={e.reason ?? l.excess_reason}
                                    onChange={(ev) =>
                                      setEdits((p) => ({
                                        ...p,
                                        [l.id]: { ...p[l.id], reason: ev.target.value },
                                      }))
                                    }
                                    error={
                                      attempted && ex && !(e.reason ?? l.excess_reason).trim()
                                        ? "الزيادة عن الأمر تحتاج سبباً مكتوباً: هديّة، أم خطأ المورد، أم تعديل متّفق عليه."
                                        : undefined
                                    }
                                  />
                                ) : null}
                              </>
                            )}
                          </td>
                          <td>
                            {doc.status === "approved" ? (
                              <span className="sting-mono">{formatMinor(l.unit_price_minor)}</span>
                            ) : (
                              <TextField
                                label={`سعر ${l.unit_name} — ${l.item_name}`}
                                mono
                                value={e.price ?? formatMinor(l.unit_price_minor).replace(/,/g, "")}
                                onChange={(ev) =>
                                  setEdits((p) => ({
                                    ...p,
                                    [l.id]: { ...p[l.id], price: ev.target.value },
                                  }))
                                }
                                hint={
                                  l.est_unit_price_minor
                                    ? `في الأمر ${formatMinor(l.est_unit_price_minor)}`
                                    : undefined
                                }
                              />
                            )}
                          </td>
                          <td>
                            <span className="sting-mono">{formatMinor(l.line_total_minor)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="acc-choice__head">
                  <strong>الإجمالي للاعتماد</strong>
                  <span className="sting-mono home-kpi__value">{formatMinor(doc.total_minor)}</span>
                </div>
                {doc.status !== "approved" ? (
                  <div className="acc-actions">
                    {state !== "permission_denied" ? (
                      <Button pos onClick={() => void approve()} loading={busy}>
                        اعتمد باسم {myName}
                      </Button>
                    ) : null}
                    <Button onClick={() => void save()} loading={busy}>
                      احفظ كمسوّدة
                    </Button>
                    {doc.order_id ? (
                      <Button onClick={() => router.push("/purchasing/orders")}>رجوع</Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
