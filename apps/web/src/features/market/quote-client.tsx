"use client";

import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
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
import type { Version, VersionLine } from "@/features/market/order-detail-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "saving" | "expired" | "success" | "partial";

interface Payload {
  order: OrderRow;
  request: Version | null;
  draft: Version | null;
  catalog_expired: string[];
  default_valid_until: string;
  can_quote: boolean;
}

interface EditLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  requested: number;
  requested_price: string;
  confirmed: string;
  price: string;
  reason: string;
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** ORD-06 — إعداد عرض سعر من المورد (41-D33 ready/validation_error/saving/expired/success · 12-D7 partial): الفرق معروض للطرفين. */
export function QuoteClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [fee, setFee] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState<"" | "draft" | "send" | "decline">("");
  const [sent, setSent] = useState<Version | null>(null);
  const [savedDraft, setSavedDraft] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [declined, setDeclined] = useState(false);
  const [serverError, setServerError] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}/quote", {
      params: { path: { order_id: id } },
    });
    if (response.status === 404) {
      router.replace("/market/orders/incoming");
      return;
    }
    const body = data as unknown as Payload | undefined;
    if (!response.ok || !body) return;
    setP(body);
    const base = body.draft ?? body.request;
    const reqLines = body.request?.lines ?? [];
    setLines(
      reqLines.map((rl: VersionLine) => {
        const dl = body.draft?.lines.find((x) => x.offer_id === rl.offer_id);
        return {
          offer_id: rl.offer_id,
          public_name: rl.public_name,
          pack_label: rl.pack_label,
          unit_name: rl.unit_name,
          requested: rl.qty_requested,
          requested_price: rl.price_minor,
          confirmed: String(dl?.qty_confirmed ?? rl.qty_requested),
          price: dl?.price_minor || rl.price_minor || "",
          reason: dl?.increase_reason ?? "",
        };
      }),
    );
    setFee(base?.delivery_fee_minor ?? "");
    setValidUntil(body.draft?.valid_until || body.default_valid_until);
    setNote(body.draft?.note ?? "");
  }, [id, router]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/quote`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const today = new Date().toISOString().slice(0, 10);
  const validityPast = Boolean(validUntil) && validUntil < today;
  const increases = lines.filter((l) => Number(l.confirmed) > l.requested && !l.reason.trim());
  const invalid = validityPast || increases.length > 0 || !validUntil;
  const partial = lines.some((l) => Number(l.confirmed) > 0 && Number(l.confirmed) < l.requested);
  const catalogExpired = p?.catalog_expired ?? [];

  const setLine = (oid: string, patch: Partial<EditLine>) =>
    setLines((cur) => cur.map((l) => (l.offer_id === oid ? { ...l, ...patch } : l)));

  const submit = async (send: boolean) => {
    setAttempted(true);
    setServerError("");
    if (send && invalid) return;
    if (busy) return;
    setBusy(send ? "send" : "draft");
    try {
      const r = await api().POST("/api/market/orders/{order_id}/quote", {
        params: { path: { order_id: id } },
        body: {
          send,
          delivery_fee_minor: fee || null,
          valid_until: validUntil,
          note,
          lines: lines.map((l) => ({
            offer_id: l.offer_id,
            qty_confirmed: Number(l.confirmed || 0),
            price_minor: l.price,
            increase_reason: l.reason,
          })),
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { version?: Version; detail?: string } | undefined;
      if (r.response.ok && b?.version) {
        if (send) setSent(b.version);
        else setSavedDraft(true);
      } else setServerError(b?.detail ?? "server_error");
    } catch (e) {
      setServerError(String(e));
    } finally {
      setBusy("");
    }
  };

  const decline = async () => {
    if (busy || !declineReason.trim()) return;
    setBusy("decline");
    try {
      const r = await api().POST("/api/market/orders/{order_id}/decline", {
        params: { path: { order_id: id } },
        body: { reason: declineReason } as never,
      });
      if (r.response.ok) setDeclined(true);
    } finally {
      setBusy("");
    }
  };

  const state: State = sent
    ? "success"
    : busy === "send" || busy === "draft"
      ? "saving"
      : attempted && invalid
        ? "validation_error"
        : catalogExpired.length
          ? "expired"
          : partial
            ? "partial"
            : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-incoming" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">إعداد عرض سعر من المورد</h2>
            <span className="cat-head__hint">
              هنا يصير الطلب اتفاقاً محتملاً. تحرير الردّ سطراً سطراً: يعدّل الكميات والأسعار، ويضيف
              رسوم نقل، ويحدّد صلاحية العرض — والفرق عن طلب المشتري معروضٌ في عمودٍ مقابل.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && sent ? (
              <Notice
                kind="success"
                title="أُرسل العرض"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  بإصدارٍ مرقَّم وصلاحية معلنة — والمشتري يقبل إصداراً بعينه لا «العرض». الإصدار{" "}
                  <span className="sting-mono">{sent.number}</span> · صالح حتى{" "}
                  <span className="sting-mono">
                    {sent.valid_until ? dm(sent.valid_until) : "—"}
                  </span>
                  .
                </p>
                <p className="acc-choice__note">
                  <strong>الترقيم ليس زينة</strong> · هو ما يجعل القبول قابلاً للإثبات. بلا رقم
                  إصدار يصير القبول دعوى (ACC-125).
                </p>
              </Notice>
            ) : null}
            {declined ? (
              <Notice
                kind="info"
                title="اعتذرتَ بسبب"
                action={
                  <Button onClick={() => router.push("/market/orders/incoming")}>
                    الطلبات الواردة
                  </Button>
                }
              >
                <p className="acc-lead">يظهر السبب للمشتري كما كتبته.</p>
              </Notice>
            ) : null}
            {state === "saving" ? (
              <Notice kind="info" title={busy === "draft" ? "حفظ مسودة العرض" : "إرسال العرض"}>
                <p className="acc-lead">
                  {busy === "draft"
                    ? "يُحفظ عند المورد ولا يصل المشتري حتى يُرسل صريحاً."
                    : "إصدارٌ مرقَّم واحد — الزرّ يُقفل حتى يرد الخادم."}
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="warning" title="صلاحية في الماضي أو كمية تفوق المطلوب">
                <p className="acc-lead">
                  {validityPast && increases.length
                    ? "تاريخ صلاحية أمس، وسطرٌ بكمية أكبر من طلب المشتري."
                    : validityPast
                      ? "تاريخ صلاحية في الماضي."
                      : !validUntil
                        ? "حدّد صلاحية العرض."
                        : "سطرٌ بكمية أكبر من طلب المشتري بلا سبب."}
                </p>
                <p className="acc-choice__note">
                  <strong>الزيادة تحتاج سبباً</strong> · قد تكون تعبئةً بالكرتونة الكاملة — تُعلَن
                  سبباً لا تُمرّر رقماً. والمشتري يقبل الزيادة أو يرفضها.
                </p>
                <p className="acc-choice__note">
                  <strong>الصلاحية لا تكون ماضياً</strong> · عرضٌ منتهٍ قبل إرساله لا معنى له،
                  ويُقرأ عند المشتري خطأً في نظامنا لا في تحرير المورد.
                </p>
              </Notice>
            ) : null}
            {state === "expired" ? (
              <Notice kind="warning" title="انتهت صلاحية سعر الكتالوج أثناء التحرير">
                <p className="acc-lead">العرض المنشور الذي بُني عليه الردّ انتهت صلاحيته.</p>
                <p className="acc-choice__note">
                  <strong>لا تجديد تلقائي</strong> · تعديل الوصف أو التحرير لا يجدّد تأكيد السعر
                  (ACC-144). التجديد فعلٌ مستقل في MP-13.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/renewals")}>
                    تجديد التأكيد (MP-13)
                  </Button>
                </div>
              </Notice>
            ) : null}
            {state === "partial" ? (
              <Notice kind="info" title="رد المورد — قبول جزئي">
                <p className="acc-lead">
                  القبول الجزئي ليس رفضاً ولا موافقة كاملة، ويحتاج قرار المشتري على المتبقي.
                </p>
                <p className="acc-choice__note">
                  لا يُنشئ ردك قيداً في دفتره: الذمة تنشأ بالاستلام لا بالتأكيد. المتبقي يبقى
                  «مطلوباً غير مؤكد» حتى يُلغيه أو تؤكده.
                </p>
              </Notice>
            ) : null}
            {serverError ? (
              <Notice kind="warning" title="لم يُحفظ">
                <p className="acc-lead">{serverError}</p>
              </Notice>
            ) : null}

            {p && !sent && !declined ? (
              <>
                <h3 className="cat-head__title">
                  <span className="sting-mono">{p.order.number_label}</span> — {p.order.buyer_name}
                </h3>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">مطلوب</th>
                      <th scope="col">مؤكد من المورد</th>
                      <th scope="col">السعر</th>
                      <th scope="col">الفرق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const conf = Number(l.confirmed || 0);
                      const diff = conf - l.requested;
                      const expiredLine = catalogExpired.includes(l.offer_id);
                      return (
                        <tr
                          key={l.offer_id}
                          className={expiredLine ? "cus-item--expired" : undefined}
                        >
                          <td>
                            <strong>{l.public_name}</strong>
                            <div className="mp-check__hint">{l.pack_label || l.unit_name}</div>
                            {expiredLine ? (
                              <Status state="expired" label="سعر الكتالوج منتهٍ" />
                            ) : null}
                          </td>
                          <td className="sting-mono">{l.requested}</td>
                          <td>
                            <TextField
                              label={`مؤكد — ${l.public_name}`}
                              kind="number"
                              mono
                              value={l.confirmed}
                              onChange={(e) => setLine(l.offer_id, { confirmed: e.target.value })}
                            />
                            {conf > l.requested ? (
                              <TextField
                                label={`سبب الزيادة — ${l.public_name}`}
                                value={l.reason}
                                onChange={(e) => setLine(l.offer_id, { reason: e.target.value })}
                                error={
                                  attempted && !l.reason.trim() ? "الزيادة تحتاج سبباً" : undefined
                                }
                              />
                            ) : null}
                          </td>
                          <td>
                            <TextField
                              label={`السعر — ${l.public_name}`}
                              kind="number"
                              mono
                              value={l.price}
                              onChange={(e) => setLine(l.offer_id, { price: e.target.value })}
                            />
                          </td>
                          <td>
                            {conf === 0 ? (
                              <Status state="expired" label="غير متوفر" />
                            ) : diff === 0 && l.price === l.requested_price ? (
                              "كما طُلب"
                            ) : (
                              <>
                                {diff !== 0 ? (
                                  <div>
                                    الكمية{" "}
                                    <span className="sting-mono">
                                      {diff > 0 ? `+${diff}` : diff}
                                    </span>
                                  </div>
                                ) : null}
                                {l.price !== l.requested_price ? (
                                  <div>
                                    السعر{" "}
                                    <span className="sting-mono">
                                      {l.requested_price ? formatMinor(l.requested_price) : "—"}
                                    </span>{" "}
                                    ←{" "}
                                    <span className="sting-mono">
                                      {l.price ? formatMinor(l.price) : "—"}
                                    </span>
                                  </div>
                                ) : null}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <TextField
                  label="رسوم النقل (بالقرش)"
                  kind="number"
                  mono
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
                <TextField
                  label="صلاحية العرض"
                  kind="date"
                  mono
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  error={
                    attempted && validityPast
                      ? "الصلاحية لا تكون ماضياً"
                      : attempted && !validUntil
                        ? "حدّد الصلاحية"
                        : undefined
                  }
                />
                <TextField
                  label="ملاحظة للمشتري (اختيارية)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <p className="acc-choice__note">
                  <strong>الفرق معروض للطرفين</strong> · المورد يرى ما غيّره قبل الإرسال، والمشتري
                  يراه بعده. تغييرٌ لا يُسمّى يُقرأ خطأً.
                </p>
                <div className="acc-actions">
                  <Button pos loading={busy === "send"} onClick={() => void submit(true)}>
                    أرسل العرض
                  </Button>
                  <Button loading={busy === "draft"} onClick={() => void submit(false)}>
                    حفظ مسودة العرض
                  </Button>
                  {savedDraft ? (
                    <Status
                      state="saved_local"
                      label="يُحفظ عند المورد ولا يصل المشتري حتى يُرسل صريحاً."
                    />
                  ) : null}
                </div>
                <h3 className="cat-head__title">أو اعتذر بسبب</h3>
                <TextField
                  label="سبب الاعتذار — يظهر للمشتري"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
                <div className="acc-actions">
                  <Button
                    loading={busy === "decline"}
                    onClick={() => void decline()}
                    disabledReason={declineReason.trim() ? undefined : "الاعتذار يحتاج سبباً"}
                  >
                    اعتذر بسبب
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
