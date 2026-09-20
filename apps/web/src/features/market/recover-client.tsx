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
import { hhmm } from "@/features/home/format";
import { readAttempt } from "@/features/market/cart-store";
import type { OrderRow } from "@/features/market/orders-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "conflict" | "server_error" | "success";

interface Diff {
  offer_id: string;
  public_name: string;
  server_qty: number | null;
  server_price_minor: string;
  local_qty: number | null;
  local_price_minor: string;
}

interface Probe {
  found: boolean;
  order: OrderRow | null;
  same_payload: boolean | null;
  diff: Diff[];
}

/** ORD-14 — تعارض نسخة أو ردٌّ مفقود (08-D4 server_error · 41-D33 ready/conflict/success): استعلام لا طلب جديد. */
export function RecoverClient() {
  const router = useRouter();
  const params = useSearchParams();
  const op = params.get("op") ?? "";
  const app = useApp();
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probed, setProbed] = useState(false);
  const [busy, setBusy] = useState("");
  const [resent, setResent] = useState<OrderRow | null>(null);
  const attempt = readAttempt(op);
  const appRef = useRef(app);
  appRef.current = app;

  const ask = useCallback(async () => {
    if (!op) return;
    setBusy("probe");
    try {
      const { data, response } = await api().POST("/api/market/orders/probe", {
        body: { op_id: op, lines: attempt?.lines ?? [] } as never,
      });
      const body = data as unknown as Probe | undefined;
      if (response.ok && body) setProbe(body);
      setProbed(true);
    } finally {
      setBusy("");
    }
  }, [op, attempt]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(
        `/login?next=${encodeURIComponent(`/market/orders/recover${op ? `?op=${op}` : ""}`)}`,
      );
    }
  }, [router, op]);

  const resend = async () => {
    if (!attempt || busy) return;
    setBusy("resend");
    try {
      const r = await api().POST("/api/market/orders", {
        body: {
          op_id: op,
          supplier_tenant_id: attempt.supplier_tenant_id,
          kind: attempt.kind,
          delivery_to: attempt.delivery_to,
          note: attempt.note,
          lines: attempt.lines,
        } as never,
      });
      const b = r.data as unknown as { order: OrderRow; created: boolean } | undefined;
      if (r.response.ok && b) setResent(b.order);
    } finally {
      setBusy("");
    }
  };

  const state: State =
    resent || (probe?.found && probe.same_payload !== false)
      ? "success"
      : probe?.found && probe.same_payload === false
        ? "conflict"
        : op && attempt && !probed
          ? "server_error"
          : "ready";
  const order = resent ?? probe?.order ?? null;

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-orders" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-14" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">رد مفقود بعد الإرسال — استعلام لا طلب جديد</h2>
            <span className="cat-head__hint">
              ACC-124: إعادة نفس الحمولة تُعاد إلى الطلب نفسه؛ اختلاف الحمولة تعارض يوقف الإرسال.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "server_error" && attempt ? (
              <>
                <div className="acc-actions">
                  <Status state="server_error" label="خطأ خادم" />
                </div>
                <Notice kind="error" title="لا نعرف إن كان الطلب قد وصل">
                  <p className="acc-lead">
                    أُرسل الطلب <span className="sting-mono">{hhmm(attempt.at)}</span> وانقطع الرد
                    قبل أن يعود. هذا لا يعني فشلاً ولا نجاحاً. زر «إعادة الإرسال» الساذج قد يُنشئ
                    طلبين للمورد نفسه.
                  </p>
                </Notice>
                <h3 className="cat-head__title">ما نفعله بدلاً من ذلك</h3>
                <ul className="cus-list">
                  <li>
                    <strong>استعلام بمفتاح العملية</strong>
                    <div className="cus-sub">
                      نسأل الخادم: هل وصلك طلب بهذا المفتاح؟ السؤال لا ينشئ شيئاً.
                    </div>
                    <Status state="success" label="آمن" />
                  </li>
                  <li>
                    <strong>إعادة نفس الحمولة بنفس المفتاح</strong>
                    <div className="cus-sub">
                      إن كان قد وصل، يعيد الخادم الطلب نفسه بدل إنشاء ثانٍ. إن لم يصل، يُنشأ الآن
                      مرة واحدة.
                    </div>
                    <Status state="success" label="آمن" />
                  </li>
                  <li>
                    <strong>حمولة مختلفة بنفس المفتاح</strong>
                    <div className="cus-sub">
                      يُرفض الإرسال ويُعرض الفرق. لا دمج ولا اختيار تلقائي لأحد الإصدارين.
                    </div>
                    <Status state="conflict" label="تعارض" />
                  </li>
                </ul>
                <p className="acc-choice__note">
                  <strong>حالة التعارض.</strong> لو وجد الخادم طلباً بنفس مفتاح العملية لكن بحمولة
                  مختلفة — كأن تكون كمية عُدِّلت على جهاز آخر بين المحاولتين — فلا إرسال ولا دمج.
                  تُعرض الحمولتان جنباً إلى جنب وتختار أنت أيهما الطلب.
                </p>
                <p className="acc-choice__note sting-mono" dir="ltr">
                  idem_key: {op.slice(0, 12)}
                </p>
                <div className="acc-actions">
                  <Button pos loading={busy === "probe"} onClick={() => void ask()}>
                    استعلام عن حالة الإرسال
                  </Button>
                  <Button
                    onClick={() =>
                      router.push(`/market/checkout?supplier=${attempt.supplier_tenant_id}`)
                    }
                  >
                    عرض الطلب كمسودة
                  </Button>
                </div>
              </>
            ) : null}

            {state === "ready" ? (
              <Notice kind="info" title="استعلام بنفس المعرّف">
                <p className="acc-lead">
                  يُسأل الخادم عن حالة الطلب بمعرّفه المحفوظ، ويُعرض ما لديه: لم يصل، أو وصل
                  ومؤكَّد، أو وصل ومُلغى.
                </p>
                <p className="acc-choice__note">
                  <strong>لا زرّ «أعد الإنشاء»</strong> · الإنشاء البديل يُنتج طلبين عند المورد.
                  المعروض «استعلم» ثم «أعد إرسال نفسه».
                </p>
                {op && !attempt ? (
                  <p className="acc-choice__note">لا مسودة محفوظة لهذا المعرّف على هذا الجهاز.</p>
                ) : null}
                {probed && probe && !probe.found && attempt ? (
                  <>
                    <p className="acc-choice__note">لم يصل — يُنشأ الآن مرة واحدة بالمعرّف نفسه.</p>
                    <div className="acc-actions">
                      <Button pos loading={busy === "resend"} onClick={() => void resend()}>
                        أعد إرسال نفسه
                      </Button>
                    </div>
                  </>
                ) : null}
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/orders")}>طلباتي</Button>
                </div>
              </Notice>
            ) : null}

            {state === "conflict" && probe?.order ? (
              <Notice kind="warning" title="نفس المعرّف بحمولة مختلفة">
                <p className="acc-lead">
                  الخادم يحمل الطلب <span className="sting-mono">{probe.order.number_label}</span>{" "}
                  بحمولة والجهاز يحمله بأخرى.
                </p>
                <p className="acc-choice__note">
                  <strong>لا كتابة فوق</strong> · التعارض يُحجَز ويُعرض الفرق للمراجعة (ACC-124).
                  الكتابة فوق نسخة الخادم تمحو ما رآه المورد.
                </p>
                <table className="pur-lines">
                  <thead>
                    <tr>
                      <th scope="col">الصنف</th>
                      <th scope="col">عند الخادم</th>
                      <th scope="col">على الجهاز</th>
                    </tr>
                  </thead>
                  <tbody>
                    {probe.diff.map((d) => (
                      <tr key={d.offer_id}>
                        <td>{d.public_name || d.offer_id}</td>
                        <td>
                          {d.server_qty == null ? (
                            "—"
                          ) : (
                            <>
                              <span className="sting-mono">{d.server_qty}</span> ×{" "}
                              <span className="sting-mono">
                                {d.server_price_minor ? formatMinor(d.server_price_minor) : "—"}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          {d.local_qty == null ? (
                            "—"
                          ) : (
                            <>
                              <span className="sting-mono">{d.local_qty}</span> ×{" "}
                              <span className="sting-mono">
                                {d.local_price_minor ? formatMinor(d.local_price_minor) : "—"}
                              </span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="acc-actions">
                  <Button
                    pos
                    onClick={() => router.push(`/market/orders/${probe.order?.id ?? ""}`)}
                  >
                    نسخة الخادم هي الطلب
                  </Button>
                  <Button
                    onClick={() =>
                      router.push(`/market/checkout?supplier=${attempt?.supplier_tenant_id ?? ""}`)
                    }
                  >
                    نسخة الجهاز — كمسودة جديدة بمعرّف جديد
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "success" && order ? (
              <Notice
                kind="success"
                title="الطلب موجود ومؤكَّد"
                action={
                  <Button onClick={() => router.push(`/market/orders/${order.id}`)}>
                    تفاصيل الطلب
                  </Button>
                }
              >
                <p className="acc-lead">
                  طلبٌ واحد لا اثنان، وحالته الحقيقية معروضة مع وقت آخر حدث.{" "}
                  <span className="sting-mono">{order.number_label}</span> ·{" "}
                  {order.list_status_label} ·{" "}
                  <span className="sting-mono">{hhmm(order.updated_at)}</span>
                </p>
                <p className="acc-choice__note">
                  <strong>نقول إن الأول وصل</strong> · لا «أُرسل بنجاح» فحسب. المستخدم كان يخشى
                  الازدواج، فالجواب عن خشيته لا عن الفعل.
                </p>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
