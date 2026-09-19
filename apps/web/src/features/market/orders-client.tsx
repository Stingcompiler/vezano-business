"use client";

import { Button, formatMinor, Frame, Notice, Status, Table } from "@sting/ui-web";
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
import { agoParts, hhmm } from "@/features/home/format";
import { readCart } from "@/features/market/cart-store";
import type { Order } from "@/features/market/checkout-client";
import { readSnapshot, writeSnapshot } from "@/features/market/market-store";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";

type State = "loading" | "ready" | "empty" | "stale" | "pending_sync";

export interface OrderRow extends Order {
  no_reply: boolean;
  near_deadline: boolean;
  remaining_hours: number;
  content_line: string;
  buyer_step: string;
  supplier_step: string;
  flagged: boolean;
  list_status_label: string;
  buyer_name: string;
  shipped_percent?: number;
  remaining_cancelled?: boolean;
  cancel_reason?: string;
  reconciling?: boolean;
  restore_point?: string;
  paid_minor?: string;
}

interface Payload {
  orders: OrderRow[];
  awaiting_count: number;
  hidden_by_filter: number;
  fetched_at: string;
}

interface Row {
  id: string;
  party: string;
  number: string;
  content: string;
  value: string;
  currency: string;
  status: string;
  chip: "success" | "stale" | "expired" | "conflict" | "saved_local" | "partial";
  step: string;
  updated: string;
  flagged: boolean;
  draft: boolean;
  noReply: boolean;
}

const SNAP = "market.orders";
const ordersWord = (n: number) =>
  n === 1 ? "طلب واحد" : n === 2 ? "طلبان" : n <= 10 ? `${n} طلبات` : `${n} طلباً`;
const agoWord = (iso: string) => {
  const { n, unit } = agoParts(iso);
  if (unit === "minute")
    return n <= 1
      ? "قبل دقيقة"
      : n === 2
        ? "قبل دقيقتين"
        : n <= 10
          ? `قبل ${n} دقائق`
          : `قبل ${n} دقيقة`;
  if (unit === "hour")
    return n === 1
      ? "قبل ساعة"
      : n === 2
        ? "قبل ساعتين"
        : n <= 10
          ? `قبل ${n} ساعات`
          : `قبل ${n} ساعة`;
  return n === 1 ? "قبل يوم" : n === 2 ? "قبل يومين" : n <= 10 ? `قبل ${n} أيام` : `قبل ${n} يوماً`;
};

const chipOf = (o: OrderRow): Row["chip"] =>
  o.no_reply
    ? "expired"
    : o.status === "disputed"
      ? "conflict"
      : o.status === "cancelled" || o.status === "rejected"
        ? "expired"
        : o.status === "sent" || o.status === "quoted"
          ? "stale"
          : o.status === "received"
            ? "success"
            : "partial";

/** ORD-03 — طلبات المشتري (41-D33 loading/empty/stale · 12-D7 ready/pending_sync): الفلتر يُعلن ما يُخفي، ولا «إجمالي كل الطلبات». */
export function OrdersClient() {
  const router = useRouter();
  const online = useOnline();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [snapshot, setSnapshot] = useState<{ at: string; data: Payload } | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"all" | "open">("open");
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data, response } = await api().GET("/api/market/orders");
      const body = data as unknown as Payload | undefined;
      if (response.ok && body) {
        setData(body);
        writeSnapshot(SNAP, body);
        setSnapshot({ at: new Date().toISOString(), data: body });
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Forders");
      return;
    }
    setSnapshot(readSnapshot<Payload>(SNAP));
    const cart = readCart();
    const bySeller = new Map<string, { name: string; count: number; priced: boolean }>();
    for (const l of cart.lines) {
      const g = bySeller.get(l.seller_tenant_id) ?? { name: l.seller_name, count: 0, priced: true };
      g.count += 1;
      if (!l.price_minor) g.priced = false;
      bySeller.set(l.seller_tenant_id, g);
    }
    setDrafts(
      [...bySeller.entries()].map(([sid, g]) => ({
        id: `draft-${sid}`,
        party: g.name,
        number: "",
        content: g.priced
          ? `مسودة محلية · ${g.count === 1 ? "بند واحد" : g.count === 2 ? "بندان" : `${g.count} بنود`} · لا رقم طلب`
          : "مسودة محلية بلا سعر محمَّل · لا رقم طلب",
        value: "",
        currency: "",
        status: "مسودة",
        chip: "saved_local",
        step: "راجع وأرسل من السلة (ORD-01)",
        updated: cart.at,
        flagged: false,
        draft: true,
        noReply: false,
      })),
    );
    void load();
  }, [router, load]);

  const resend = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await api().POST("/api/market/orders/{order_id}/resend", {
        params: { path: { order_id: id } },
        body: {} as never,
      });
      await load();
    } finally {
      setBusy("");
    }
  };

  const shown = data ?? (failed || !online ? (snapshot?.data ?? null) : null);
  const serverRows: Row[] = (shown?.orders ?? []).map((o) => ({
    id: o.id,
    party: o.supplier_name,
    number: o.number_label,
    content: o.content_line,
    value: o.total_minor,
    currency: o.currency,
    status: o.list_status_label,
    chip: chipOf(o),
    step: o.buyer_step,
    updated: o.updated_at,
    flagged: o.flagged,
    draft: false,
    noReply: o.no_reply,
  }));
  const hiddenCount =
    filter === "open" && !showHidden ? serverRows.filter((r) => r.flagged).length : 0;
  const visible = [
    ...drafts,
    ...serverRows.filter((r) => filter === "all" || showHidden || !r.flagged),
  ];
  const state: State =
    !shown && !failed && online
      ? "loading"
      : (!online || failed) && shown
        ? "stale"
        : shown && shown.orders.length === 0 && drafts.length === 0
          ? "empty"
          : drafts.length
            ? "pending_sync"
            : "ready";

  const columns = [
    {
      key: "party",
      header: "الطلب والطرف",
      render: (r: Row) => (
        <>
          <strong>{r.party}</strong>
          <div className="mp-check__hint">
            {r.number ? (
              <>
                <span className="sting-mono">{r.number}</span> ·{" "}
              </>
            ) : null}
            {r.content}
          </div>
        </>
      ),
    },
    {
      key: "value",
      header: "القيمة",
      render: (r: Row) =>
        r.value ? (
          <>
            <span className="sting-mono">{formatMinor(r.value)}</span>{" "}
            <span className="sting-mono">{r.currency}</span>
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "status",
      header: "الحالة الحقيقية",
      render: (r: Row) => (
        <>
          <Status state={r.chip} label={r.status} />
          <div className="mp-check__hint">
            {r.updated ? (
              <>
                {agoWord(r.updated)} · <span className="sting-mono">{hhmm(r.updated)}</span>
              </>
            ) : null}
            {r.flagged ? " · يظهر رغم الفلتر بإعلان" : ""}
          </div>
        </>
      ),
    },
    {
      key: "step",
      header: "الخطوة التي تنتظرك",
      render: (r: Row) => (
        <>
          {r.step}
          {r.noReply ? (
            <div>
              <Button loading={busy === r.id} onClick={() => void resend(r.id)}>
                أعد الإرسال
              </Button>
            </div>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-orders" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">قوائم الطلبات — الفلتر يُعلن ما يُخفي</h2>
            <span className="cat-head__hint">
              طلب محل خلاف أو معلَّق بعد استعادة لا يختفي من القائمة بصمت: يظهر عدده ومكان إظهاره.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="acc-actions">
              <Button variant="secondary" onClick={() => router.push("/market/orders")}>
                قائمة الشراء
              </Button>
              <Button variant="quiet" onClick={() => router.push("/market/orders/incoming")}>
                قائمة البيع
              </Button>
            </div>
            <div className="pos-chips" role="group" aria-label="الحالة">
              <button
                type="button"
                className={`pos-chip${filter === "open" ? " pos-chip--on" : ""}`}
                onClick={() => setFilter("open")}
              >
                الحالة: قائمة
              </button>
              <button
                type="button"
                className={`pos-chip${filter === "all" ? " pos-chip--on" : ""}`}
                onClick={() => setFilter("all")}
              >
                الكل
              </button>
            </div>
            {hiddenCount ? (
              <p className="acc-choice__note">
                <strong>
                  الفلتر يُخفي <span className="sting-mono">{hiddenCount}</span>
                </strong>{" "}
                · فلتر «قائمة» يستثني {ordersWord(hiddenCount)} محل خلاف أو معلَّقة بعد استعادة. لن
                نُخفيها بلا ذكر —{" "}
                <Button variant="quiet" onClick={() => setShowHidden(true)}>
                  أظهرها
                </Button>
              </p>
            ) : null}
            {shown ? (
              <p className="acc-choice__note">
                طلباتي · ينتظر ردّاً: <span className="sting-mono">{shown.awaiting_count}</span>
              </p>
            ) : null}

            {state === "loading" ? (
              <Notice kind="info" title="جلب الطلبات">
                <p className="acc-lead">مع عدد ما ينتظر ردّاً — أول ما يُبحث عنه.</p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا طلبات">
                <p className="acc-lead">منشأةٌ لم تشترِ من السوق بعد.</p>
                <p className="acc-choice__note">
                  <strong>المسار</strong> · مدخل السوق (MP-01). والفراغ هنا بدايةٌ لا عطب — الشراء
                  المحلي قائمٌ بلا سوق.
                </p>
                <div className="acc-actions">
                  <Button pos onClick={() => router.push("/market")}>
                    السوق
                  </Button>
                </div>
              </Notice>
            ) : null}
            {state === "stale" && snapshot ? (
              <Notice kind="warning" title="حالات من آخر مطابقة">
                <p className="acc-lead">{agoWord(snapshot.at)}، وقد شُحن طلبٌ أو انتهت مهلة عرض.</p>
                <p className="acc-choice__note">
                  <strong>الوقت مع كل صفّ</strong> · لا في الترويسة وحدها. «مؤكَّد» عمرها ساعة قد
                  تكون «مشحون» الآن، ومن يقرأها يقرّر نقلاً.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => void load()}>حدّث</Button>
                </div>
              </Notice>
            ) : null}
            {state === "pending_sync" ? (
              <Notice kind="info" title="جزئي">
                <p className="acc-lead">
                  مسودة محلية بلا رقم طلب — الرقم يعني أن المورد استلم، وهو لم يستلم بعد.
                </p>
              </Notice>
            ) : null}

            {visible.length ? (
              <Table
                caption="طلباتي"
                columns={columns}
                rows={visible}
                rowKey={(r) => r.id}
                onOpenRow={(r) => router.push(r.draft ? "/market/cart" : `/market/orders/${r.id}`)}
              />
            ) : null}
            {shown ? (
              <p className="acc-choice__note">
                لا عمود «إجمالي كل الطلبات»: جمع قيم طلبات بحالات مختلفة — منها ما هو محل خلاف وما
                هو ملغى جزئياً — يُنتج رقماً لا يصف شيئاً. الإجماليات في REP-03 بمقاماتها.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
