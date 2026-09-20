"use client";

import { Button, formatMinor, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "@/features/public/public.css";
import "@/features/market/market.css";
import "./platform.css";
import { dayMonth, hhmm } from "@/features/home/format";
import { operatorToken, platformApi } from "@/features/platform/operator-session";
import { PlatformNav } from "@/features/platform/platform-nav";
import type { TenantRow } from "@/features/platform/tenants-client";

interface Detail extends TenantRow {
  entitlement: {
    plan_code: string;
    plan_label: string;
    state: string;
    started_at: string;
    expires_at: string;
    extra_features: string[];
    renewal_amount_minor: string;
  };
  proofs: {
    id: string;
    status: string;
    amount_minor: string;
    reference: string;
    submitted_at: string;
  }[];
  devices_list: {
    id: string;
    name: string;
    branch: string;
    status: string;
    last_seen_at: string;
  }[];
  branches: number;
  users: number;
  storage: { operations: number };
  support_grants: {
    ticket_ref: string;
    hours: number;
    reason: string;
    granted_by_name: string;
    granted_at: string;
    expires_at: string;
    active: boolean;
  }[];
  limits: string[];
}

const When = ({ iso }: { iso: string }) => {
  if (!iso) return <>—</>;
  const { day, month } = dayMonth(iso);
  return (
    <>
      <span className="sting-mono">{day}</span> {month}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </>
  );
};

/** PLT-02/detail — تفاصيل الاستحقاق والحالة التقنية؛ كل فتح يُدقَّق؛ لا مبيعات ولا عملاء. */
export function TenantDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!operatorToken()) {
      router.replace("/platform/login");
      return;
    }
    void (async () => {
      const { data, response } = await platformApi().GET("/api/platform/tenants/{tenant_id}", {
        params: { path: { tenant_id: id } },
      });
      if (response.status === 403 || response.status === 401) {
        setDenied(true);
        return;
      }
      const body = data as unknown as { tenant: Detail } | undefined;
      if (response.ok && body) setD(body.tenant);
    })().catch(() => undefined);
  }, [id, router]);

  const state = denied ? "permission_denied" : d ? "ready" : "loading";

  return (
    <Frame
      title="إدارة Sting"
      navLayout="top"
      nav={<PlatformNav current="tenants" />}
      footer={null}
    >
      <div className="sys mp cus plt-frame" data-screen="PLT-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تفاصيل الاستحقاق — القائمة لا تكشف دفاتر</h2>
            <span className="cat-head__hint">
              المشغّل يرى حالة الاشتراك والاستخدام التقني. لا يرى مبيعات ولا أسماء زبائن ولا أرصدة
              ذمم.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب المستأجرين">
                <p className="acc-lead">مع العدد الإجمالي وحالة الاستحقاق — سبب فتح الشاشة.</p>
              </Notice>
            ) : null}
            {denied ? (
              <Notice kind="warning" title="المشغّل لا يرى دفاتر التجّار">
                <p className="acc-lead">
                  يرى الاستحقاق والباقة وتاريخ الدفع، ولا يرى مبيعات المستأجر ولا عملاءه ولا أصنافه.
                </p>
              </Notice>
            ) : null}
            {d ? (
              <>
                <div className="cus-head">
                  <div className="acc-actions">
                    <Status
                      state={
                        d.status === "active"
                          ? "success"
                          : d.status === "expired"
                            ? "expired"
                            : "stale"
                      }
                      label={d.status_label}
                    />
                    <span className="plt-badge">حدود وصول</span>
                  </div>
                  <h3 className="cat-head__title">{d.name}</h3>
                  <div className="cus-sub">
                    {d.entitlement.plan_label} · {d.due_line} · {d.branches}{" "}
                    {d.branches === 1 ? "فرع" : d.branches === 2 ? "فرعان" : "فروع"} ·{" "}
                    <span className="sting-mono">{d.users}</span> مستخدمين
                  </div>
                </div>
                <div className="home-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">الباقة والاستحقاق</div>
                    <div className="home-kpi__value">{d.entitlement.plan_label}</div>
                    <div className="home-kpi__note">
                      حتى <When iso={d.entitlement.expires_at} /> · التجديد{" "}
                      <span className="sting-mono">
                        {formatMinor(d.entitlement.renewal_amount_minor)}
                      </span>
                    </div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">أجهزة</div>
                    <div className="home-kpi__value sting-mono">{d.devices}</div>
                    <div className="home-kpi__note">{d.technical}</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">حجم التخزين</div>
                    <div className="home-kpi__value sting-mono">{d.storage.operations}</div>
                    <div className="home-kpi__note">عملية مزامنة مخزَّنة — لا محتواها</div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">وصول الدعم</div>
                    <div className="home-kpi__value">{d.support_access}</div>
                    <div className="home-kpi__note">بإذن مؤقت من المالك يُسجَّل في تدقيقه</div>
                  </div>
                </div>
                <h3 className="cat-head__title">الأجهزة — الحالة التقنية</h3>
                <ul className="cus-list">
                  {d.devices_list.map((dev) => (
                    <li key={dev.id}>
                      <strong>{dev.name}</strong>
                      <div className="cus-sub">
                        {dev.branch} · آخر ظهور <When iso={dev.last_seen_at} />
                      </div>
                      <Status
                        state={dev.status === "active" ? "success" : "expired"}
                        label={dev.status}
                      />
                    </li>
                  ))}
                  {d.devices_list.length === 0 ? <li>لا أجهزة مسجَّلة بعد.</li> : null}
                </ul>
                <h3 className="cat-head__title">إيصالات الاشتراك</h3>
                <ul className="cus-list">
                  {d.proofs.map((p) => (
                    <li key={p.id}>
                      <strong className="sting-mono">{p.reference}</strong>
                      <div className="cus-sub">
                        <span className="sting-mono">{formatMinor(p.amount_minor)}</span> ·{" "}
                        <When iso={p.submitted_at} />
                      </div>
                      <Status
                        state={
                          p.status === "approved"
                            ? "success"
                            : p.status === "rejected"
                              ? "expired"
                              : "stale"
                        }
                        label={p.status}
                      />
                    </li>
                  ))}
                  {d.proofs.length === 0 ? <li>لا إيصالات.</li> : null}
                </ul>
                <h3 className="cat-head__title">وصول الدعم — بتذكرة من المالك</h3>
                <ul className="cus-list">
                  {d.support_grants.map((g) => (
                    <li key={`${g.ticket_ref}-${g.granted_at}`}>
                      <strong className="sting-mono">{g.ticket_ref}</strong>
                      <div className="cus-sub">
                        {g.reason} · <span className="sting-mono">{g.hours}</span> ساعة · منحه{" "}
                        {g.granted_by_name} · حتى <When iso={g.expires_at} />
                      </div>
                      <Status
                        state={g.active ? "success" : "expired"}
                        label={g.active ? "فعّال" : "منتهٍ"}
                      />
                    </li>
                  ))}
                  {d.support_grants.length === 0 ? (
                    <li>لا وصول فعّال — القراءة تحتاج تذكرة من المالك.</li>
                  ) : null}
                </ul>
                <h3 className="cat-head__title">حد الوصول</h3>
                <ul className="pub-list">
                  {d.limits.map((t) => (
                    <li key={t}>
                      <span className="pub-mark">لا</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <div className="acc-actions">
                  <Button onClick={() => router.push("/platform/tenants")}>المستأجرون</Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
