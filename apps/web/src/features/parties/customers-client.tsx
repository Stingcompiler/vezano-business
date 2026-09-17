"use client";

import {
  type LocalParty,
  maskPhone,
  readLocalParties,
  readPartiesMatchedAt,
  readPendingCreditByParty,
  type ServerParty,
  storeParties,
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

type State = "ready" | "loading" | "empty" | "offline" | "stale" | "permission_denied";
type Filter = "all" | "due" | "idle";

interface ListData {
  readonly kind: "customers" | "suppliers";
  readonly can_see_balances: boolean;
  readonly role_name: string;
  readonly as_of: string;
  readonly rows: readonly ServerParty[];
  readonly summary: {
    readonly count: number;
    readonly total_due_minor: string;
    readonly total_owed_minor: string;
  };
}

/** صف الشاشة: الرصيد المركّب «خادمي X + معلّق على جهازك Y = Z» (ACC-02). */
export interface Row {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly phone: string;
  readonly serverMinor: bigint | null;
  readonly pendingMinor: bigint;
  readonly pendingCount: number;
  readonly dueMinor: bigint | null;
  readonly limitMinor: bigint;
  readonly lastAt: string;
  readonly bothRoles: boolean;
}

const IDLE_DAYS = 30;

function toRow(
  p: LocalParty & { aliases?: readonly string[]; last_movement_at?: string },
  pending: { pendingMinor: bigint; count: number } | undefined,
): Row {
  const server =
    p.balance_minor === "" || p.balance_minor === undefined ? null : BigInt(p.balance_minor);
  const pendingMinor = pending?.pendingMinor ?? 0n;
  return {
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
    phone: p.phone,
    serverMinor: server,
    pendingMinor,
    pendingCount: pending?.count ?? 0,
    dueMinor: server === null ? (pendingMinor > 0n ? pendingMinor : null) : server + pendingMinor,
    limitMinor: BigInt(p.credit_limit_minor || "0"),
    lastAt: p.last_movement_at || p.last_sale_at || "",
    bothRoles: Boolean(p.is_customer && p.is_supplier),
  };
}

/**
 * PTY-01 — قائمة العملاء (04-D2 ready · 40-D32 loading/empty/offline/stale/permission_denied):
 * الأسماء من الجهاز فوراً والأرصدة تُوسم حتى تُطابَق؛ الرصيد مركّب لا مجموع وحده؛ الترتيب بالمبلغ
 * أو بتاريخ آخر حركة — لا «عمر دين» (G-15)؛ الكاشير يرى من يبيع له (POS-04) لا القائمة كاملةً.
 */
export function CustomersClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [local, setLocal] = useState<readonly LocalParty[] | null>(null);
  const [pending, setPending] = useState<Map<string, { pendingMinor: bigint; count: number }>>(
    new Map(),
  );
  const [matchedAt, setMatchedAt] = useState<string | null>(null);
  const [data, setData] = useState<ListData | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: string; dir: "ascending" | "descending" }>({
    key: "due",
    dir: "descending",
  });
  const appRef = useRef(app);
  appRef.current = app;
  const now = new Date();

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fparties");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [parties, pend, at] = await Promise.all([
        readLocalParties(storage),
        readPendingCreditByParty(storage),
        readPartiesMatchedAt(storage),
      ]);
      setLocal(parties);
      setPending(pend);
      setMatchedAt(at);
      if (!navigator.onLine) return;
      try {
        const { data, response } = await api().GET("/api/parties/list", {
          params: { query: { kind: "customers" } },
        });
        const body = data as unknown as ListData | undefined;
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        await storeParties(storage, body.rows, body.as_of);
        setData(body);
        setLocal(await readLocalParties(storage));
        setPending(await readPendingCreditByParty(storage));
        setMatchedAt(body.as_of);
      } catch {
        setFailed(true);
      }
    })();
  }, [router]);

  const rowsAll: Row[] = (local ?? [])
    .filter((p) => p.is_active !== false && p.is_customer !== false)
    .map((p) => toRow(p, pending.get(p.id)));
  const idleBefore = now.getTime() - IDLE_DAYS * 86_400_000;
  let rows = rowsAll.filter((r) =>
    filter === "due"
      ? (r.dueMinor ?? 0n) > 0n
      : filter === "idle"
        ? !r.lastAt || new Date(r.lastAt).getTime() < idleBefore
        : true,
  );
  rows = [...rows].sort((a, b) => {
    const dir = sort.dir === "ascending" ? 1 : -1;
    if (sort.key === "last") return dir * a.lastAt.localeCompare(b.lastAt);
    const da = a.dueMinor ?? 0n;
    const db = b.dueMinor ?? 0n;
    return da === db ? a.name.localeCompare(b.name, "ar") : dir * (da > db ? 1 : -1);
  });

  const state: State = denied
    ? "permission_denied"
    : local === null
      ? "loading"
      : !online
        ? "offline"
        : failed
          ? "stale"
          : data === null
            ? "loading"
            : rowsAll.length === 0
              ? "empty"
              : "ready";

  const totalDue = rowsAll.reduce(
    (acc, r) => acc + (r.dueMinor && r.dueMinor > 0n ? r.dueMinor : 0n),
    0n,
  );
  const pendingOps = rowsAll.reduce((acc, r) => acc + r.pendingCount, 0);

  const columns = [
    {
      key: "name",
      header: "الاسم",
      render: (r: Row) => (
        <div>
          <Button variant="quiet" className="shift-row__open" onClick={() => open(r)}>
            {r.name}
          </Button>
          <div className="acc-choice__note">
            {r.bothRoles ? "عميل ومورد" : r.aliases.length ? r.aliases.join(" · ") : "—"}
          </div>
        </div>
      ),
    },
    { key: "phone", header: "الهاتف", mono: true, render: (r: Row) => maskPhone(r.phone) || "—" },
    {
      key: "due",
      header: "عليه",
      sortable: true,
      // الرقم وحده في mono — ملاحظة التركيب عربية خارجه (القاعدة 2)
      render: (r: Row) => (
        <div className="pty-due">
          <span className={`sting-mono${r.dueMinor && r.dueMinor > 0n ? " pty-due__v" : ""}`}>
            {r.dueMinor === null ? "—" : formatMinor(r.dueMinor.toString())}
          </span>
          {r.pendingMinor > 0n ? (
            <span className="acc-choice__note">
              خادمي{" "}
              <span className="sting-mono">{formatMinor((r.serverMinor ?? 0n).toString())}</span> +
              معلّق على جهازك{" "}
              <span className="sting-mono">{formatMinor(r.pendingMinor.toString())}</span>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "limit",
      header: "حد الائتمان",
      render: (r: Row) =>
        r.limitMinor > 0n ? (
          <span className="pty-limit">
            <span className="sting-mono">{formatMinor(r.limitMinor.toString())}</span>
            {r.dueMinor !== null && r.dueMinor > r.limitMinor ? (
              <Status state="stale" label="تجاوز الحد" dot={false} />
            ) : null}
          </span>
        ) : (
          "غير محدد"
        ),
    },
    {
      key: "last",
      header: "آخر حركة",
      sortable: true,
      render: (r: Row) =>
        r.lastAt ? (
          <>
            <DayLabel iso={r.lastAt} now={now} />{" "}
            <span className="sting-mono">{hhmm(r.lastAt)}</span>
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "statement",
      header: "كشف الحساب",
      render: (r: Row) => (
        <Button variant="secondary" onClick={() => open(r)}>
          كشف الحساب
        </Button>
      ),
    },
  ];

  const open = (r: Row) => router.push(`/parties/${r.id}/statement`);

  return (
    <Frame
      title="العملاء والذمم"
      nav={<PosNav currentId="parties" canSeeReports={!denied} />}
      footer={null}
    >
      <div className="pos" data-screen="PTY-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">قائمة العملاء</h2>
            <span className="cat-head__hint">
              بحث وأسماء بديلة ورصيد مخوَّل. الكاشير يرى رصيد العميل الذي يبيع له فقط، ولا يرى قائمة
              الذمم كاملة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" ? (
              <Notice
                kind="locked"
                title="الكاشير يرى من يبيع له"
                action={<Button onClick={() => router.push("/pos/customer")}>اختيار العميل</Button>}
              >
                <p className="acc-lead">
                  يرى الطرف ورصيده وقت البيع، ولا يرى القائمة كاملةً بأرصدتها.
                </p>
                <p className="acc-lead">
                  <strong>لماذا</strong> · القائمة الكاملة صورةٌ مالية للمنشأة. رؤية رصيد من أمامك
                  حاجةُ عمل؛ رؤية الجميع ليست كذلك.
                </p>
              </Notice>
            ) : (
              <>
                <div className="pos-inv__filters">
                  <div className="pos-chips" role="group" aria-label="العملاء">
                    {(
                      [
                        ["all", "كل العملاء"],
                        ["due", "عليهم رصيد"],
                        ["idle", "بلا حركة 30 يوماً"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`pos-chip${filter === id ? " pos-chip--on" : ""}`}
                        aria-pressed={filter === id}
                        onClick={() => setFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="pty-actions">
                    <Button onClick={() => router.push("/pos/customer")}>عميل جديد</Button>
                    <Button variant="quiet" onClick={() => router.push("/parties/suppliers")}>
                      قائمة الموردين
                    </Button>
                  </div>
                </div>

                {state === "loading" ? (
                  <Notice kind="info" title="جلب الأطراف">
                    <p className="acc-lead">
                      المحلي فوراً ثم تُطابَق الأرصدة. الأسماء لا تنتظر الخادم؛ الأرصدة تُوسم حتى
                      تُطابَق.
                    </p>
                    <p className="acc-choice__note">
                      <strong>التفريق مقصود</strong> · الكاشير يبحث عن اسم ليبيع، فلا يُحبَس على
                      رصيدٍ لم يصل.
                    </p>
                  </Notice>
                ) : null}
                {state === "offline" ? (
                  <Notice kind="offline" title="أرصدة محلية">
                    <p className="acc-lead">
                      الأسماء كاملة والأرصدة من آخر مطابقة، ومعها ما لم يُرفع من هذا الجهاز.
                    </p>
                    <p className="acc-choice__note">
                      <strong>الرصيد مركّب</strong> · «خادمي 1,240 + معلّق على جهازك 100 = 1,340» —
                      نعرض التركيب لا المجموع وحده (ACC-02).
                    </p>
                  </Notice>
                ) : null}
                {state === "stale" ? (
                  <Notice kind="warning" title="أرصدة قديمة">
                    <p className="acc-lead">المطابقة متعثّرة وقد سدّد طرفٌ في فرع آخر.</p>
                    <p className="acc-choice__note">
                      <strong>الخطر المحدد</strong> · أن تُطالب من سدّد. الوقت مع كل رصيد لا في
                      ترويسة الصفحة.
                    </p>
                  </Notice>
                ) : null}
                {state === "empty" ? (
                  <Notice kind="empty" title="لا عملاء">
                    <p className="acc-lead">محلٌّ نقدي بالكامل. حالةٌ سويّة لا نقص.</p>
                    <p className="acc-choice__note">
                      <strong>لا نُلحّ</strong> · العميل يُنشأ حين يُباع له آجلاً (POS-04). إنشاء
                      قائمة عملاء مسبقاً عملٌ لا يحتاجه أحد.
                    </p>
                  </Notice>
                ) : null}

                <Table
                  caption="العملاء"
                  columns={columns}
                  rows={rows}
                  rowKey={(r) => r.id}
                  sort={sort}
                  onSort={(key) =>
                    setSort((s) => ({
                      key,
                      dir: s.key === key && s.dir === "descending" ? "ascending" : "descending",
                    }))
                  }
                  loading={state === "loading" && rows.length === 0 ? 3 : undefined}
                  onOpenRow={open}
                />

                <div className="pos-inv__foot">
                  <span>
                    <span className="sting-mono">{rowsAll.length}</span> عملاء · مجموع ما على
                    العملاء <span className="sting-mono">{formatMinor(totalDue.toString())}</span>
                  </span>
                  <span className="acc-choice__note">
                    آخر تحديث خادمي{" "}
                    <span className="sting-mono">{matchedAt ? hhmm(matchedAt) : "—"}</span>
                    {pendingOps > 0 ? (
                      <>
                        {" "}
                        — يشمل{" "}
                        {pendingOps === 1
                          ? "عملية واحدة معلقة"
                          : pendingOps === 2
                            ? "عمليتين معلقتين"
                            : `${pendingOps} عمليات معلقة`}{" "}
                        من هذا الجهاز
                      </>
                    ) : null}
                  </span>
                </div>
                <p className="acc-choice__note">حد الائتمان اختياري · تنبيه لا منع</p>
              </>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
