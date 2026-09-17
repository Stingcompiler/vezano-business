"use client";

import {
  type LocalSale,
  maskPhone,
  PARTY_PREFIX,
  readLocalParties,
  readSales,
} from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/parties/parties.css";
import { hhmm } from "@/features/home/format";
import { DayLabel } from "@/features/pos/invoices-client";
import { PosNav } from "@/features/pos/pos-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State =
  "ready" | "loading" | "empty" | "offline" | "stale" | "pending_sync" | "permission_denied";
type Range = "30" | "all";

interface ServerRow {
  readonly doc: string;
  readonly doc_id: string;
  readonly kind: string;
  readonly label: string;
  readonly occurred_at: string;
  readonly business_date: string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly balance_minor: string;
  readonly branch_id: string;
  readonly info: boolean;
}

interface Statement {
  readonly party: {
    readonly id: string;
    readonly name: string;
    readonly phone: string;
    readonly balance_as_of?: string;
    readonly updated_at: string;
  };
  readonly rows: readonly ServerRow[];
  readonly balance_minor: string;
  readonly hidden_other_branch: number;
  readonly last_payment_at: string;
  readonly oldest_unpaid_at: string;
  readonly as_of: string;
  readonly scope: "all" | "branch";
  readonly branch_names: Record<string, string>;
  readonly range: Range;
}

/** صف الكشف على الشاشة: خادمي (مؤكد) أو محلي معلّق من هذا الجهاز داخل في الرصيد. */
interface Row {
  readonly id: string;
  readonly doc: string;
  readonly at: string;
  readonly label: string;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
  readonly branch: string;
  readonly tag: "confirmed" | "pending" | "opening";
  readonly info: boolean;
}

const cacheKey = (id: string) => `parties.statement.${id}`;

const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function fullDate(iso: string): { day: string; month: string; year: string } {
  const d = new Date(iso);
  return {
    day: String(d.getDate()).padStart(2, "0"),
    month: MONTHS[d.getMonth()] ?? "",
    year: String(d.getFullYear()),
  };
}

/** «منذ N يوماً» بأرقام لاتينية داخل mono والكلمة خارجه. */
function Since({ iso, now }: { iso: string; now: Date }) {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return <>اليوم</>;
  if (days === 1) return <>منذ يوم</>;
  if (days === 2) return <>منذ يومين</>;
  return (
    <>
      منذ <span className="sting-mono">{days}</span> {days <= 10 ? "أيام" : "يوماً"}
    </>
  );
}

/**
 * PTY-05 — كشف الحساب — الشاشة المحورية (04-D2 pending_sync · 40-D32 ready/loading/empty/stale/
 * offline/permission_denied): كشف متتابع مدين/دائن/رصيد يبدأ بسطر «رصيد افتتاحي»؛ البيع الآجل
 * من POS-07 يظهر بوسم «معلّق — هذا الجهاز» وهو داخل الرصيد (ACC-02/03)؛ التركيب معلَن «خادمي X +
 * معلّق Y»؛ فواتير فرع آخر تدخل الرصيد المؤسسي دون تفاصيلها (ACC-46)؛ لا أعمار ديون (G-15).
 */
export function StatementClient({ partyId }: { partyId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [range, setRange] = useState<Range>("30");
  const [party, setParty] = useState<{ name: string; phone: string; since: string } | null>(null);
  const [localPending, setLocalPending] = useState<readonly LocalSale[]>([]);
  const [data, setData] = useState<Statement | null>(null);
  const [cached, setCached] = useState<Statement | null>(null);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [fetching, setFetching] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;
  const now = new Date();

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/parties/${partyId}/statement`)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [parties, sales, raw] = await Promise.all([
        readLocalParties(storage),
        readSales(storage),
        storage.read((tx) => tx.getMeta(cacheKey(partyId))),
      ]);
      const local = parties.find((p) => p.id === partyId);
      if (local) setParty({ name: local.name, phone: local.phone, since: local.updated_at || "" });
      const asOf =
        (
          (await storage.read((tx) => tx.getProjection(PARTY_PREFIX + partyId)))?.value as
            { balance_as_of?: string } | undefined
        )?.balance_as_of ?? "";
      // المعلّق من هذا الجهاز: آجل لم يؤكَّد أو وقع بعد تغطية الرصيد الخادمي (§٢٤)
      const pend: LocalSale[] = [];
      for (const s of sales) {
        if (s.party_id !== partyId || BigInt(s.credit_minor) <= 0n) continue;
        const op = await storage.read((tx) => tx.getOperation(s.operation_id));
        const covered = op?.state === "synced" && (!asOf || s.occurred_at <= asOf);
        if (!covered) pend.push(s);
      }
      setLocalPending(pend);
      if (raw) setCached(JSON.parse(raw) as Statement);
    })();
  }, [partyId, router]);

  useEffect(() => {
    if (!online) return;
    let alive = true;
    setFetching(true);
    setFailed(false);
    void (async () => {
      try {
        const { data, response } = await api().GET("/api/parties/{party_id}/statement", {
          params: { path: { party_id: partyId }, query: { range } },
        });
        if (!alive) return;
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        const body = data as unknown as Statement | undefined;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
        setParty({
          name: body.party.name,
          phone: body.party.phone,
          since: body.party.updated_at,
        });
        await getStorage().transaction((tx) => tx.putMeta(cacheKey(partyId), JSON.stringify(body)));
      } catch {
        if (alive) setFailed(true);
      } finally {
        if (alive) setFetching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [online, partyId, range]);

  const server = data ?? cached;
  const serverIds = new Set((server?.rows ?? []).map((r) => r.doc_id));
  const serverBalance = server ? BigInt(server.balance_minor) : null;
  const pendingRows = localPending.filter((s) => !serverIds.has(s.id));
  const pendingMinor = pendingRows.reduce((a, s) => a + BigInt(s.credit_minor), 0n);
  const balance = serverBalance === null ? null : serverBalance + pendingMinor;

  let running = serverBalance ?? 0n;
  const rows: Row[] = [
    ...(server?.rows ?? []).map((r): Row => ({
      id: r.doc_id,
      doc: r.doc,
      at: r.occurred_at,
      label: r.label,
      debit: r.debit_minor,
      credit: r.credit_minor,
      balance: r.balance_minor,
      branch: r.branch_id ? (server?.branch_names[r.branch_id] ?? "") : "",
      tag: r.kind === "opening" ? ("opening" as const) : ("confirmed" as const),
      info: r.info,
    })),
    ...pendingRows.map((s) => {
      running += BigInt(s.credit_minor);
      const pure = BigInt(s.cash_minor) === 0n && BigInt(s.bank_minor) === 0n;
      return {
        id: s.id,
        doc: s.invoice_number,
        at: s.occurred_at,
        label: pure ? "بيع آجل" : "بيع مختلط — الجزء الآجل",
        debit: s.credit_minor,
        credit: "",
        balance: serverBalance === null ? "" : running.toString(),
        branch: "",
        tag: "pending" as const,
        info: false,
      };
    }),
  ];

  const state: State = denied
    ? "permission_denied"
    : !online
      ? "offline"
      : failed && server
        ? "stale"
        : (fetching && data === null) || (!server && !failed)
          ? "loading"
          : server && server.hidden_other_branch > 0
            ? "permission_denied"
            : pendingRows.length > 0
              ? "pending_sync"
              : rows.length === 0
                ? "empty"
                : "ready";

  const columns = [
    {
      key: "doc",
      header: "التاريخ والمستند",
      render: (r: Row) => (
        <div>
          <div className="sting-mono">{r.doc}</div>
          <div className="acc-choice__note">
            {r.tag === "opening" ? (
              <>
                <span className="sting-mono">{fullDate(r.at).day}</span> {fullDate(r.at).month}{" "}
                <span className="sting-mono">{fullDate(r.at).year}</span>
              </>
            ) : (
              <>
                <DayLabel iso={r.at} now={now} /> <span className="sting-mono">{hhmm(r.at)}</span>
              </>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "label",
      header: "البيان",
      render: (r: Row) => (
        <div className="shift-status">
          <span>{r.label}</span>
          <Status
            state={r.tag === "pending" ? "pending_sync" : r.tag === "opening" ? "empty" : "synced"}
            label={
              r.tag === "pending"
                ? "معلّق — هذا الجهاز"
                : r.tag === "opening"
                  ? "رصيد افتتاحي"
                  : "مؤكد"
            }
            dot={false}
          />
        </div>
      ),
    },
    {
      key: "debit",
      header: "عليه",
      mono: true,
      render: (r: Row) => (r.debit ? formatMinor(r.debit) : "—"),
    },
    {
      key: "credit",
      header: "له",
      mono: true,
      render: (r: Row) => (r.credit ? formatMinor(r.credit) : "—"),
    },
    {
      key: "balance",
      header: "الرصيد",
      mono: true,
      // «لا رصيد جزئي»: الرصيد الجاري لا يُعرض قبل اكتمال السلسلة من الخادم
      render: (r: Row) => (r.balance ? formatMinor(r.balance) : "—"),
    },
    { key: "branch", header: "الفرع", render: (r: Row) => r.branch || "الرئيسي" },
  ];

  const openDoc = (r: Row) => {
    if (r.tag !== "opening" && !r.info) router.push(`/pos/invoices/${r.id}`);
  };

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={!denied} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">كشف حساب{party ? <> — {party.name}</> : null}</h2>
            {party?.phone ? (
              <span className="cat-head__hint">
                <span className="sting-mono">{maskPhone(party.phone)}</span>
                {party.since ? (
                  <>
                    {" "}
                    · عميل منذ {fullDate(party.since).month}{" "}
                    <span className="sting-mono">{fullDate(party.since).year}</span>
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            <div className="pty-balance">
              <span className="shift-facts__k">الرصيد الحالي — عليه</span>
              <span className="pty-balance__v sting-mono">
                {balance === null ? "—" : formatMinor(balance.toString())}
              </span>
              <span className="acc-choice__note">
                آخر تحديث خادمي{" "}
                <span className="sting-mono">{server ? hhmm(server.as_of) : "—"}</span>
                {pendingRows.length ? <> + معلّق هذا الجهاز</> : null}
              </span>
              {pendingRows.length && serverBalance !== null ? (
                <span className="acc-choice__note">
                  خادمي <span className="sting-mono">{formatMinor(serverBalance.toString())}</span>{" "}
                  + معلّق <span className="sting-mono">{formatMinor(pendingMinor.toString())}</span>{" "}
                  = <span className="sting-mono">{formatMinor((balance ?? 0n).toString())}</span>
                </span>
              ) : null}
              <span className="acc-choice__note">
                {server?.last_payment_at ? (
                  <>
                    آخر سداد <DayLabel iso={server.last_payment_at} now={now} /> ·{" "}
                    <Since iso={server.last_payment_at} now={now} />
                  </>
                ) : (
                  "لا يوجد سداد مسجل"
                )}
                {server?.oldest_unpaid_at ? (
                  <>
                    {" "}
                    · أقدم حركة غير مسدَّدة <DayLabel iso={server.oldest_unpaid_at} now={now} />
                  </>
                ) : null}
              </span>
            </div>

            <div className="pos-inv__filters">
              <div className="pos-chips" role="group" aria-label="المدى">
                <button
                  type="button"
                  className={`pos-chip${range === "30" ? " pos-chip--on" : ""}`}
                  aria-pressed={range === "30"}
                  onClick={() => setRange("30")}
                >
                  آخر 30 يوماً
                </button>
                <button
                  type="button"
                  className={`pos-chip${range === "all" ? " pos-chip--on" : ""}`}
                  aria-pressed={range === "all"}
                  onClick={() => setRange("all")}
                >
                  كل الحركات
                </button>
              </div>
              <div className="pty-actions">
                <Button variant="secondary" disabledReason="الطباعة والتصدير مع PTY-08">
                  طباعة وتصدير
                </Button>
                <Button disabledReason="تسجيل السداد مع PTY-06">تسجيل سداد</Button>
              </div>
            </div>

            {state === "permission_denied" ? (
              <Notice kind="locked" title="كشف فرعٍ آخر">
                <p className="acc-lead">جهاز فرع يحسب رصيداً مؤسسياً نشأ بعضه في فرع آخر.</p>
                <p className="acc-choice__note">
                  <strong>الرصيد نعم والتفصيل لا</strong> · يُعرض الرصيد المؤسسي كاملاً (وهو حقيقة
                  الطرف)، ولا تُكشف فواتير الفرع الآخر (ACC-46).
                </p>
              </Notice>
            ) : null}
            {state === "loading" ? (
              <Notice kind="info" title="جارٍ الحساب">
                <p className="acc-lead">
                  الكشف يُحسب من كل الحركات ولا يُقرأ جاهزاً. مع عدد الحركات في المدى.
                </p>
                <p className="acc-choice__note">
                  <strong>لا رصيد جزئي</strong> · الرصيد الجاري لا يُعرض قبل اكتمال السلسلة — رقمٌ
                  وسيط في كشف حساب يُقرأ ويُصدَّق.
                </p>
              </Notice>
            ) : null}
            {state === "empty" ? (
              <Notice kind="empty" title="طرفٌ بلا حركات">
                <p className="acc-lead">أُنشئ ولم يُبع له ولا سُدّد منه.</p>
                <p className="acc-choice__note">
                  <strong>المسار</strong> · «سجّل رصيداً افتتاحياً» أو «ابدأ بيعاً آجلاً». والفراغ
                  هنا بدايةٌ لا نقص.
                </p>
              </Notice>
            ) : null}
            {state === "stale" ? (
              <Notice kind="warning" title="كشفٌ من آخر مطابقة">
                <p className="acc-lead">قبل ساعتين، وقد سدّد الطرف في فرع آخر.</p>
                <p className="acc-choice__note">
                  <strong>لا يُطبع بلا وسم</strong> · الطباعة تحمل «محدَّث 3:40 م» في الترويسة.
                  ورقةٌ بلا وقت تُقرأ لحظيةً بعد أسبوع.
                </p>
              </Notice>
            ) : null}
            {state === "offline" ? (
              <Notice kind="offline" title="كشف محلي">
                <p className="acc-lead">من بيانات الجهاز، ومعه ما لم يُرفع موسوماً سطراً سطراً.</p>
                <p className="acc-choice__note">
                  <strong>التركيب معلَن</strong> · «خادمي 340 + معلّق 100 = 440» (ACC-03). المجموع
                  وحده يُوهم بتأكيدٍ لم يحصل.
                </p>
              </Notice>
            ) : null}
            {state === "pending_sync" ? (
              <Notice kind="info" title="معلّق المزامنة">
                <p className="acc-lead">
                  {pendingRows.length === 1
                    ? "حركة واحدة معلقة من هذا الجهاز داخلة في الرصيد"
                    : pendingRows.length === 2
                      ? "حركتان معلقتان من هذا الجهاز داخلتان في الرصيد"
                      : `${pendingRows.length} حركات معلقة من هذا الجهاز داخلة في الرصيد`}
                </p>
              </Notice>
            ) : null}

            <Table
              caption="كشف الحساب"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={state === "loading" && rows.length === 0 ? 3 : undefined}
              onOpenRow={openDoc}
            />

            {pendingRows.length ? (
              <p className="acc-choice__note">
                الرصيد <span className="sting-mono">{formatMinor((balance ?? 0n).toString())}</span>{" "}
                يشمل فاتورة <span className="sting-mono">{pendingRows[0]!.invoice_number}</span>{" "}
                المعلّقة من هذا الجهاز. إن سجّل جهاز آخر سداداً لم يصلنا بعد فالرقم سيتغير عند
                المزامنة. الفواتير المنشأة في فرع آخر تدخل الرصيد المؤسسي دون أن تُعرض تفاصيلها هنا.
              </p>
            ) : null}
            <p className="acc-choice__note">
              لا جدول أعمار ديون (G-15): يُعرض «آخر سداد» و«أقدم حركة غير مسدَّدة» تاريخاً فقط.
              الأعمار تحتاج توزيع كل دفعة على فواتيرها، ومن لم يوزّع يُنتج أعماراً مخترعة.
            </p>
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push(`/parties/${partyId}`)}>
                بطاقة الطرف
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
