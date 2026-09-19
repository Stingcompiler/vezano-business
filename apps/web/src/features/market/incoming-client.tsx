"use client";

import { Button, Frame, Notice, Status, Table } from "@sting/ui-web";
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

type State = "loading" | "ready" | "empty" | "expired";
type Chip = "all" | "awaiting" | "near" | "no_reply";

interface Payload {
  orders: OrderRow[];
  counts: { all: number; awaiting: number; near: number; no_reply: number };
  ending_today: number;
  fetched_at: string;
}

const dm = (iso: string) => {
  const { day, month } = dayMonth(iso);
  const [y, m] = iso.slice(0, 10).split("-");
  return { day, month, short: `${day}/${m ?? ""}`, year: y ?? "" };
};
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const agoDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

function Deadline({ o }: { o: OrderRow }) {
  if (o.no_reply) {
    const d = agoDays(o.deadline_at);
    return (
      <>
        انقضت{" "}
        {d === 0 ? (
          <>
            اليوم <span className="sting-mono">{hhmm(o.deadline_at)}</span>
          </>
        ) : d === 1 ? (
          "قبل يوم"
        ) : d === 2 ? (
          "قبل يومين"
        ) : (
          <>
            قبل <span className="sting-mono">{d}</span> {d <= 10 ? "أيام" : "يوماً"}
          </>
        )}
      </>
    );
  }
  if (o.status === "quoted")
    return (
      <>
        رُدّ عليه <span className="sting-mono">{dm(o.updated_at).short}</span>
      </>
    );
  if (o.status !== "sent") return <>—</>;
  if (isToday(o.deadline_at))
    return (
      <>
        تنقضي اليوم <span className="sting-mono">{hhmm(o.deadline_at)}</span>
      </>
    );
  return (
    <>
      متبقٍّ <span className="sting-mono">{o.remaining_hours}</span> من{" "}
      <span className="sting-mono">{o.response_hours}</span> ساعة
    </>
  );
}

/** ORD-04 — طلبات المورد (27-D20 ready/expired · 41-D33 loading · 12-D7 empty): المهلة تنقضي، وعدم الرد حالة لا فراغ. */
export function IncomingClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [chip, setChip] = useState<Chip>("all");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, response } = await api().GET("/api/market/orders/incoming");
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) setData(body);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Forders%2Fincoming");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const rows = (data?.orders ?? []).filter((o) =>
    chip === "all"
      ? true
      : chip === "awaiting"
        ? o.status === "sent" && !o.no_reply
        : chip === "near"
          ? o.near_deadline
          : o.no_reply,
  );
  const state: State = !data
    ? "loading"
    : data.orders.length === 0
      ? "empty"
      : data.counts.no_reply
        ? "expired"
        : "ready";

  const columns = [
    {
      key: "buyer",
      header: "الطلب والمشتري",
      render: (o: OrderRow) => (
        <>
          <strong>{o.buyer_name}</strong>
          <div className="mp-check__hint">
            <span className="sting-mono">{o.number_label}</span> · {o.kind_label}
          </div>
        </>
      ),
    },
    {
      key: "content",
      header: "المحتوى",
      render: (o: OrderRow) =>
        o.kind === "quote" ? `طلب سعر — ${o.content_line}` : o.content_line,
    },
    { key: "deadline", header: "المهلة", render: (o: OrderRow) => <Deadline o={o} /> },
    {
      key: "status",
      header: "الحالة والإجراء",
      render: (o: OrderRow) => (
        <>
          <Status
            state={
              o.no_reply
                ? "expired"
                : o.near_deadline
                  ? "stale"
                  : o.status === "quoted"
                    ? "success"
                    : "partial"
            }
            label={
              o.no_reply
                ? "لم يُرد عليه"
                : o.near_deadline
                  ? "مهلة قاربت"
                  : o.status === "quoted"
                    ? "رُدّ عليه"
                    : o.status === "sent"
                      ? "بانتظار ردّك"
                      : o.status_label
            }
          />
          <div className="mp-check__hint">{o.supplier_step}</div>
        </>
      ),
    },
  ];

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-incoming" />} footer={null}>
      <div className="sys mp cus" data-screen="ORD-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">طلبات المورد — المهلة تنقضي، وعدم الرد حالة لا فراغ</h2>
            <span className="cat-head__hint">
              شاشة المورد الواردة: كل طلب بمهلة رد ظاهرة. انقضاء المهلة يُوسم «لم يُرد عليه» صراحةً
              عند الطرفين، ولا يُقرأ قبولاً ولا رفضاً.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الطلبات الواردة">
                <p className="acc-lead">
                  مع عدد المهل التي تنتهي اليوم، والترتيب بالمهلة لا بتاريخ الورود.
                </p>
                <p className="acc-choice__note">
                  <strong>المهلة هي العمل</strong> · الطلب بلا رد ضررٌ على الطرفين: المشتري ينتظر
                  والمورد يخسر. القائمة تُرتَّب بما يحرق.
                </p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا طلبات بيع بعد">
                <p className="acc-lead">
                  قائمة البيع تعرض ما يصلك من مشترين. تبقى فارغة حتى تُفعّل دور البائع وتنشر أول عرض
                  — MP-08
                </p>
                <p className="acc-choice__note">
                  الفراغ هنا ليس عطلاً: أنت مشترٍ ولم تصبح بائعاً بعد.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/market/seller")}>تهيئة البائع</Button>
                  <Button variant="quiet" onClick={() => router.push("/market/orders")}>
                    قائمة الشراء
                  </Button>
                </div>
              </Notice>
            ) : null}
            {data && data.orders.length ? (
              <>
                {state === "expired" ? (
                  <Notice kind="warning" title="مهلة منقضية">
                    <p className="acc-lead">
                      {data.counts.no_reply === 1 ? "طلب" : `${data.counts.no_reply} طلبات`} انقضت
                      مهلته بلا رد. لا نحوّله إلى «مرفوض» — الرفض قرار، وعدم الرد ليس قراراً.
                      المشتري يرى «لم يُرد عليه» مع خيار إعادة الإرسال أو التوجّه لمورد آخر، والمورد
                      يرى الطلب في أرشيف مستقلّ لا في المهملات.
                    </p>
                  </Notice>
                ) : null}
                <div className="acc-choice__head">
                  <strong>
                    الطلبات الواردة — <span className="sting-mono">{data.counts.all}</span>
                  </strong>
                  <span className="acc-choice__note">
                    تنتهي اليوم: <span className="sting-mono">{data.ending_today}</span> · الأقرب
                    انقضاءً في الأعلى
                  </span>
                </div>
                <div className="pos-chips" role="group" aria-label="المهلة">
                  {(
                    [
                      ["all", "الكل", data.counts.all],
                      ["awaiting", "بانتظار ردّي", data.counts.awaiting],
                      ["near", "مهلة قاربت", data.counts.near],
                      ["no_reply", "لم يُرد عليه", data.counts.no_reply],
                    ] as const
                  ).map(([k, label, n]) => (
                    <button
                      key={k}
                      type="button"
                      className={`pos-chip${chip === k ? " pos-chip--on" : ""}`}
                      onClick={() => setChip(k)}
                    >
                      {label} — <span className="sting-mono">{n}</span>
                    </button>
                  ))}
                </div>
                <Table
                  caption="الطلبات الواردة"
                  columns={columns}
                  rows={rows}
                  rowKey={(o) => o.id}
                  onOpenRow={(o) => router.push(`/market/orders/${o.id}`)}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
