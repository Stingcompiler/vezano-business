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
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "partial" | "permission_denied" | "success";

interface CLine {
  offer_id: string;
  public_name: string;
  pack_label: string;
  unit_name: string;
  confirmed: number;
  shipped: number;
  received: number;
  in_transit: number;
  cancellable: number;
  already_cancelled: number;
  price_minor: string;
}

interface Breakdown {
  lines: CLine[];
  cancellable_total: number;
  received_total: number;
  in_transit_total: number;
  received_value_minor: string;
  shipment_refs: string[];
  full_cancel_available: boolean;
  already_cancelled: boolean;
  cancel_reason: string;
  order: OrderRow;
  can_cancel: boolean;
}

const unitsWord = (n: number, unit: string) =>
  n === 1 ? `${unit} واحدة` : n === 2 ? `${unit.replace(/ة$/, "ت")}ان` : `${n} ${unit}`;

/** ORD-10 — إلغاء المتبقّي (27-D20 partial/permission_denied/success · 10-D6 validation_error · 41-D33 ready): لا محو لما سُلّم أو سُجّل مالياً. */
export function CancelRemainingClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [d, setD] = useState<Breakdown | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Breakdown | null>(null);
  const [requested, setRequested] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}/cancel-remaining", {
      params: { path: { order_id: id } },
    });
    if (response.status === 404) {
      router.replace(`/market/orders/${id}`);
      return;
    }
    const body = data as unknown as Breakdown | undefined;
    if (response.ok && body) setD(body);
  }, [id, router]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/cancel-remaining`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, load, id]);

  const post = async (body: Record<string, unknown>) => {
    const r = await api().POST("/api/market/orders/{order_id}/cancel-remaining", {
      params: { path: { order_id: id } },
      body: body as never,
    });
    return { ok: r.response.ok, body: r.data as unknown as Breakdown | undefined };
  };

  const confirm = async () => {
    setAttempted(true);
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      const r = await post({ reason });
      if (r.ok && r.body) setDone(r.body);
    } finally {
      setBusy(false);
    }
  };

  const requestFromOwner = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post({ request: true });
      if (r.ok) setRequested(true);
    } finally {
      setBusy(false);
    }
  };

  const unit = d?.lines[0]?.unit_name ?? "وحدة";
  const state: State = done
    ? "success"
    : d && !d.can_cancel
      ? "permission_denied"
      : attempted && !reason.trim()
        ? "validation_error"
        : confirming
          ? "partial"
          : "ready";

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-orders" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-10" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">إلغاء المتبقّي — لا محو لما سُلّم أو سُجّل مالياً</h2>
            <span className="cat-head__hint">
              الإلغاء يطال غير المسلَّم فقط. ما استُلم يبقى في المخزون وفي الذمّة، والطلب يُقفل
              بحالة «مكتمل جزئياً وأُلغي متبقّيه» لا «ملغى».
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && done ? (
              <Notice
                kind="success"
                title="الحالة النهائية دقيقة"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  الطلب صار «
                  {done.order.status === "cancelled" ? "ملغى" : "مكتمل جزئياً — أُلغي المتبقّي"}».
                  {done.order.status !== "cancelled"
                    ? " لا نسمّيه «ملغى» فذلك يمحو من التاريخ شحنات وصلت فعلاً ومبلغاً قائماً على الذمّة."
                    : " لم يُشحن شيء ولم يُستلم شيء."}
                </p>
              </Notice>
            ) : null}
            {state === "permission_denied" && d ? (
              <Notice kind="warning" title="أمين المخزن يحاول الإلغاء">
                <p className="acc-lead">
                  إلغاء المتبقّي التزام تجاري تجاه مورد، فهو صلاحية من يملك حدّاً مالياً لا من يستلم
                  البضاعة.
                </p>
                <p className="acc-choice__note">
                  قيمة المتبقّي:{" "}
                  <span className="sting-mono">
                    {formatMinor(
                      String(
                        d.lines.reduce((a, l) => a + l.cancellable * Number(l.price_minor), 0),
                      ),
                    )}
                  </span>{" "}
                  · {unitsWord(d.cancellable_total, unit)}
                </p>
                <div className="acc-actions">
                  {requested ? (
                    <Status state="success" label="أُرسل الطلب إلى المالك" />
                  ) : (
                    <Button pos loading={busy} onClick={() => void requestFromOwner()}>
                      طلب إلغاء من المالك
                    </Button>
                  )}
                </div>
              </Notice>
            ) : null}
            {state === "validation_error" ? (
              <Notice kind="warning" title="إلغاء المتبقي — ماذا يُلغى بالضبط">
                <p className="acc-lead">
                  الإلغاء يحتاج سبباً مكتوباً يظهر لطرفي الطلب. «لم يُسلَّم في الموعد» ليس تهمة بل
                  بند في سجل الاتفاق.
                </p>
              </Notice>
            ) : null}
            {state === "ready" && d ? (
              <Notice kind="info" title="ما يُلغى وما لا يُلغى">
                <p className="acc-lead">
                  تُعرض الكميات الثلاث قبل التأكيد: المستلم يبقى، والمشحون في الطريق يحتاج قراراً،
                  والمتبقّي غير المشحون يُلغى.
                </p>
                <p className="acc-choice__note">
                  <strong>لا محو لما وقع</strong> · المسلَّم والمسجَّل مالياً لا يُمسّ. الإلغاء
                  يُقفل الباقي ولا يُعيد التاريخ.
                </p>
                <p className="acc-choice__note">
                  <strong>المشحون ليس متبقّياً</strong> · بضاعةٌ خرجت من مخزن المورد لا تُلغى بضغطة
                  مشترٍ. تُستلم أو تُرتجع بمستند.
                </p>
              </Notice>
            ) : null}

            {d && !done && d.can_cancel ? (
              <>
                {state === "partial" ? (
                  <div className="acc-actions">
                    <Status state="expired" label="إجراء لا رجعة فيه" />
                  </div>
                ) : null}
                <h3 className="cat-head__title">
                  إلغاء متبقّي الطلب <span className="sting-mono">{d.order.number_label}</span>
                </h3>
                <p className="acc-choice__note">
                  اقرأ ما سيُلغى وما سيبقى قبل التأكيد. هذا الجدول هو الحوار نفسه لا ملحقاً له.
                </p>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">يبقى — مستلَم</th>
                      <th scope="col">في الطريق</th>
                      <th scope="col">يُلغى — متبقٍّ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.offer_id}>
                        <td>
                          {l.public_name}
                          {l.pack_label ? ` — ${l.pack_label}` : ""}
                        </td>
                        <td className="sting-mono">{l.received}</td>
                        <td className="sting-mono">{l.in_transit}</td>
                        <td className="sting-mono">{l.cancellable}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="pub-cols">
                  <div>
                    <strong>يُلغى</strong>
                    <p className="acc-choice__note">
                      <span className="sting-mono">{d.cancellable_total}</span> {unit} · المؤكد غير
                      المشحون. يخرج من الطلب ولا يُحتسب عليك ولا على المورد.
                    </p>
                  </div>
                  <div>
                    <strong>لا يُلغى — سُلِّم</strong>
                    <p className="acc-choice__note">
                      <span className="sting-mono">{d.received_total}</span> وحدة · مستلم ومسجَّل في
                      مخزونك وذمتك. الإلغاء لا يسترد بضاعة بحوزتك.
                    </p>
                  </div>
                  <div>
                    <strong>لا يُلغى — محل خلاف</strong>
                    <p className="acc-choice__note">
                      <span className="sting-mono">{d.in_transit_total}</span> {unit} · الفارق محل
                      خلاف يُحسم في مساره. الإلغاء لا يُنهي خلافاً قائماً.
                    </p>
                  </div>
                </div>
                <p className="acc-choice__note">
                  <strong>لن يُمسّ:</strong> <span className="sting-mono">{d.received_total}</span>{" "}
                  {unit} مستلَمة دخلت المخزون، ومستندات الاستلام{" "}
                  <span className="sting-mono">
                    {d.shipment_refs.join("/").replace(/SH-/g, (m, i) => (i === 0 ? m : ""))}
                  </span>
                  ، ومبلغ <span className="sting-mono">{formatMinor(d.received_value_minor)}</span>{" "}
                  <span className="sting-mono">{d.order.currency}</span> المسجَّل على الذمّة.
                  الإلغاء ليس تسوية مالية.
                </p>
                <TextField
                  label="سبب الإلغاء — مطلوب ويراه المورد"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  error={attempted && !reason.trim() ? "السبب مطلوب" : undefined}
                />
                {confirming ? (
                  <p className="acc-choice__note">
                    <strong>سبب الإلغاء — مطلوب ويراه المورد:</strong> {reason}
                  </p>
                ) : null}
                <div className="acc-actions">
                  {confirming ? (
                    <>
                      <Button
                        pos
                        loading={busy}
                        onClick={() => void confirm()}
                        disabledReason={d.cancellable_total ? undefined : "لا متبقّي غير مشحون"}
                      >
                        إلغاء المتبقّي — {unitsWord(d.cancellable_total, unit)}
                      </Button>
                      <Button onClick={() => setConfirming(false)}>رجوع</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        pos
                        onClick={() => {
                          setAttempted(true);
                          if (reason.trim()) setConfirming(true);
                        }}
                        disabledReason={
                          d.already_cancelled
                            ? "أُلغي المتبقّي من قبل"
                            : d.cancellable_total
                              ? undefined
                              : "لا متبقّي غير مشحون"
                        }
                      >
                        إلغاء {unitsWord(d.cancellable_total, unit)} غير المشحونة
                      </Button>
                      <Button
                        disabledReason={
                          d.full_cancel_available
                            ? undefined
                            : "شُحن أو استُلم جزء من الطلب — لا محو لما وقع"
                        }
                      >
                        إلغاء الطلب كاملاً{d.full_cancel_available ? "" : " — غير متاح"}
                      </Button>
                    </>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
