"use client";

import {
  Button,
  formatMinor,
  Frame,
  Notice,
  RadioGroupField,
  Status,
  TextField,
} from "@sting/ui-web";
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
import type { VerifiedLine } from "@/features/market/cart-client";
import { unitsWord } from "@/features/market/cart-client";
import { clearOpId, opIdFor, readCart, writeCart } from "@/features/market/cart-store";
import type { CartLine } from "@/features/market/offer-detail-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "saving" | "expired" | "success" | "server_error";

interface Responsibility {
  who: string;
  items: string[];
}

export interface Order {
  id: string;
  op_id: string;
  number: number;
  number_label: string;
  kind: "order" | "quote";
  kind_label: string;
  status: string;
  status_label: string;
  version: number;
  supplier_tenant_id: string;
  supplier_name: string;
  currency: string;
  lines: {
    offer_id: string;
    public_name: string;
    pack_label: string;
    unit_name: string;
    qty: number;
    price_minor: string;
  }[];
  lines_count: number;
  total_minor: string;
  delivery_to: string;
  fees_label: string;
  response_hours: number;
  deadline_at: string;
  sent_at: string;
  updated_at: string;
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
const dm = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};
const linesWord = (n: number) => (n === 1 ? "بند واحد" : n === 2 ? "بندان" : `${n} بنود`);

/** ORD-02 — مراجعة وإرسال طلب أو طلب سعر (41-D33 ready/validation_error/saving/success/server_error · 10-D6 expired): من يتحمل ماذا. */
export function CheckoutClient() {
  const router = useRouter();
  const params = useSearchParams();
  const supplier = params.get("supplier") ?? "";
  const app = useApp();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [verified, setVerified] = useState<Record<string, VerifiedLine>>({});
  const [responsibilities, setResponsibilities] = useState<Responsibility[]>([]);
  const [hours, setHours] = useState(72);
  const [kind, setKind] = useState<"order" | "quote">("order");
  const [deliveryTo, setDeliveryTo] = useState("الفرع الرئيسي");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [failed, setFailed] = useState(false);
  const [rejected, setRejected] = useState<{ code: string; extra: Record<string, unknown> } | null>(
    null,
  );
  const [excluded, setExcluded] = useState<string[]>([]);
  const appRef = useRef(app);
  appRef.current = app;

  const verify = useCallback(async (ls: CartLine[]) => {
    const { data, response } = await api().POST("/api/market/orders/verify", {
      body: {
        lines: ls.map((l) => ({ offer_id: l.offer_id, qty: l.qty, price_minor: l.price_minor })),
      } as never,
    });
    const body = data as unknown as
      | { lines: VerifiedLine[]; responsibilities: Responsibility[]; response_hours: number }
      | undefined;
    if (response.ok && body) {
      const map: Record<string, VerifiedLine> = {};
      for (const v of body.lines) map[v.offer_id] = v;
      setVerified(map);
      setResponsibilities(body.responsibilities);
      setHours(body.response_hours);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/checkout?supplier=${supplier}`)}`);
      return;
    }
    const ls = readCart().lines.filter((l) => l.seller_tenant_id === supplier);
    setLines(ls);
    void verify(ls).catch(() => undefined);
  }, [router, supplier, verify]);

  const first = lines[0] ?? null;
  const buyerCurrency = first?.currency ?? "";
  const currencyMismatch = Object.values(verified).some(
    (v) => v.currency && buyerCurrency && v.currency !== buyerCurrency,
  );
  const expiredIds = lines
    .filter((l) => verified[l.offer_id]?.expired || excluded.includes(l.offer_id))
    .map((l) => l.offer_id);
  const sendable = lines.filter((l) => !expiredIds.includes(l.offer_id));

  const submit = async (only: CartLine[] = sendable) => {
    if (busy || !first) return;
    setBusy(true);
    setFailed(false);
    setRejected(null);
    try {
      const r = await api().POST("/api/market/orders", {
        body: {
          op_id: opIdFor(supplier),
          supplier_tenant_id: supplier,
          kind,
          delivery_to: deliveryTo,
          note,
          lines: only.map((l) => ({
            offer_id: l.offer_id,
            qty: l.qty,
            price_minor: l.price_minor,
          })),
        } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        { order?: Order; detail?: string; extra?: Record<string, unknown> } | undefined;
      if (r.response.ok && b?.order) {
        setOrder(b.order);
        clearOpId(supplier);
        writeCart(readCart().lines.filter((l) => !only.some((x) => x.offer_id === l.offer_id)));
        return;
      }
      const code = b?.detail ?? "";
      if (code === "line_expired") {
        const ids = ((b?.extra?.offer_ids as string[] | undefined) ?? []).filter(Boolean);
        setExcluded((cur) => [...new Set([...cur, ...ids])]);
        await verify(lines);
        return;
      }
      if (code === "price_changed") {
        router.push("/market/cart");
        return;
      }
      setRejected({ code, extra: b?.extra ?? {} });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const inquire = async () => {
    const { data, response } = await api().GET("/api/market/orders", {
      params: { query: { op_id: opIdFor(supplier) } },
    });
    const body = data as unknown as { orders: Order[] } | undefined;
    const found = response.ok && body ? body.orders[0] : undefined;
    if (found) {
      setOrder(found);
      setFailed(false);
      clearOpId(supplier);
      writeCart(readCart().lines.filter((l) => l.seller_tenant_id !== supplier));
    }
  };

  const state: State = order
    ? "success"
    : failed
      ? "server_error"
      : busy
        ? "saving"
        : expiredIds.length && kind === "order"
          ? "expired"
          : currencyMismatch || rejected
            ? "validation_error"
            : "ready";
  const expiredLine = lines.find((l) => expiredIds.includes(l.offer_id)) ?? null;

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-cart" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مراجعة الطلب قبل الإرسال — من يتحمل ماذا</h2>
            <span className="cat-head__hint">
              الشاشة الوحيدة التي تُقرأ قبل التزام مالي، فكل رقم فيها بمصدره وكل مسؤولية باسم
              صاحبها.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && order ? (
              <Notice
                kind="success"
                title="أُرسل الطلب"
                action={<Button onClick={() => router.push("/market/orders")}>طلباتي</Button>}
              >
                <p className="acc-lead">
                  <span className="sting-mono">{order.number_label}</span> إلى {order.supplier_name}{" "}
                  · {order.status_label} · مهلة الرد{" "}
                  <span className="sting-mono">{order.response_hours}</span> ساعة حتى{" "}
                  <When iso={order.deadline_at} /> — وعند انقضائها يُعرض الطلب بلا ردّ وتقرر أنت
                  إبقاءه أو إلغاءه.
                </p>
                <p className="acc-choice__note">
                  <strong>أُرسل ليست قُبل</strong> · لا التزام مالي ولا حجز مخزون الآن. نقول
                  «بانتظار رد المورد» لا «تم الطلب» — الثانية تُفهم تأكيداً.
                </p>
              </Notice>
            ) : null}

            {state === "server_error" ? (
              <Notice kind="error" title="فشل الإرسال">
                <p className="acc-lead">الشبكة قُطعت أثناء الإرسال، ولا نعرف هل وصل الطلب.</p>
                <p className="acc-choice__note">
                  <strong>المعرّف محفوظ</strong> · إعادة المحاولة تُرسل الطلب نفسه بمعرّفه لا طلباً
                  جديداً (ACC-124). ومسار «استعلم عن الحالة» معروض (ORD-14).
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => void submit()}>
                    أعد المحاولة بالمعرّف نفسه
                  </Button>
                  <Button onClick={() => void inquire()}>استعلم عن الحالة</Button>
                </div>
              </Notice>
            ) : null}

            {state === "saving" ? (
              <Notice kind="info" title="جارٍ الإرسال">
                <p className="acc-lead">
                  الإرسال فعلٌ واحد بمعرّف واحد. الزرّ يُقفل ولا يُنشئ ضغطٌ ثانٍ طلباً ثانياً.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              currencyMismatch ? (
                <Notice kind="warning" title="عملة العرض تخالف عملة حسابك">
                  <p className="acc-lead">
                    العرض بعملة أخرى وحساب المنشأة بعملة واحدة غير قابلة للتبديل.
                  </p>
                  <p className="acc-choice__note">
                    <strong>لا تحويل ضمني</strong> · نمنع التأكيد ولا نحوّل بسعر صرف مفترض
                    (ACC-140). سعر الصرف التزامٌ مالي لا تقديرٌ في واجهة.
                  </p>
                </Notice>
              ) : rejected ? (
                <Notice kind="warning" title="لم يُرسل">
                  <p className="acc-lead">
                    {rejected.code === "permission_denied"
                      ? `الإرسال توقيع على مبلغ يتجاوز سقفك (${formatMinor(typeof rejected.extra.limit_minor === "string" ? rejected.extra.limit_minor : "0")}) — يرسله من يملك الصلاحية.`
                      : rejected.code === "min_order_not_met"
                        ? "قسمٌ تحت حدّه الأدنى — عُد إلى السلة وأكمل الفارق."
                        : rejected.code === "supplier_suspended"
                          ? "نشر هذه المنشأة معلَّق — لا طلب جديد حتى يُرفع التعليق."
                          : "تعذّر الإرسال — راجع السلة."}
                  </p>
                  <div className="acc-actions">
                    <Button onClick={() => router.push("/market/cart")}>السلة</Button>
                  </div>
                </Notice>
              ) : null
            ) : null}

            {first && !order ? (
              <>
                <div className="acc-actions">
                  {state === "expired" ? <Status state="expired" label="منتهي الصلاحية" /> : null}
                  <Status state="synced" label={kind === "order" ? "طلب" : "طلب سعر"} />
                </div>
                <h3 className="cat-head__title">مراجعة طلب إلى {first.seller_name}</h3>
                <p className="acc-choice__note">
                  {linesWord(lines.length)} · التسليم إلى {deliveryTo || "—"}
                </p>

                {state === "expired" && expiredLine ? (
                  <Notice kind="warning" title="بند واحد انتهى تأكيده أثناء مراجعتك.">
                    <p className="acc-lead">
                      {expiredLine.public_name} سعره لم يعد مؤكداً. الإرسال متاح للبنود المؤكدة
                      وحدها، أو تنتظر تأكيداً جديداً له. لن نرسل البند بسعره القديم ولن نحذفه دون
                      علمك.
                    </p>
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy}
                        onClick={() => void submit(sendable)}
                        disabledReason={sendable.length ? undefined : "لا بند مؤكداً للإرسال"}
                      >
                        {sendable.length === 2 ? "إرسال البندين المؤكدين" : "إرسال البنود المؤكدة"}
                      </Button>
                      <Button onClick={() => router.push(`/market/suppliers/${supplier}`)}>
                        طلب تأكيد جديد{" "}
                        {expiredLine.public_name.startsWith("ال")
                          ? `ل${expiredLine.public_name}`
                          : `لل${expiredLine.public_name}`}
                      </Button>
                    </div>
                  </Notice>
                ) : null}

                <ul className="cus-list">
                  {lines.map((l) => {
                    const v = verified[l.offer_id];
                    const isExpired = expiredIds.includes(l.offer_id);
                    return (
                      <li key={l.offer_id} className={isExpired ? "cus-item--expired" : undefined}>
                        <strong>
                          {l.public_name} — {unitsWord(l.qty, l.unit_name || "وحدة")}
                        </strong>
                        <div className="cus-sub">
                          {kind === "quote" ? (
                            "بلا التزام سعري — السعر يأتي في عرض المورد"
                          ) : isExpired ? (
                            <>
                              آخر سعر معروف{" "}
                              <span className="sting-mono">{formatMinor(l.price_minor)}</span>
                            </>
                          ) : (
                            <>
                              <span className="sting-mono">{formatMinor(l.price_minor)}</span> لل
                              {l.unit_name || "وحدة"}
                            </>
                          )}
                        </div>
                        <div>
                          {isExpired ? (
                            <Status
                              state="expired"
                              label={`انتهى تأكيده ${v?.valid_until ? dm(v.valid_until) : ""} — غير قابل للإرسال`}
                            />
                          ) : kind === "order" ? (
                            <Status
                              state="success"
                              label={`سعر مؤكد خادمياً حتى ${v?.valid_until ? dm(v.valid_until) : l.valid_until ? dm(l.valid_until) : "—"}`}
                            />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <dl className="mp-preview">
                  <dt>رسوم التوصيل</dt>
                  <dd>
                    {verified[first.offer_id]?.fees_label ??
                      first.fees_label ??
                      "حسب شروط المورد المنشورة"}{" "}
                    — من شروط الخدمة المعلنة
                  </dd>
                  <dt>مهلة رد المورد</dt>
                  <dd>
                    <span className="sting-mono">{hours}</span> ساعة من الإرسال — وبعدها يُعرض الطلب
                    بلا ردّ
                  </dd>
                </dl>

                <h3 className="cat-head__title">المسؤوليات في هذا الطلب</h3>
                <div className="pub-cols">
                  {responsibilities.map((r) => (
                    <div key={r.who}>
                      <strong>{r.who}</strong>
                      <ul className="pub-list">
                        {r.items.map((t) => (
                          <li key={t}>
                            <span className="pub-mark">•</span>
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <RadioGroupField
                  label="ما الذي ترسله؟"
                  name="kind"
                  value={kind}
                  onChange={(v) => setKind(v === "quote" ? "quote" : "order")}
                  options={[
                    {
                      value: "order",
                      label: "طلب",
                      hint: "طلبٌ على سعر مؤكَّد قائم — السعر يُثبت بقبول المورد",
                    },
                    {
                      value: "quote",
                      label: "طلب سعر",
                      hint: "طلب سعرٍ بلا التزام سعري — المورد يردّ بعرض",
                    },
                  ]}
                />
                <TextField
                  label="التسليم إلى"
                  value={deliveryTo}
                  onChange={(e) => setDeliveryTo(e.target.value)}
                />
                <TextField
                  label="ملاحظة للمورد (اختيارية)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <p className="acc-choice__note">
                  <strong>طلب أو طلب سعر</strong> · فعلان مختلفان لا صيغتان: طلبٌ على سعر مؤكَّد
                  قائم، أو طلب سعرٍ بلا التزام سعري. <strong>المسؤوليات معروضة</strong> · من ينقل،
                  ومن يحمل الرسوم، وأين التسليم، ومهلة رد المورد — قبل الإرسال لا في الخلاف.
                </p>
                {state !== "expired" ? (
                  <div className="acc-actions">
                    <Button
                      pos
                      loading={busy}
                      onClick={() => void submit()}
                      disabledReason={
                        currencyMismatch
                          ? "عملة العرض تخالف عملة حسابك — لا تحويل ضمني"
                          : !sendable.length
                            ? "لا بند للإرسال"
                            : undefined
                      }
                    >
                      {kind === "order" ? "أرسل الطلب" : "أرسل طلب السعر"}
                    </Button>
                    <Button onClick={() => router.push("/market/cart")}>عُد إلى السلة</Button>
                  </div>
                ) : null}
              </>
            ) : null}

            {!first && !order ? (
              <Notice kind="empty" title="لا بنود لهذا المورد في سلتك">
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/cart")}>السلة</Button>
                </div>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
