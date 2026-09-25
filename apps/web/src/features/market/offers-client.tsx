"use client";

import { Button, formatMinor, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./market.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "empty" | "expired";

export interface Offer {
  id: string;
  item_id: string;
  public_name: string;
  description: string;
  unit_code: string;
  unit_name: string;
  pack_label: string;
  price_minor: string;
  audience: "public" | "private" | "followers";
  audience_label: string;
  min_order_qty: number | null;
  max_order_qty: number | null;
  fulfilment_note: string;
  valid_until: string;
  status: "draft" | "published" | "expired" | "hidden";
  status_label: string;
  meaning: string;
  missing: { key: string; title: string; hint: string }[];
}

interface List {
  offers: Offer[];
  counts: Record<"published" | "draft" | "expired" | "hidden", number>;
  total: number;
  expiring_this_week: number;
  can_edit: boolean;
  can_publish: boolean;
  seller_verified: boolean;
  plan_allows: boolean;
}

const STATUS_STATE = {
  published: "success",
  draft: "ready",
  expired: "expired",
  hidden: "stale",
} as const;

/** MP-10 — عروض البائع الداخلية: أربع حالات لا حالتان (29-D22 ready/expired · 43-D35 loading · 12-D7 empty). */
export function OffersClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<List | null>(null);
  const [filter, setFilter] = useState<"all" | Offer["status"]>("all");
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fmarket%2Foffers");
      return;
    }
    void api()
      .GET("/api/market/offers")
      .then(({ data, response }) => {
        const body = data as unknown as List | undefined;
        if (response.ok && body) setData(body);
      })
      .catch(() => undefined);
  }, [router]);

  const offers = (data?.offers ?? []).filter((o) => filter === "all" || o.status === filter);
  const state: State = !data
    ? "loading"
    : data.total === 0
      ? "empty"
      : filter === "expired"
        ? "expired"
        : "ready";

  const columns = [
    {
      key: "offer",
      header: "العرض",
      render: (o: Offer) => (
        <>
          <strong>{o.public_name}</strong>
          {o.pack_label ? <div className="mp-check__hint">{o.pack_label}</div> : null}
        </>
      ),
    },
    {
      key: "price",
      header: "السعر والوحدة",
      mono: true,
      render: (o: Offer) => (o.price_minor ? formatMinor(o.price_minor) : "—"),
    },
    { key: "audience", header: "الجمهور", render: (o: Offer) => o.audience_label },
    {
      key: "status",
      header: "الحالة ومعناها للمشتري",
      render: (o: Offer) => (
        <>
          <Status state={STATUS_STATE[o.status]} label={o.status_label} />
          <div className="mp-check__hint">{o.meaning}</div>
        </>
      ),
    },
  ];

  const Chip = ({ id, label, n }: { id: typeof filter; label: string; n?: number }) => (
    <button
      type="button"
      className={`pos-chip${filter === id ? " pos-chip--on" : ""}`}
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
    >
      {label}
      {typeof n === "number" ? (
        <>
          {" — "}
          <span className="sting-mono">{n}</span>
        </>
      ) : null}
    </button>
  );

  return (
    <Frame title="السوق" nav={<AppNav currentId="market-offers" />} footer={null}>
      <div className="sys mp" data-screen="MP-10" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">عروض البائع الداخلية — أربع حالات لا حالتان</h2>
            <span className="cat-head__hint">
              منشور، مسودة، منتهٍ، مخفي. «المخفي» ليس محذوفاً و«المنتهي» ليس مخفياً — والخلط بينها
              يجعل البائع يظنّ عرضاً يبيع وهو لا يظهر لأحد.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="acc-choice__head">
              <strong>
                عروضي — <span className="sting-mono">{data?.total ?? 0}</span>
              </strong>
              {data?.can_edit ? (
                <Button pos onClick={() => router.push("/market/offers/new")}>
                  عرض جديد
                </Button>
              ) : null}
            </div>

            {state === "loading" ? (
              <Notice kind="info" title="جلب عروضك">
                <p className="acc-lead">
                  مع عدد ما تنتهي صلاحيته هذا الأسبوع — وهو سبب فتح الشاشة، والترتيب به لا بتاريخ
                  النشر.
                </p>
                <p className="acc-choice__note">
                  <strong>الانتهاء هو العمل</strong> · عرضٌ منتهٍ يختفي من نتائج المشترين بصمت.
                  العدّاد يجعل الفقد المؤجَّل مرئياً قبل وقوعه.
                </p>
              </Notice>
            ) : null}

            {data ? (
              <>
                {data.expiring_this_week ? (
                  <p className="acc-lead">
                    ينتهي هذا الأسبوع: <span className="sting-mono">{data.expiring_this_week}</span>{" "}
                    — الترتيب به لا بتاريخ النشر.
                  </p>
                ) : null}
                <div className="pos-chips" role="group" aria-label="الحالة">
                  <Chip id="all" label="الكل" n={data.total} />
                  <Chip id="published" label="منشور" n={data.counts.published} />
                  <Chip id="draft" label="مسودة" n={data.counts.draft} />
                  <Chip id="expired" label="منتهٍ" n={data.counts.expired} />
                  <Chip id="hidden" label="مخفي" n={data.counts.hidden} />
                </div>
              </>
            ) : null}

            {state === "empty" ? (
              <Notice kind="empty" title="لا عروض بعد">
                <p className="acc-lead">
                  النشر اختيار صنف صنف مع جمهوره وسعره وصلاحيته. من ينشر ٦٤٠ صنفاً بضغطة يكشف كلفته
                  وتوفّره لمنافسيه بلا أن يقصد.
                </p>
                {!data?.seller_verified ? (
                  <p className="acc-choice__note">النشر بعد اعتماد دور البائع.</p>
                ) : null}
              </Notice>
            ) : null}

            {data && offers.length ? (
              <Table
                caption="عروضي"
                columns={columns}
                rows={offers}
                rowKey={(o) => o.id}
                onOpenRow={(o) => router.push(`/market/offers/${o.id}`)}
              />
            ) : null}

            {data && data.total ? (
              <p className="acc-choice__note">
                <strong>لا زرّ «نشر كل المخزون».</strong> النشر اختيار صنف صنف مع جمهوره وسعره
                وصلاحيته. من ينشر ٦٤٠ صنفاً بضغطة يكشف كلفته وتوفّره لمنافسيه بلا أن يقصد.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
