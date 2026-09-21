"use client";

import { Button, Frame, Notice, Status, Table, TextField } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "@/features/market/market.css";
import "./platform.css";
import { agoParts } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformNav } from "@/features/platform/platform-nav";

type State = "loading" | "ready" | "empty" | "permission_denied";
type Filter = "all" | "due14" | "sync_stuck" | "late" | "suspended";

export interface TenantRow {
  id: string;
  name: string;
  plan_label: string;
  plan_code: string;
  due_line: string;
  expires_at: string;
  days_left: number | null;
  devices: number;
  last_sync_at: string;
  sync_stuck: boolean;
  technical: string;
  status: "active" | "trial" | "expired" | "payment_pending" | "sync_late" | "suspended";
  status_label: string;
  support_access: string;
  actions: string;
}

interface Payload {
  tenants: TenantRow[];
  total: number;
  shown: number;
  active_count: number;
  filter: string;
  q: string;
  access_rule: string;
  fetched_at: string;
}

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
  return n === 1 ? "قبل يوم" : n === 2 ? "قبل يومين" : `قبل ${n} أيام`;
};
const tenantsWord = (n: number) =>
  n === 1 ? "مستأجر واحد" : n === 2 ? "مستأجران" : n <= 10 ? `${n} مستأجرين` : `${n} مستأجراً`;

/** PLT-02 — المستأجرون (08-D4/18-D13 ready · 39-D31 loading/empty/permission_denied): القائمة لا تكشف دفاتر. */
export function TenantsClient() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState(false);
  const [q, setQ] = useState("");
  // PLT-00: بطاقات النظرة العامة تفتح القائمة بمرشّحها (?filter=)
  const params = useSearchParams();
  const initial = params.get("filter");
  const [filter, setFilter] = useState<Filter>(
    initial === "due14" || initial === "late" || initial === "sync_stuck" || initial === "suspended"
      ? initial
      : "all",
  );

  const load = useCallback(
    async (query: string, f: Filter) => {
      if (!operatorToken()) {
        router.replace("/platform/login");
        return;
      }
      const { data, response } = await platformApi().GET("/api/platform/tenants", {
        params: { query: { q: query, filter: f } },
      });
      if (response.status === 403 || response.status === 401) {
        setDenied(true);
        return;
      }
      const body = data as unknown as Payload | undefined;
      if (response.ok && body) setData(body);
    },
    [router],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(q, filter).catch(() => undefined), 150);
    return () => clearTimeout(t);
  }, [q, filter, load]);

  const state: State = denied
    ? "permission_denied"
    : !data
      ? "loading"
      : data.shown === 0
        ? "empty"
        : "ready";

  const columns = [
    {
      key: "name",
      header: "المستأجر",
      render: (t: TenantRow) => (
        <>
          <strong>{t.name}</strong>
          <div className="mp-check__hint">
            {t.plan_label} ·{" "}
            {t.devices
              ? `${t.devices} ${t.devices === 1 ? "جهاز" : t.devices === 2 ? "جهازان" : "أجهزة"}`
              : "بلا أجهزة"}
          </div>
        </>
      ),
    },
    { key: "due", header: "الباقة والاستحقاق", render: (t: TenantRow) => t.due_line },
    {
      key: "sync",
      header: "آخر مزامنة",
      render: (t: TenantRow) =>
        t.last_sync_at ? `${agoWord(t.last_sync_at)}${t.sync_stuck ? " — تحت المتابعة" : ""}` : "—",
    },
    {
      key: "status",
      header: "الحالة",
      render: (t: TenantRow) => (
        <>
          <Status
            state={
              t.status === "active"
                ? "success"
                : t.status === "expired"
                  ? "expired"
                  : t.status === "payment_pending"
                    ? "stale"
                    : t.status === "sync_late"
                      ? "conflict"
                      : t.status === "suspended"
                        ? "permission_denied"
                        : "saved_local"
            }
            label={t.status_label}
          />
          <div className="mp-check__hint">{t.technical}</div>
        </>
      ),
    },
    { key: "actions", header: "ما يمكنك فعله", render: (t: TenantRow) => t.actions },
    { key: "support", header: "وصول الدعم", render: (t: TenantRow) => t.support_access },
  ];

  return (
    <Frame
      title="إدارة فيزانو"
      navLayout="top"
      nav={<PlatformNav current="tenants" />}
      footer={null}
    >
      <div className="sys mp cus plt-frame" data-screen="PLT-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">المستأجرون — وصول دعم مقيد ومدقَّق</h2>
            <span className="cat-head__hint">
              ACC-62 وACC-60: مشغّل الخدمة يرى الاستحقاق والحالة التشغيلية، ولا يرى دفتر مستأجر بلا
              مسار مخوَّل.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="warning" title="المشغّل لا يرى دفاتر التجّار">
                <p className="acc-lead">
                  يرى الاستحقاق والباقة وتاريخ الدفع، ولا يرى مبيعات المستأجر ولا عملاءه ولا أصنافه.
                </p>
                <p className="acc-choice__note">
                  <strong>الحدّ الصريح</strong> · حالة التشغيل والفوترة مرئية، ودفتر الأعمال لا. هذا
                  حدٌّ تعاقدي يُرسم في الواجهة لا سياسةً مكتوبة.
                </p>
                <p className="acc-choice__note">
                  <strong>حتى للدعم</strong> · موظف الدعم يرى تشخيصاً بلا بيانات (SYS-11) — ولا
                  باباً خلفياً إلى الدفاتر.
                </p>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/platform/login")}>دخول المشغّل</Button>
                </div>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="جلب المستأجرين">
                <p className="acc-lead">مع العدد الإجمالي وحالة الاستحقاق — سبب فتح الشاشة.</p>
              </Notice>
            ) : null}
            {!denied ? (
              <>
                <TextField
                  label="ابحث باسم المنشأة أو معرِّف المستأجر"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <div className="pos-chips" role="group" aria-label="الاستحقاق">
                  {(
                    [
                      ["all", "كل الاستحقاقات"],
                      ["due14", "الاستحقاق خلال 14 يوماً"],
                      ["late", "متأخرو السداد"],
                      ["sync_stuck", "مزامنة متعثّرة"],
                      ["suspended", "موقوفون"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`pos-chip${filter === k ? " pos-chip--on" : ""}`}
                      onClick={() => setFilter(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {state === "empty" && data ? (
              <Notice kind="empty" title="لا مستأجرين مطابقين">
                <p className="acc-lead">مرشّحٌ لا يطابق (مثلاً: متأخرو السداد وقد سدّد الجميع).</p>
                <p className="acc-choice__note">
                  <strong>نقول ما فُحص</strong> · «لا متأخرين —{" "}
                  <span className="sting-mono">{data.total}</span>{" "}
                  {data.total === 1
                    ? "مستأجر"
                    : data.total === 2
                      ? "مستأجران"
                      : data.total <= 10
                        ? "مستأجرين"
                        : "مستأجراً"}{" "}
                  نشطاً». الفراغ مع العدد خبرٌ جيد، وبلا عدد يبدو عطباً.
                </p>
              </Notice>
            ) : null}
            {state === "ready" && data ? (
              <>
                <div className="acc-choice__head">
                  <strong>
                    المستأجرون — <span className="sting-mono">{data.total}</span>{" "}
                    {data.total === 1
                      ? "متجر"
                      : data.total === 2
                        ? "متجران"
                        : data.total <= 10
                          ? "متاجر"
                          : "متجراً"}
                  </strong>
                  <span className="acc-choice__note">
                    {tenantsWord(data.shown)} في هذا المرشّح · لا عمود للمبيعات في هذه الشاشة ولن
                    يوجد.
                  </span>
                </div>
                <Table
                  caption="المستأجرون"
                  columns={columns}
                  rows={data.tenants}
                  rowKey={(t) => t.id}
                  onOpenRow={(t) => router.push(`/platform/tenants/${t.id}`)}
                />
                <p className="acc-choice__note">
                  <strong>حد الوصول</strong> · لا زر «دخول كالمالك». {data.access_rule}
                </p>
                <p className="acc-choice__note">
                  ما يلزم المشغّل لتشغيل الخدمة: الاشتراك، الأجهزة، صحة المزامنة، حجم التخزين. أرقام
                  التاجر ملكه، والدعم يراها فقط بإذن مؤقت منه يُسجَّل في PLT-02/detail.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
