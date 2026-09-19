"use client";

import { Button, formatMinor, Frame, Notice, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/sys/sys.css";
import "@/features/org/org.css";
import "./reports.css";
import { AppNav } from "@/features/home/app-nav";
import { dayMonth, hhmm } from "@/features/home/format";
import { Ago } from "@/features/org/ago";
import { api, apiBaseUrl, getAccessToken } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "empty" | "stale" | "permission_denied";
type Side = "customers" | "suppliers";

interface Row {
  id: string;
  name: string;
  balance_minor: string;
  last_payment_date: string;
  oldest_unpaid_date: string;
  invoices: number;
  source: string;
}

interface Payload {
  side: Side;
  scope: "all";
  rows: Row[];
  totals: { balance_minor: string; parties: number };
  computed_at: string;
  ageing: "disabled";
}

const CACHE = "rep.receivables_cache";

function DateCell({ iso, none }: { iso: string; none: string }) {
  if (!iso) return <span>{none}</span>;
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const todayIso = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  if (iso === todayIso) return <span>اليوم</span>;
  const { day, month } = dayMonth(iso);
  return (
    <span>
      <span className="sting-mono">{day}</span> {month}
    </span>
  );
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
 * REP-02 — تقرير الذمم — بلا تقادم مخترَع (07-D3 ready · 36-D28 loading/empty/stale/
 * permission_denied): آخر سداد وأقدم حركة غير مسددة، لا جدول أعمار — قرار G-15 وACC-79. الذمم
 * تُحسب من كل الحركات لا تُقرأ جاهزة؛ الكاشير يرى رصيد الطرف الذي يبيع له وقت البيع لا التقرير
 * كاملاً. الأرقام تطابق HOME-01 «الذمم» وPTY-05 لكل طرف.
 */
export function ReceivablesReportClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [side, setSide] = useState<Side>("customers");
  const [data, setData] = useState<Payload | null>(null);
  const [cached, setCached] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [denied, setDenied] = useState(false);
  const [roleName, setRoleName] = useState("");
  const appRef = useRef(app);
  appRef.current = app;

  const fetchServer = useCallback(async () => {
    setFetching(true);
    setFailed(false);
    try {
      const { data, error, response } = await api().GET("/api/reports/receivables", {
        params: { query: { side } },
      });
      if (response.status === 403) {
        const e = error as unknown as { role_name?: string } | undefined;
        setRoleName(e?.role_name ?? "");
        setDenied(true);
        return;
      }
      const body = data as unknown as Payload | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setData(body);
      await getStorage().transaction((tx) => tx.putMeta(CACHE, JSON.stringify(body)));
    } catch {
      setFailed(true);
    } finally {
      setFetching(false);
    }
  }, [side]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Freports%2Freceivables");
      return;
    }
    void getStorage()
      .read((tx) => tx.getMeta(CACHE))
      .then((raw) => {
        if (raw) setCached(JSON.parse(raw) as Payload);
      })
      .catch(() => undefined);
  }, [router]);

  useEffect(() => {
    if (!online) return;
    setData(null);
    void fetchServer();
  }, [fetchServer, online]);

  const p = data ?? (cached && cached.side === side ? cached : null);
  const state: State = denied
    ? "permission_denied"
    : (!online || failed) && p
      ? "stale"
      : !p || (fetching && data === null)
        ? "loading"
        : p.rows.length === 0
          ? "empty"
          : "ready";

  const exportCsv = async () => {
    const r = await fetch(`${apiBaseUrl()}/api/reports/receivables?side=${side}&export=csv`, {
      headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receivables-${side}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const expectedCount = cached?.totals.parties ?? 0;

  return (
    <Frame title="التقارير" nav={<AppNav currentId="reports-receivables" />} footer={null}>
      <div className="sys rep" data-screen="REP-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تقرير الذمم — بلا تقادم مخترَع</h2>
            <span className="cat-head__hint">
              آخر سداد وأقدم حركة غير مسددة، لا جدول أعمار — قرار G-15 وACC-79.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="pos-inv__filters">
              <div className="pos-chips" role="group" aria-label="الجهة">
                <Chip on={side === "customers"} onClick={() => setSide("customers")}>
                  على العملاء
                </Chip>
                <Chip on={side === "suppliers"} onClick={() => setSide("suppliers")}>
                  لنا على الموردين
                </Chip>
              </div>
              <div className="pos-chips" role="group" aria-label="الفرع">
                <Chip on onClick={() => undefined}>
                  كل الفروع
                </Chip>
              </div>
              {state !== "permission_denied" ? (
                <Button onClick={() => void exportCsv()}>تصدير</Button>
              ) : null}
            </div>

            {state === "permission_denied" ? (
              <Notice kind="locked" title="الكاشير يرى زبائنه">
                <p className="acc-lead">
                  الكاشير يرى رصيد الطرف الذي يبيع له وقت البيع، ولا يرى تقرير الذمم كاملاً.
                </p>
                <p className="acc-lead">
                  <strong>لماذا</strong> · التقرير الكامل صورةٌ مالية للمنشأة كلها. رؤية رصيد زبون
                  أمامك حاجةُ عمل، ورؤية الجميع ليست كذلك.
                  {roleName ? ` دورك: ${roleName}.` : ""}
                </p>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="جارٍ الحساب">
                <p className="acc-lead">
                  الذمم تُحسب من كل الحركات لا تُقرأ جاهزة.
                  {expectedCount ? (
                    <>
                      {" "}
                      <span className="sting-mono">{expectedCount}</span> طرفاً في آخر قائمة.
                    </>
                  ) : null}
                </p>
                <p className="acc-lead">
                  <strong>لا رقم جزئي</strong> · لا نعرض مجموعاً يتزايد أمام العين. المجموع المالي
                  يُقرأ مرة ويُحفظ في الذهن.
                </p>
              </Notice>
            ) : null}
            {state === "stale" && p ? (
              <Notice kind="warning" title="الذمم من آخر مطابقة">
                <p className="acc-lead">
                  محسوبة <Ago iso={p.computed_at} /> (
                  <span className="sting-mono">{hhmm(p.computed_at)}</span>). سدادٌ وقع في فرعٍ لم
                  يُزامن لا يظهر هنا.
                </p>
                <p className="acc-lead">
                  <strong>الخطر المحدد</strong> · أن تطالب زبوناً سدّد. نقولها صراحةً: «قد لا تشمل
                  سداداً وقع في فرع لم يُزامن» — لا تحذيراً عاماً.
                </p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="لا ذمم">
                <p className="acc-lead">
                  {side === "customers"
                    ? "كل البيع نقدي ولا آجل. حالةٌ صحّية لمحلّ تجزئة، لا نقصَ بيانات."
                    : "لا مستحقات مفتوحة على الموردين."}
                </p>
                {side === "customers" ? (
                  <p className="acc-lead">
                    <strong>نقولها كذلك</strong> · «لا ذمم مفتوحة — كل مبيعاتك نقدية». لا نقترح فتح
                    البيع الآجل: قرارٌ تجاري ليس لنا.
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {p && state !== "permission_denied" && state !== "empty" ? (
              <>
                <p className="acc-choice__note">
                  {side === "customers" ? "على العملاء" : "لنا على الموردين"} ·{" "}
                  <span className="sting-mono">{p.totals.parties}</span> طرفاً · المجموع{" "}
                  <span className="sting-mono">{formatMinor(p.totals.balance_minor)}</span> · حُسب
                  في <span className="sting-mono">{hhmm(p.computed_at)}</span>
                </p>
                <Table
                  caption="الذمم"
                  loading={state === "loading" ? Math.max(expectedCount, 3) : undefined}
                  columns={[
                    {
                      key: "name",
                      header: side === "customers" ? "العميل" : "المورد",
                      render: (r) => r.name,
                    },
                    {
                      key: "balance",
                      header: "الرصيد",
                      mono: true,
                      render: (r) => formatMinor(r.balance_minor),
                    },
                    {
                      key: "last",
                      header: "آخر سداد",
                      render: (r) => <DateCell iso={r.last_payment_date} none="لا سداد بعد" />,
                    },
                    {
                      key: "oldest",
                      header: "أقدم حركة غير مسددة",
                      render: (r) => <DateCell iso={r.oldest_unpaid_date} none="—" />,
                    },
                    { key: "source", header: "المصدر", render: (r) => r.source },
                  ]}
                  rows={p.rows}
                  rowKey={(r) => r.id}
                  onOpenRow={(r) => router.push(`/parties/${r.id}/statement`)}
                />
              </>
            ) : null}

            {state !== "permission_denied" ? (
              <Notice kind="locked" title="تقادم الديون (30/60/90) غير معروض.">
                <p className="acc-choice__note">
                  <strong>غير مفعّل</strong> · حسابه يتطلب توزيع كل دفعة على فواتير بعينها، وهو ما
                  لا يفعله النظام حالياً — السداد يُخفض الرصيد الإجمالي دون ربطه بفاتورة. عرض أعمار
                  مبنية على ترتيب افتراضي سيعطيك أرقاماً تبدو دقيقة وهي مخمَّنة، وقد تلاحق عميلاً
                  بدين سدّده. المعروض أعلاه حقائق مؤكدة: رصيد، وتاريخ آخر سداد، وتاريخ أقدم حركة لم
                  يغطها سداد لاحق.
                </p>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
