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
import { dayMonth, hhmm } from "@/features/home/format";
import type { OrderRow } from "@/features/market/orders-client";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "validation_error" | "partial" | "stale" | "success";

interface Payment {
  id: string;
  number: number;
  ref_label: string;
  amount_minor: string;
  transfer_ref: string;
  transferred_on: string;
  allocations: { order_id: string; number_label: string; amount_minor: string }[];
  evidence_name: string;
  note: string;
  status: "recorded" | "matched" | "rejected";
  status_label: string;
  uploaded_at: string;
  matched_at: string;
  matched_by_name: string;
  decision_note: string;
  reminded_at: string;
  hours_since_upload: number;
  stale: boolean;
}

interface Payload {
  order: OrderRow;
  side: "buyer" | "supplier";
  payments: Payment[];
  due_minor: string;
  paid_minor: string;
  open_orders: { id: string; number_label: string; due_minor: string }[];
  stale_hours: number;
  created?: Payment;
  payment?: Payment;
}

const When = ({ iso }: { iso: string }) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const yest = new Date(Date.now() - 86_400_000).toDateString() === d.toDateString();
  const { day, month } = dayMonth(iso);
  return (
    <>
      {sameDay ? (
        "اليوم"
      ) : yest ? (
        "أمس"
      ) : (
        <>
          <span className="sting-mono">{day}</span> {month}
        </>
      )}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** ORD-13 — إثبات دفع ومتابعة المطابقة (10-D6 stale · 41-D33 ready/validation_error/partial/success): الإيصال ليس تحصيلاً. */
export function PaymentClient({ id }: { id: string }) {
  const router = useRouter();
  const app = useApp();
  const [p, setP] = useState<Payload | null>(null);
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [split, setSplit] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<{ code: string; extra: Record<string, string> } | null>(null);
  const [created, setCreated] = useState<Payment | null>(null);
  const [matched, setMatched] = useState<Payment | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/{order_id}/payments", {
      params: { path: { order_id: id } },
    });
    if (response.status === 404) {
      router.replace(`/market/orders/${id}`);
      return;
    }
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) {
      setP(body);
      setAmount((cur) => cur || body.due_minor);
    }
  }, [id, router]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/market/orders/${id}/payment`)}`);
      return;
    }
    void load().catch(() => undefined);
  }, [router, id, load]);

  const submit = async () => {
    if (busy) return;
    setBusy("record");
    setErr(null);
    try {
      const allocations = split
        ? Object.entries(alloc)
            .filter(([, v]) => Number(v || 0) > 0)
            .map(([order_id, v]) => ({ order_id, amount_minor: v }))
        : [];
      const r = await api().POST("/api/market/orders/{order_id}/payments", {
        params: { path: { order_id: id } },
        body: { amount_minor: amount, transfer_ref: ref, transferred_on: on, allocations } as never,
      });
      const b = (r.data ?? r.error) as unknown as
        Payload | { detail?: string; extra?: Record<string, unknown> } | undefined;
      if (r.response.ok && b && "payments" in b) {
        setP(b);
        setCreated(b.created ?? null);
      } else {
        const e = b as { detail?: string; extra?: Record<string, unknown> } | undefined;
        const extra: Record<string, string> = {};
        for (const [k, v] of Object.entries(e?.extra ?? {}))
          extra[k] = typeof v === "string" ? v : "";
        setErr({ code: e?.detail ?? "server_error", extra });
      }
    } finally {
      setBusy("");
    }
  };

  const act = async (pay: Payment, action: "match" | "reject" | "remind") => {
    if (busy) return;
    setBusy(`${action}:${pay.id}`);
    try {
      const r = await api().POST("/api/market/orders/{order_id}/payments/{payment_id}/{action}", {
        params: { path: { order_id: id, payment_id: pay.id, action } },
        body: {} as never,
      });
      const b = r.data as unknown as Payload | undefined;
      if (r.response.ok && b) {
        setP(b);
        if (action === "match" && b.payment) setMatched(b.payment);
      }
    } finally {
      setBusy("");
    }
  };

  const stalePay = (p?.payments ?? []).find((x) => x.stale) ?? null;
  const splitPay = (p?.payments ?? []).find((x) => x.allocations.length > 1) ?? null;
  const state: State = matched
    ? "success"
    : err
      ? "validation_error"
      : created && created.allocations.length > 1
        ? "partial"
        : stalePay && !created && p?.side === "buyer"
          ? "stale"
          : splitPay && !created
            ? "partial"
            : "ready";
  const openAlloc = p?.open_orders ?? [];
  const allocTotal = Object.values(alloc).reduce((a, v) => a + Number(v || 0), 0);

  return (
    <Frame
      title="السوق"
      nav={<AppNav currentId={p?.side === "supplier" ? "market-incoming" : "market-orders"} />}
      footer={null}
    >
      <div className="sys mp cus" data-screen="ORD-13" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">إثبات الدفع — الإيصال ليس تحصيلاً</h2>
            <span className="cat-head__hint">
              ACC-133: رفع صورة الحوالة لا يُسدِّد ذمة. الذمة تُخفض عند تأكيد المورد وصول المبلغ.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && matched ? (
              <Notice
                kind="success"
                title="طابَق المورد الدفعة"
                action={
                  <Button onClick={() => router.push(`/market/orders/${id}`)}>تفاصيل الطلب</Button>
                }
              >
                <p className="acc-lead">
                  الذمّة نقصت عند المطابقة، والكشف يُظهر التاريخين: تاريخ التحويل وتاريخ المطابقة.
                  التحويل <span className="sting-mono">{dm(matched.transferred_on)}</span> ·
                  المطابقة <span className="sting-mono">{dm(matched.matched_at)}</span>.
                </p>
                <p className="acc-choice__note">
                  <strong>تاريخان لا واحد</strong> · المهلة بينهما هي ما يُتنازع عليه عادةً.
                  إظهارهما يُغني عن الجدال.
                </p>
              </Notice>
            ) : null}
            {state === "validation_error" && err ? (
              <Notice kind="warning" title="مبلغ مخالف أو تحويل مستهلك">
                <p className="acc-lead">
                  {err.code === "reference_used"
                    ? `الإيصال نفسه استُخدم في طلب سابق (${err.extra.order_number_label ?? ""} · ${err.extra.payment ?? ""}).`
                    : err.code === "amount_mismatch"
                      ? `المبلغ ${formatMinor(err.extra.amount_minor ?? "0")} يخالف المستحقّ ${formatMinor(err.extra.due_minor ?? "0")} بلا بيان.`
                      : err.code === "allocation_mismatch"
                        ? `مجموع التوزيع ${formatMinor(err.extra.allocated_minor ?? "0")} لا يساوي المبلغ ${formatMinor(err.extra.amount_minor ?? "0")}.`
                        : "تعذّر تسجيل الإيصال."}
                </p>
                <p className="acc-choice__note">
                  <strong>لا استخدام مكرر</strong> · مرجع التحويل يُطابَق مرة واحدة (ACC-15). والفرق
                  عن المستحقّ يُقبل بتوزيعٍ مشروع لا بالسكوت.
                </p>
              </Notice>
            ) : null}
            {state === "partial" ? (
              <Notice kind="info" title="دفعة على طلبين">
                <p className="acc-lead">تحويلٌ واحد يغطي طلبين — والتوزيع صريح يُدخله المستخدم.</p>
                <p className="acc-choice__note">
                  <strong>لا توزيع تلقائي</strong> · توزيعُ الدفعة على الأقدم افتراضاً يُنتج أعماراً
                  وأرصدةً لم يقصدها أحد (G-15). من يدفع يقول على ماذا.
                </p>
              </Notice>
            ) : null}
            {state === "stale" && stalePay && p ? (
              <>
                <div className="acc-actions">
                  <Status state="stale" label="بيانات قديمة" />
                </div>
                <h3 className="cat-head__title">تحويل بنكي إلى {p.order.supplier_name}</h3>
                <p className="acc-choice__note">
                  مرفوع <When iso={stalePay.uploaded_at} /> · على الطلب{" "}
                  <span className="sting-mono">{p.order.number_label}</span>
                </p>
                <Notice kind="warning" title="أثر هذا الإيصال على دفترك — الآن">
                  <p className="acc-lead">
                    لم يؤكد المورد بعد، ومضت{" "}
                    <span className="sting-mono">{stalePay.hours_since_upload}</span> ساعة.
                  </p>
                  <p className="acc-choice__note">
                    لن نخفض ذمتك من طرف واحد لأن الرقم حينها يصبح رأيك في وضعك المالي لا حقيقته،
                    فتجد نفسك تطلب بضاعة على رصيد لم يصل. الإيصال محفوظ ومؤرَّخ وهو دليلك عند
                    المطالبة.
                  </p>
                  {p.side === "buyer" ? (
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy === `remind:${stalePay.id}`}
                        onClick={() => void act(stalePay, "remind")}
                      >
                        تذكير المورد بالمطابقة
                      </Button>
                      <Button
                        onClick={() =>
                          setP((c) =>
                            c
                              ? {
                                  ...c,
                                  payments: c.payments.map((x) =>
                                    x.id === stalePay.id ? { ...x, stale: false } : x,
                                  ),
                                }
                              : c,
                          )
                        }
                      >
                        رفع إيصال أوضح
                      </Button>
                    </div>
                  ) : null}
                </Notice>
                <ul className="cus-list">
                  <li>
                    <strong>رفعتَ إيصال التحويل</strong>
                    <div className="cus-sub">
                      الصورة محفوظة ومؤرَّخة ومربوطة بالطلب. هذا فعلك ودليلك.
                    </div>
                    <Status state="success" label="تم" />
                    <span className="mp-check__hint">
                      <When iso={stalePay.uploaded_at} />
                    </span>
                  </li>
                  <li>
                    <strong>مطابقة المورد</strong>
                    <div className="cus-sub">يؤكد وصول المبلغ إلى حسابه. هو وحده يراه في بنكه.</div>
                    <Status state="stale" label="بانتظار" />
                    <span className="mp-check__hint">
                      مضت <span className="sting-mono">{stalePay.hours_since_upload}</span> ساعة
                    </span>
                  </li>
                  <li>
                    <strong>خفض الذمة</strong>
                    <div className="cus-sub">
                      يقع عند المطابقة لا عند الرفع. حتى ذلك الحين رصيدك كما هو.
                    </div>
                    <Status state="saved_local" label="لم يحدث" />
                  </li>
                </ul>
                <div className="home-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">ذمتك للمورد</div>
                    <div className="home-kpi__value sting-mono">{formatMinor(p.due_minor)}</div>
                    <div className="home-kpi__note">لم تتغيّر بالرفع</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">قيمة الإيصال المرفوع</div>
                    <div className="home-kpi__value sting-mono">
                      {formatMinor(stalePay.amount_minor)}
                    </div>
                    <div className="home-kpi__note">مسجَّل كإثبات لا كسداد</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">الرصيد بعد المطابقة — متوقع</div>
                    <div className="home-kpi__value sting-mono">
                      {formatMinor(
                        String(Math.max(0, Number(p.due_minor) - Number(stalePay.amount_minor))),
                      )}
                    </div>
                    <div className="home-kpi__note">يُطبَّق عند تأكيد المورد لا قبله</div>
                  </div>
                </div>
              </>
            ) : null}

            {p && state !== "stale" && !matched ? (
              <>
                <div className="home-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">المستحقّ الآن — من المستلَم وحده</div>
                    <div className="home-kpi__value sting-mono">{formatMinor(p.due_minor)}</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">مطابَق حتى الآن</div>
                    <div className="home-kpi__value sting-mono">{formatMinor(p.paid_minor)}</div>
                  </div>
                </div>
                {p.payments.length ? (
                  <ul className="cus-list">
                    {p.payments.map((pay) => (
                      <li key={pay.id}>
                        <strong className="sting-mono">{pay.ref_label}</strong>
                        <div className="cus-sub">
                          <span className="sting-mono">{formatMinor(pay.amount_minor)}</span> · مرجع{" "}
                          <span className="sting-mono">{pay.transfer_ref}</span> · تاريخ التحويل{" "}
                          <span className="sting-mono">{dm(pay.transferred_on)}</span>
                          {pay.matched_at ? (
                            <>
                              {" "}
                              · تاريخ المطابقة{" "}
                              <span className="sting-mono">{dm(pay.matched_at)}</span>
                            </>
                          ) : null}
                          {pay.allocations.length > 1
                            ? ` · موزَّع: ${pay.allocations.map((a) => `${a.number_label} ${formatMinor(a.amount_minor)}`).join(" · ")}`
                            : ""}
                        </div>
                        <Status
                          state={
                            pay.status === "matched"
                              ? "success"
                              : pay.status === "rejected"
                                ? "expired"
                                : "stale"
                          }
                          label={pay.status_label}
                        />
                        {p.side === "supplier" && pay.status === "recorded" ? (
                          <div className="acc-actions">
                            <Button
                              pos
                              loading={busy === `match:${pay.id}`}
                              onClick={() => void act(pay, "match")}
                            >
                              طابِق — وصل المبلغ
                            </Button>
                            <Button
                              loading={busy === `reject:${pay.id}`}
                              onClick={() => void act(pay, "reject")}
                            >
                              لم يصل
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {p.side === "buyer" ? (
                  <>
                    <h3 className="cat-head__title">إيصال مرفوع بحالته</h3>
                    <p className="acc-choice__note">
                      صورة التحويل ومبلغه وتاريخه، وشارة «مسجَّل — غير مطابق» حتى يُقرّ المورد.{" "}
                      <strong>الرفع لا يُسدّد</strong> · الذمّة لا تنقص برفع إيصال (ACC-133). من يرى
                      رصيده ناقصاً بمجرد الرفع يحسب نفسه بريئاً وهو مطالَب.
                    </p>
                    <TextField
                      label="المبلغ (بالقرش)"
                      kind="number"
                      mono
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <TextField
                      label="مرجع التحويل"
                      mono
                      value={ref}
                      onChange={(e) => setRef(e.target.value)}
                    />
                    <TextField
                      label="تاريخ التحويل"
                      kind="date"
                      mono
                      value={on}
                      onChange={(e) => setOn(e.target.value)}
                    />
                    {openAlloc.length ? (
                      <div className="acc-actions">
                        <Button
                          variant={split ? "secondary" : "quiet"}
                          onClick={() => setSplit((v) => !v)}
                        >
                          {split ? "توزيع صريح — مفعَّل" : "تحويل واحد على طلبين؟ وزّعه صراحةً"}
                        </Button>
                      </div>
                    ) : null}
                    {split ? (
                      <>
                        <TextField
                          label={`على هذا الطلب ${p.order.number_label}`}
                          kind="number"
                          mono
                          value={alloc[id] ?? ""}
                          onChange={(e) => setAlloc((c) => ({ ...c, [id]: e.target.value }))}
                        />
                        {openAlloc.map((o) => (
                          <TextField
                            key={o.id}
                            label={`على ${o.number_label} (مستحقّه ${formatMinor(o.due_minor)})`}
                            kind="number"
                            mono
                            value={alloc[o.id] ?? ""}
                            onChange={(e) => setAlloc((c) => ({ ...c, [o.id]: e.target.value }))}
                          />
                        ))}
                        <p className="acc-choice__note">
                          مجموع التوزيع{" "}
                          <span className="sting-mono">{formatMinor(String(allocTotal))}</span> من{" "}
                          <span className="sting-mono">{formatMinor(amount || "0")}</span>
                        </p>
                      </>
                    ) : null}
                    <div className="acc-actions">
                      <Button
                        pos
                        loading={busy === "record"}
                        onClick={() => void submit()}
                        disabledReason={
                          !ref.trim() ? "مرجع التحويل مطلوب" : !amount ? "المبلغ مطلوب" : undefined
                        }
                      >
                        ارفع الإيصال — مسجَّل لا مسدَّد
                      </Button>
                    </div>
                    {created ? (
                      <Status
                        state="stale"
                        label={`${created.ref_label} · ${created.status_label}`}
                      />
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
