"use client";

import {
  Button,
  formatMinor,
  Frame,
  Notice,
  Status,
  TextAreaField,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./purchasing.css";
import { AppNav } from "@/features/home/app-nav";
import { type Doc, qty } from "@/features/purchasing/document-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "partial" | "success";

interface RetLine {
  id: string;
  document_line_id: string;
  item_name: string;
  unit_name: string;
  qty_milli: string;
  unit_price_minor: string;
  line_total_minor: string;
  reason: string;
  accepted_qty_milli: string;
  supplier_note: string;
}

interface Ret {
  id: string;
  number: string;
  document_number: string;
  supplier_name: string;
  status: "recorded" | "partial" | "accepted" | "rejected";
  status_label: string;
  total_minor: string;
  accepted_minor: string;
  rejected_minor: string;
  supplier_note: string;
  lines: RetLine[];
  responded_at: string;
}

interface Detail {
  document: Doc;
  return_limits: Record<string, number>;
  returns: Ret[];
}

/** «8 كراتين» · «6 كراتين» */
const qtyUnit = (milli: string, unit: string) => `${qty(milli)} ${unit}`;

export function ReturnClient({ documentId, returnId }: { documentId?: string; returnId?: string }) {
  const router = useRouter();
  const app = useApp();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [denied, setDenied] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { qty: string; reason: string }>>({});
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState<Ret | null>(null);
  const [viewing, setViewing] = useState<Ret | null>(null);
  const [resp, setResp] = useState<Record<string, string>>({});
  const [respNote, setRespNote] = useState("");
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    const here = returnId
      ? `/purchasing/returns/${returnId}`
      : `/purchasing/documents/${documentId ?? ""}/return`;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    void (async () => {
      let docId = documentId;
      if (returnId) {
        const r = await api().GET("/api/inventory/purchasing/returns/{return_id}", {
          params: { path: { return_id: returnId } },
        });
        if (r.response.status === 403) {
          setDenied(true);
          return;
        }
        const rb = r.data as unknown as { return: Ret } | undefined;
        if (!rb) return;
        setViewing(rb.return);
        docId = (rb.return as unknown as { document_id: string }).document_id;
      }
      const { data, response } = await api().GET(
        "/api/inventory/purchasing/documents/{document_id}",
        { params: { path: { document_id: docId ?? "" } } },
      );
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      const body = data as unknown as Detail | undefined;
      if (body) setDetail(body);
    })().catch(() => undefined);
  }, [router, documentId, returnId]);

  const doc = detail?.document ?? null;
  const limitOf = (lineId: string) => detail?.return_limits[lineId] ?? 0;
  const draftOf = (lineId: string) => drafts[lineId] ?? { qty: "", reason: "" };
  const qtyMilli = (v: string) => Math.round(Number(v || "0") * 1000);
  const lineErrors = (l: Doc["lines"][number]) => {
    const d = draftOf(l.id);
    const q = qtyMilli(d.qty);
    return {
      exceeds: q > limitOf(l.id),
      reason: q > 0 && !d.reason.trim(),
    };
  };
  const activeLines = (doc?.lines ?? []).filter((l) => qtyMilli(draftOf(l.id).qty) > 0);
  const anyError = (doc?.lines ?? []).some((l) => {
    const e = lineErrors(l);
    return e.exceeds || e.reason;
  });
  const total = activeLines.reduce(
    (a, l) => a + (BigInt(l.unit_price_minor) * BigInt(qtyMilli(draftOf(l.id).qty))) / 1000n,
    0n,
  );

  const record = async () => {
    if (!doc || busy) return;
    setAttempted(true);
    if (anyError || !activeLines.length) return;
    setBusy(true);
    try {
      const { data, response } = await api().POST(
        "/api/inventory/purchasing/documents/{document_id}/{action}",
        {
          params: { path: { document_id: doc.id, action: "return" } },
          body: {
            lines: activeLines.map((l) => ({
              document_line_id: l.id,
              qty_milli: String(qtyMilli(draftOf(l.id).qty)),
              reason: draftOf(l.id).reason.trim(),
            })),
          } as never,
        },
      );
      const body = data as unknown as { return: Ret } | undefined;
      if (response.ok && body) {
        setSaved(body.return);
        setViewing(body.return);
      }
    } finally {
      setBusy(false);
    }
  };

  const respond = async () => {
    const r = viewing;
    if (!r || busy) return;
    setBusy(true);
    try {
      const { data, response } = await api().POST("/api/inventory/purchasing/returns/{return_id}", {
        params: { path: { return_id: r.id } },
        body: {
          note: respNote,
          lines: r.lines.map((l) => ({
            id: l.id,
            accepted_qty_milli: String(qtyMilli(resp[l.id] ?? qty(l.qty_milli).replace(/,/g, ""))),
          })),
        } as never,
      });
      const body = data as unknown as { return: Ret } | undefined;
      if (response.ok && body) {
        setViewing(body.return);
        setSaved(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = saved
    ? "success"
    : viewing && (viewing.status === "partial" || viewing.status === "rejected")
      ? "partial"
      : attempted && anyError
        ? "validation_error"
        : "ready";

  const rejectedLines = (viewing?.lines ?? []).filter(
    (l) => l.accepted_qty_milli !== "" && BigInt(l.accepted_qty_milli) < BigInt(l.qty_milli),
  );
  const acceptedLines = (viewing?.lines ?? []).filter(
    (l) => l.accepted_qty_milli !== "" && BigInt(l.accepted_qty_milli) > 0n,
  );

  return (
    <Frame title="المشتريات" nav={<AppNav currentId="purchasing" />} footer={null}>
      <div className="sys pur" data-screen="PUR-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">
              مرتجع المشتريات — يُردّ ما استُلم بالسعر الذي استُلم به
            </h2>
            <span className="cat-head__hint">
              المرتجع يُبنى على مستند شراء بعينه لا على الصنف مجرّداً، فيرجع بسعر تلك الفاتورة لا
              بسعر اليوم — وإلا صارت المرتجعات باباً لتغيير التكلفة.
            </span>
          </div>
          <div className="acc-card__body">
            {denied ? (
              <Notice kind="locked" title="المرتجع للمالك والمحاسب">
                <p className="acc-lead">المرتجع يخفّض ذمّة المورد — أمين المخزن يرى ولا يُسجّل.</p>
              </Notice>
            ) : null}

            {doc && doc.status !== "approved" ? (
              <Notice kind="warning" title="مستند غير معتمد">
                <p className="acc-lead">لا يُردّ ما لم يُستلم — المرتجع يُبنى على مستند معتمد.</p>
              </Notice>
            ) : null}

            {state === "success" && saved ? (
              <Notice
                kind="success"
                title={
                  <>
                    سُجّل المرتجع <span className="sting-mono">{saved.number}</span>
                  </>
                }
                action={
                  <Button pos onClick={() => router.push(`/purchasing/documents/${doc?.id ?? ""}`)}>
                    عد إلى المستند
                  </Button>
                }
              >
                <p className="acc-lead">
                  خرجت الكميات من المخزون وقُيِّد{" "}
                  <span className="sting-mono">{formatMinor(saved.total_minor)}</span> لصالح المنشأة
                  على المورد — إشعار دائن لا نقد.
                </p>
                <p className="acc-lead">
                  <strong>التكلفة</strong> · لا تتأثر: الردّ بسعر المستند نفسه، فالمتوسط المرجّح
                  يبقى كما هو. هذا سبب تثبيت السعر ابتداءً.
                </p>
                <p className="acc-lead">
                  <strong>التحليلات</strong> · يظهر في نسبة المرتجع لـ{saved.supplier_name} مع سببه
                  مصنّفاً.
                </p>
                <p className="acc-choice__note">
                  المسار: خصمه من مستحقّ المورد، أو مطالبته باستبدال عينيّ.
                </p>
              </Notice>
            ) : null}

            {state === "partial" && viewing ? (
              <Notice kind="warning" title="رُدَّ بعض ما طُلب ردُّه">
                <p className="acc-lead">
                  المورد قَبِل{" "}
                  {acceptedLines
                    .map((l) => `${l.item_name} (${qtyUnit(l.accepted_qty_milli, l.unit_name)})`)
                    .join(" و") || "لا شيء"}{" "}
                  ورفض{" "}
                  {rejectedLines
                    .map(
                      (l) =>
                        `${l.item_name} (${qtyUnit(
                          String(BigInt(l.qty_milli) - BigInt(l.accepted_qty_milli)),
                          l.unit_name,
                        )})`,
                    )
                    .join(" و")}
                  {viewing.supplier_note ? `: «${viewing.supplier_note}»` : ""}. مرتجعٌ{" "}
                  {viewing.status === "rejected" ? "كلُّه مرفوض" : "نصفُه مقبول"}.
                </p>
                <p className="acc-lead">
                  <strong>لا نُغلقه</strong> · المرتجع يبقى مفتوحاً بالمرفوض، ويُسجَّل ردُّ المورد
                  نصاً كما قاله — هو الذي سيُحتجّ به لاحقاً.
                </p>
                <p className="acc-lead">
                  <strong>الأثر المالي</strong> · يُخصم المقبول (
                  <span className="sting-mono">{formatMinor(viewing.accepted_minor)}</span>) فقط.
                  المرفوض (<span className="sting-mono">{formatMinor(viewing.rejected_minor)}</span>
                  ) لا يُخصم ولا يعود للمخزون قبل قرارك: تحتفظ به أو تتصعّد.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="error" title="ردٌّ أكثر مما استُلم">
                <p className="acc-lead">
                  {(doc?.lines ?? [])
                    .filter((l) => lineErrors(l).exceeds)
                    .map(
                      (l) =>
                        `محاولة ردّ ${qtyUnit(String(qtyMilli(draftOf(l.id).qty)), l.unit_name)} ${l.item_name} من ${qty(String(limitOf(l.id)))} مستلمة`,
                    )
                    .join("، ")}
                  {(doc?.lines ?? []).some((l) => lineErrors(l).reason)
                    ? "، وسطرٌ بكمية ردّ بلا سبب."
                    : "."}
                </p>
                <p className="acc-lead">
                  <strong>الكمية</strong> · لا يُردّ ما لم يُستلم. الحدّ الأعلى لكل سطر هو المستلم
                  ناقص ما رُدّ سابقاً على نفس المستند.
                </p>
                <p className="acc-lead">
                  <strong>السبب</strong> · إلزامي لأنه يُقرأ في GROW-02: «تالف» حكمٌ على المورد،
                  و«خطأ في الطلب» حكمٌ علينا.
                </p>
                <p className="acc-choice__note">
                  الحقل يُقصَر على الحدّ فور تجاوزه، ويُعرض الحدّ بجانبه — لا رسالة بعد الحفظ.
                </p>
              </Notice>
            ) : null}

            {viewing ? (
              <div className="acc-choice">
                <div className="acc-choice__head">
                  <strong>
                    مرتجع <span className="sting-mono">{viewing.number}</span> على مستند{" "}
                    <span className="sting-mono">{viewing.document_number}</span>
                  </strong>
                  <Status
                    state={
                      viewing.status === "accepted"
                        ? "success"
                        : viewing.status === "recorded"
                          ? "pending_sync"
                          : "stale"
                    }
                    label={viewing.status_label}
                  />
                </div>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">يُردّ</th>
                      <th scope="col">سعر المستند</th>
                      <th scope="col">السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewing.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.item_name}</td>
                        <td>
                          <span className="sting-mono">{qty(l.qty_milli)}</span> {l.unit_name}
                          {l.accepted_qty_milli !== "" ? (
                            <div className="acc-choice__note">
                              قَبِل المورد{" "}
                              <span className="sting-mono">{qty(l.accepted_qty_milli)}</span>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className="sting-mono">{formatMinor(l.unit_price_minor)}</span>
                        </td>
                        <td>{l.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="acc-choice__head">
                  <strong>قيمة المرتجع</strong>
                  <span className="sting-mono home-kpi__value">
                    −{formatMinor(viewing.total_minor)}
                  </span>
                </div>
                {viewing.status === "recorded" ? (
                  <>
                    <p className="acc-choice__note">ردّ المورد — يُسجَّل نصاً كما قاله.</p>
                    {viewing.lines.map((l) => (
                      <TextField
                        key={l.id}
                        label={`قَبِل المورد من ${l.item_name}`}
                        mono
                        value={resp[l.id] ?? qty(l.qty_milli).replace(/,/g, "")}
                        onChange={(ev) => setResp((p) => ({ ...p, [l.id]: ev.target.value }))}
                        hint={`من ${qtyUnit(l.qty_milli, l.unit_name)}`}
                      />
                    ))}
                    <TextAreaField
                      label="ما قاله المورد"
                      value={respNote}
                      onChange={(ev) => setRespNote(ev.target.value)}
                    />
                    <div className="acc-actions">
                      <Button pos onClick={() => void respond()} loading={busy}>
                        سجّل ردّ المورد
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {doc && doc.status === "approved" && !viewing ? (
              <>
                <div className="acc-choice__head">
                  <strong>
                    مرتجع على مستند <span className="sting-mono">{doc.number}</span>
                  </strong>
                  <span className="acc-choice__note">الأسعار مثبّتة من المستند الأصلي</span>
                </div>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">استُلم</th>
                      <th scope="col">يُردّ</th>
                      <th scope="col">سعر المستند</th>
                      <th scope="col">السبب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l) => {
                      const d = draftOf(l.id);
                      const e = lineErrors(l);
                      const max = limitOf(l.id);
                      return (
                        <tr
                          key={l.id}
                          className={
                            attempted && (e.exceeds || e.reason) ? "pur-line--error" : undefined
                          }
                        >
                          <td>{l.item_name}</td>
                          <td>
                            <span className="sting-mono">{qty(l.received_qty_milli)}</span>{" "}
                            {l.unit_name}
                          </td>
                          <td>
                            <TextField
                              label={`يُردّ — ${l.item_name}`}
                              mono
                              value={d.qty}
                              onChange={(ev) =>
                                setDrafts((p) => ({
                                  ...p,
                                  [l.id]: { ...draftOf(l.id), qty: ev.target.value },
                                }))
                              }
                              hint={`الحدّ ${qty(String(max))} ${l.unit_name}`}
                              error={
                                attempted && e.exceeds
                                  ? `لا يُردّ ما لم يُستلم — الحدّ ${qty(String(max))} ${l.unit_name}.`
                                  : undefined
                              }
                            />
                          </td>
                          <td>
                            <span className="sting-mono">{formatMinor(l.unit_price_minor)}</span>
                          </td>
                          <td>
                            <TextField
                              label={`السبب — ${l.item_name}`}
                              value={d.reason}
                              onChange={(ev) =>
                                setDrafts((p) => ({
                                  ...p,
                                  [l.id]: { ...draftOf(l.id), reason: ev.target.value },
                                }))
                              }
                              error={
                                attempted && e.reason
                                  ? "السبب إلزامي لكل سطر: «تالف» و«خطأ في الطلب» و«قارب الانتهاء» ثلاثة أحكام مختلفة على المورد."
                                  : undefined
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="acc-choice__note">
                  السبب إلزامي لكل سطر: المرتجع بلا سبب لا يُقرأ في تحليلات المورد (GROW-02) ولا
                  يُحاجَج به. «تالف» و«خطأ في الطلب» و«قارب الانتهاء» ثلاثة أحكام مختلفة على المورد.
                </p>
                <div className="acc-choice__head">
                  <strong>قيمة المرتجع</strong>
                  <span className="sting-mono home-kpi__value">−{formatMinor(String(total))}</span>
                </div>
                <div className="acc-actions">
                  <Button pos onClick={() => void record()} loading={busy}>
                    سجّل المرتجع
                  </Button>
                  <Button onClick={() => router.push(`/purchasing/documents/${doc.id}`)}>
                    رجوع
                  </Button>
                </div>
                {detail && detail.returns.length ? (
                  <div className="acc-actions">
                    <span className="acc-choice__note">مرتجعات سابقة على هذا المستند:</span>
                    {detail.returns.map((r) => (
                      <Button key={r.id} onClick={() => router.push(`/purchasing/returns/${r.id}`)}>
                        مرتجع <span className="sting-mono">{r.number}</span> — {r.status_label}
                      </Button>
                    ))}
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
