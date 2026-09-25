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
import "./notify.css";
import { AppNav } from "@/features/home/app-nav";
import { dayMonth, hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";

type State = "ready" | "loading" | "empty" | "permission_denied";

interface Results {
  sent?: number;
  accepted?: number;
  delivered?: number;
  unconfirmed?: number;
  failed?: number;
  failures?: { code: string; label: string; count: number; action: string }[];
}

export interface CampaignRow {
  id: string;
  name: string;
  message: string;
  channel: string;
  audience_count: number;
  excluded_count: number;
  parts: number;
  cost_messages: number;
  status: string;
  status_label: string;
  scheduled_at: string;
  sent_at: string;
  results: Results;
  created_by_name: string;
  created_at: string;
}

interface Payload {
  campaigns: CampaignRow[];
  quota: { used: number; max: number; remaining: number };
  subscribers: number;
  parties_total: number;
  can_create: boolean;
  can_approve: boolean;
  can_see_billing: boolean;
  as_of: string;
}

const STATUS_STATE: Record<
  string,
  "ready" | "pending_sync" | "saving" | "success" | "expired" | "partial"
> = {
  draft: "ready",
  pending_approval: "pending_sync",
  scheduled: "pending_sync",
  sending: "saving",
  done: "success",
  cancelled: "expired",
};

function When({ iso }: { iso: string }) {
  if (!iso) return <span>—</span>;
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  const { day: dd, month } = dayMonth(iso);
  return (
    <span>
      {diff === 0 ? (
        "اليوم"
      ) : diff === 1 ? (
        "أمس"
      ) : (
        <>
          <span className="sting-mono">{dd}</span> {month}
        </>
      )}{" "}
      <span className="sting-mono">{hhmm(iso)}</span>
    </span>
  );
}

/**
 * NOT-03 — قائمة الحملات (17-D12 ready · 36-D28 loading/empty/permission_denied): حملات المحل إلى
 * زبائنه مع الحصة الشهرية والرقم الصادق «N زبوناً أذنوا» لا «كل دفترك»؛ نتائج الحملة بأربع درجات —
 * «قبِله المزوّد» ليس «قرأه الزبون»؛ مسؤول الحملات يرى الحصة ولا يرى التكلفة ولا فاتورة الباقة
 * (§١١.٥، G-07).
 */
export function CampaignsClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const { data, error, response } = await api().GET("/api/campaigns", {});
    if (response.status === 403) {
      setDenied((error as unknown as { role_name?: string } | undefined)?.role_name ?? "");
      return;
    }
    const body = data as unknown as Payload | undefined;
    if (response.ok && body) setData(body);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fnotify%2Fcampaigns");
      return;
    }
    void load().catch(() => undefined);
  }, [router, load]);

  const state: State =
    denied !== null
      ? "permission_denied"
      : !data
        ? "loading"
        : data.campaigns.length === 0
          ? "empty"
          : "ready";

  const latest =
    data?.campaigns.find((c) => c.results && Object.keys(c.results).length > 0) ?? null;

  return (
    <Frame title="الإشعارات" nav={<AppNav currentId="campaigns" />} footer={null}>
      <div className="sys not" data-screen="NOT-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">قائمة الحملات</h2>
            <span className="cat-head__hint">
              حملات المحل إلى زبائنه. نتائج الحملة — «قبِله المزوّد» ليس «قرأه الزبون».
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice kind="locked" title="الحملات لمن يملك إنشاءها أو اعتمادها">
                <p className="acc-lead">
                  إنشاء الحملات للمالك ومدير الفرع؛ الاعتماد للمالك وحده («الأدوار والصلاحيات»).
                  {denied ? ` دورك: ${denied}.` : ""}
                </p>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="جلب الحملات">
                <p className="acc-lead">
                  مع الحصة الشهرية وهي تُحسب — فهي أول ما يُنظر إليه قبل إنشاء حملة.
                </p>
              </Notice>
            ) : null}

            {data ? (
              <section className="rep-head" aria-label="الحصة والمشتركون">
                <div className="home-kpis rep-kpis">
                  <div className="home-kpi">
                    <div className="home-kpi__label">الحصة المتبقية هذا الشهر</div>
                    <div className="home-kpi__value sting-mono">{data.quota.remaining}</div>
                    <div className="home-kpi__scope">
                      من <span className="sting-mono">{data.quota.max}</span> رسالة ·{" "}
                      <span className="sting-mono">{data.quota.used}</span> مستهلكة
                    </div>
                  </div>
                  <div className="home-kpi">
                    <div className="home-kpi__label">الرقم الصادق</div>
                    <div className="home-kpi__value sting-mono">{data.subscribers}</div>
                    <div className="home-kpi__scope">
                      زبوناً أذنوا باستقبال رسائلك — لا{" "}
                      <span className="sting-mono">{data.parties_total}</span> زبوناً في دفترك.
                      الفرق بينهما هو الإذن.
                    </div>
                  </div>
                </div>
                {!data.can_see_billing ? (
                  <p className="acc-choice__note">
                    <strong>مسؤول الحملات لا يرى الفوترة</strong> · يرى الحملات والحصة المتبقية، ولا
                    يرى تكلفتها ولا فاتورة الباقة. <strong>الحدّ</strong> · الحصة عددٌ يحتاجه
                    ليخطّط، والتكلفة رقمٌ مالي للمالك.
                  </p>
                ) : null}
                {data.can_create ? (
                  <div className="cat-form__actions">
                    <Button pos onClick={() => router.push("/notify/campaigns/new")}>
                      حملة جديدة
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {state === "empty" && data ? (
              <Notice kind="empty" title="لا حملات">
                <p className="acc-lead">
                  لم تُنشأ حملة بعد. نعرض الحصة المتاحة وعدد المشتركين الفعلي.
                </p>
                <p className="acc-lead">
                  <strong>الرقم الصادق</strong> · «
                  <span className="sting-mono">{data.subscribers}</span> زبوناً أذنوا باستقبال
                  رسائلك» — لا «<span className="sting-mono">{data.parties_total}</span> زبوناً في
                  دفترك». الفرق بينهما هو الإذن.
                </p>
              </Notice>
            ) : null}

            {state === "ready" && data ? (
              <>
                <Table
                  caption="الحملات"
                  columns={[
                    {
                      key: "name",
                      header: "الحملة",
                      render: (c: CampaignRow) => (
                        <div>
                          <div>حملة «{c.name}»</div>
                          <div className="acc-choice__note">
                            {c.sent_at ? (
                              <>
                                أُرسلت <When iso={c.sent_at} /> · قناة رسائل نصية
                              </>
                            ) : c.scheduled_at ? (
                              <>
                                مجدولة <When iso={c.scheduled_at} />
                              </>
                            ) : (
                              <>
                                أُنشئت <When iso={c.created_at} /> · {c.created_by_name}
                              </>
                            )}
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "status",
                      header: "الحالة",
                      render: (c: CampaignRow) => (
                        <Status state={STATUS_STATE[c.status] ?? "ready"} label={c.status_label} />
                      ),
                    },
                    {
                      key: "audience",
                      header: "الجمهور",
                      mono: true,
                      render: (c: CampaignRow) => String(c.audience_count),
                    },
                    {
                      key: "messages",
                      header: "الرسائل",
                      mono: true,
                      render: (c: CampaignRow) => String(c.cost_messages),
                    },
                  ]}
                  rows={data.campaigns}
                  rowKey={(c) => c.id}
                  onOpenRow={(c) => router.push(`/notify/campaigns/${c.id}`)}
                />
                {latest?.results?.failures?.length ? (
                  <section className="not-results" aria-label="نتائج الحملة">
                    <h3 className="cat-head__title">
                      نتائج الحملة — «قبِله المزوّد» ليس «قرأه الزبون»
                    </h3>
                    <p className="acc-choice__note">
                      أربع درجات لا واحدة. عرض «{latest.results.delivered ?? 0} وصلت» بينما{" "}
                      {latest.results.failed ?? 0} فشلت يجعلك تحاسب حملة نجحت نصفها.
                    </p>
                    <div className="home-kpis rep-kpis">
                      <div className="home-kpi">
                        <div className="home-kpi__label">أُرسلت من عندنا</div>
                        <div className="home-kpi__value sting-mono">{latest.results.sent ?? 0}</div>
                        <div className="home-kpi__scope">غادرت النظام إلى المزوّد</div>
                      </div>
                      <div className="home-kpi">
                        <div className="home-kpi__label">قبِلها المزوّد</div>
                        <div className="home-kpi__value sting-mono">
                          {latest.results.accepted ?? 0}
                        </div>
                        <div className="home-kpi__scope">قبول لا يعني تسليماً للهاتف</div>
                      </div>
                      <div className="home-kpi">
                        <div className="home-kpi__label">أكّد المزوّد تسليمها</div>
                        <div className="home-kpi__value sting-mono">
                          {latest.results.delivered ?? 0}
                        </div>
                        <div className="home-kpi__scope">
                          وصلت الجهاز ·{" "}
                          <span className="sting-mono">{latest.results.unconfirmed ?? 0}</span> بلا
                          تأكيد بعد
                        </div>
                      </div>
                      <div className="home-kpi">
                        <div className="home-kpi__label">فشلت نهائياً</div>
                        <div className="home-kpi__value sting-mono">
                          {latest.results.failed ?? 0}
                        </div>
                        <div className="home-kpi__scope">بسبب مذكور لكل واحدة</div>
                      </div>
                    </div>
                    <Table
                      caption="سبب الفشل"
                      columns={[
                        { key: "r", header: "سبب الفشل", render: (f) => f.label },
                        { key: "n", header: "العدد", mono: true, render: (f) => String(f.count) },
                        { key: "a", header: "ما يمكن فعله", render: (f) => f.action },
                      ]}
                      rows={latest.results.failures}
                      rowKey={(f) => f.code}
                    />
                  </section>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
