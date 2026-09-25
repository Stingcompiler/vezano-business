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
import "./purchasing.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "empty" | "permission_denied";

export interface OrderRow {
  id: string;
  number: string;
  supplier_id: string;
  supplier_name: string;
  status: string;
  status_label: string;
  status_hint: string;
  items_summary: string;
  lines_count: number;
  estimated_total_minor: string;
  value_hidden: boolean;
  created_by_name: string;
  created_at: string;
  sent_at: string;
  cancelled_reason: string;
}

interface Payload {
  orders: OrderRow[];
  open_count: number;
  closed_count: number;
  scope: string;
  supplier_id: string;
  suppliers: { id: string; name: string }[];
  can_create: boolean;
  value_hidden: boolean;
  ask_name: string;
  last_closed: { number: string; status_label: string; at: string } | null;
  as_of: string;
}

const STATUS_STATE: Record<
  string,
  "ready" | "pending_sync" | "partial" | "success" | "expired" | "server_error"
> = {
  open: "ready",
  sent: "pending_sync",
  unsent: "server_error",
  partial: "partial",
  received: "success",
  cancelled: "expired",
  closed: "success",
};

function ago(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return "اليوم";
  if (diff === 1) return "أمس";
  if (diff === 2) return "قبل يومين";
  if (diff <= 10) return `قبل ${diff} أيام`;
  return `قبل ${diff} يوماً`;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`pos-chip${on ? " pos-chip--on" : ""}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * PUR-01 — أوامر الشراء الداخلية (32-D24 ready/loading/empty/permission_denied): الأمر وعدٌ لا
 * التزام — لا يحرّك مخزوناً ولا مالاً؛ «القيمة التقديرية» موسومة في العنوان لا في حاشية؛ الملغى
 * يبقى في السجل بسببه؛ أمين المخزن يرى ولا يُنشئ وعمود القيمة محجوب عنه لا الشاشة (§٧.٧، §٣.٣).
 */
export function OrdersClient() {
  const router = useRouter();
  const app = useApp();
  const [scope, setScope] = useState<"open" | "all">("open");
  const [supplier, setSupplier] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const t = setTimeout(() => setSlow(true), 3000);
    try {
      const { data, error, response } = await api().GET("/api/inventory/purchasing/orders", {
        params: { query: { scope, ...(supplier ? { supplier_id: supplier } : {}) } },
      });
      if (response.status === 403) {
        setDenied((error as unknown as { role_name?: string } | undefined)?.role_name ?? "");
        return;
      }
      const body = data as unknown as Payload | undefined;
      if (response.ok && body) setData(body);
    } finally {
      clearTimeout(t);
      setSlow(false);
    }
  }, [scope, supplier]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpurchasing%2Forders");
    }
  }, [router]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const state: State =
    denied !== null
      ? "permission_denied"
      : !data
        ? "loading"
        : data.value_hidden
          ? "permission_denied"
          : data.orders.length === 0
            ? "empty"
            : "ready";

  const orders = data?.orders ?? [];
  const hideValue = data?.value_hidden ?? false;
  const lastCount = (() => {
    try {
      return Math.min(Math.max(Number(localStorage.getItem("pur.orders_count") ?? "6"), 1), 8);
    } catch {
      return 6;
    }
  })();
  useEffect(() => {
    if (data) {
      try {
        localStorage.setItem("pur.orders_count", String(data.orders.length || 6));
      } catch {
        /* بلا تخزين */
      }
    }
  }, [data]);

  const columns = [
    {
      key: "order",
      header: "الأمر والمورد",
      render: (o: OrderRow) => (
        <div>
          <div>
            <span className="sting-mono">{o.number}</span> · {o.supplier_name}
          </div>
          <div className="acc-choice__note">
            أُنشئ {ago(o.created_at)} · {o.created_by_name}
          </div>
        </div>
      ),
    },
    {
      key: "items",
      header: "الأصناف",
      render: (o: OrderRow) => (
        <span>
          {o.items_summary} · <span className="sting-mono">{o.lines_count}</span>{" "}
          {o.lines_count === 1 ? "صنف" : o.lines_count === 2 ? "صنفان" : "أصناف"}
        </span>
      ),
    },
    ...(hideValue
      ? []
      : [
          {
            key: "value",
            header: "القيمة التقديرية",
            mono: true,
            render: (o: OrderRow) =>
              o.estimated_total_minor ? formatMinor(o.estimated_total_minor) : "—",
          },
        ]),
    {
      key: "status",
      header: "الحالة",
      render: (o: OrderRow) => (
        <Status state={STATUS_STATE[o.status] ?? "ready"} label={o.status_label} />
      ),
    },
    {
      key: "wait",
      header: "ما يُنتظر",
      render: (o: OrderRow) => (
        <span>
          {o.status === "cancelled" && o.cancelled_reason
            ? `أُلغي بسبب مكتوب: ${o.cancelled_reason}. الأمر يبقى في السجل ولا يُحذف.`
            : o.status_hint}
        </span>
      ),
    },
  ];

  return (
    <Frame title="المشتريات" nav={<AppNav currentId="purchasing" />} footer={null}>
      <div className="sys pur" data-screen="PUR-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">أوامر الشراء الداخلية — الأمر وعدٌ لا التزام</h2>
            <span className="cat-head__hint">
              أمر الشراء لا يحرّك مخزوناً ولا مالاً. الذي يحرّكهما مستند الشراء حين يُستلم ويُعتمد.
              الفصل بينهما يمنع أن يصير الطلبُ رصيداً.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__filters">
              <div className="pos-chips" role="group" aria-label="الحالة">
                <Chip on={scope === "open"} onClick={() => setScope("open")}>
                  مفتوحة
                </Chip>
                <Chip on={scope === "all"} onClick={() => setScope("all")}>
                  السجل كله
                </Chip>
              </div>
              <div className="pos-chips" role="group" aria-label="المورد">
                <Chip on={!supplier} onClick={() => setSupplier("")}>
                  كل الموردين
                </Chip>
                {(data?.suppliers ?? []).map((s) => (
                  <Chip key={s.id} on={supplier === s.id} onClick={() => setSupplier(s.id)}>
                    {s.name}
                  </Chip>
                ))}
              </div>
              {data ? (
                <p className="acc-choice__note">
                  أوامر الشراء — <span className="sting-mono">{data.open_count}</span> مفتوحة ·{" "}
                  <span className="sting-mono">{data.closed_count}</span> في السجل
                </p>
              ) : null}
              <div className="cat-form__actions">
                <Button
                  pos
                  onClick={() => router.push("/purchasing/orders/new")}
                  disabledReason={
                    data && !data.can_create
                      ? `الإنشاء للمالك والمحاسب — اطلب من ${data.ask_name || "المالك"}`
                      : undefined
                  }
                >
                  أمر جديد
                </Button>
              </div>
            </div>

            {state === "loading" ? (
              <>
                <Notice kind="info" title="تحميل القائمة">
                  <p className="acc-lead">
                    ستة هياكل بعدد آخر قائمة معروفة، والمرشّحات فعّالة أثناء التحميل — اختيار
                    المرشّح يعيد الطلب لا ينتظره.
                  </p>
                  <p className="acc-lead">
                    <strong>لا نُظهر</strong> · «لا أوامر» أثناء التحميل. الفراغ حكمٌ، والقائمة لم
                    تصل لتُحكَم.
                  </p>
                  {slow ? <p className="acc-choice__note">الشبكة بطيئة</p> : null}
                </Notice>
                <Table
                  caption="أوامر الشراء"
                  columns={columns}
                  rows={[]}
                  rowKey={(o) => o.id}
                  loading={lastCount}
                />
              </>
            ) : null}

            {denied !== null ? (
              <Notice kind="locked" title="أوامر الشراء لمن يستلم أو يلتزم">
                <p className="acc-lead">
                  القائمة مرئية لأمين المخزن لأنه يستلم بناءً عليها. الإنشاء والإلغاء للمالك
                  والمحاسب — كلاهما التزام مالي.{denied ? ` دورك: ${denied}.` : ""}
                </p>
              </Notice>
            ) : null}

            {state === "permission_denied" && data ? (
              <Notice kind="locked" title="أمين المخزن يرى ولا يُنشئ">
                <p className="acc-lead">
                  القائمة مرئية لأمين المخزن لأنه يستلم بناءً عليها. الإنشاء والإلغاء للمالك
                  والمحاسب — كلاهما التزام مالي.
                </p>
                <p className="acc-lead">
                  <strong>القيمة التقديرية</strong> · عمود القيمة محجوب عن أمين المخزن: عمله عدُّ
                  الأصناف لا مطابقة المبالغ، والسعر يقود إلى التكلفة.
                </p>
                <p className="acc-lead">
                  <strong>الزرّ</strong> · يظهر معطّلاً مع سببه ومع «اطلب من{" "}
                  {data.ask_name || "المالك"}» — لا يُخفى. الصلاحية على العمود لا على الشاشة كلها:
                  حجب الشاشة يمنعه من الاستلام أصلاً.
                </p>
              </Notice>
            ) : null}

            {state === "empty" && data ? (
              <Notice
                kind="empty"
                title="لا أوامر مفتوحة"
                action={
                  scope === "open" && data.closed_count > 0 ? (
                    <Button onClick={() => setScope("all")}>السجل المغلق</Button>
                  ) : undefined
                }
              >
                <p className="acc-lead">
                  {data.closed_count > 0 ? (
                    <>
                      <span className="sting-mono">{data.closed_count}</span> أوامر مغلقة في السجل
                      وصفرٌ مفتوح. هذه حالة صحّية لا نقص: كل ما طُلب وصل.
                    </>
                  ) : (
                    "لم يُنشأ أمر شراء بعد."
                  )}
                </p>
                {data.last_closed ? (
                  <p className="acc-lead">
                    <strong>نقول</strong> · «لا أوامر مفتوحة — آخرها{" "}
                    <span className="sting-mono">{data.last_closed.number}</span>{" "}
                    {data.last_closed.status_label} {ago(data.last_closed.at)}»، والسجل المغلق على
                    بعد ضغطة.
                  </p>
                ) : null}
                <p className="acc-choice__note">
                  <strong>نعرض</strong> · مدخلاً لأمر جديد ومدخلاً لاقتراح التوريد إن كانت مرحلته
                  مفتوحة.
                </p>
              </Notice>
            ) : null}

            {data && (state === "ready" || state === "permission_denied") && orders.length ? (
              <Table
                caption="أوامر الشراء"
                columns={columns}
                rows={orders}
                rowKey={(o) => o.id}
                onOpenRow={(o) =>
                  router.push(
                    data.can_create && o.status !== "cancelled"
                      ? `/purchasing/orders/${o.id}/document`
                      : `/purchasing/orders/${o.id}`,
                  )
                }
              />
            ) : null}
            {state === "ready" ? (
              <p className="acc-choice__note">
                «القيمة التقديرية» موسومة بالتقدير في العنوان لا في حاشية. الرقم من آخر سعر شراء
                معروف، وقد يختلف عمّا يأتي في الفاتورة — ومن يقرأه في قائمة يبني عليه قراراً نقدياً.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
