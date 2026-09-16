"use client";

import { type ClosedShift, readPendingClosedShifts } from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status, Table, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/shifts/shifts.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";

type State = "ready" | "empty" | "conflict" | "permission_denied" | "stale";

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

/** حركات الصندوق كما تُسمّى في SHIFT-03؛ مستندات POS/PTY تأتي بتسمياتها مع وحداتها. */
const KIND_LABEL: Record<string, string> = {
  deposit: "إيداع",
  withdrawal: "سحب",
  expense: "مصروف",
  sale: "بيع نقدي",
  receipt: "سداد",
  refund: "مرتجع نقدي",
};

interface LateItem {
  readonly id: string;
  readonly number: string;
  readonly kind: string;
  readonly signed_amount_minor: string;
  readonly occurred_at: string;
  readonly received_at: string;
  readonly reviewed: boolean;
}

interface Review {
  readonly signed_amount_minor: string;
  readonly approved_by_name: string;
  readonly reason: string;
  readonly occurred_at: string;
}

/** صف سجل الورديات كما يعيده `GET /api/shifts/review` (الخادم يرتّبه بالقيمة لا بالتاريخ). */
interface ServerRow {
  readonly id: string;
  readonly branch_name: string;
  readonly device_name: string;
  readonly user_name: string;
  readonly opened_at: string;
  readonly closed_at: string;
  readonly state: "open" | "closed";
  readonly count_status: string;
  readonly expected_cash_at_close_minor: string;
  readonly expected_cash_minor: string;
  readonly counted_cash_minor: string;
  readonly counted_by_name: string;
  readonly variance_minor: string;
  readonly open_hours: number;
  readonly abandoned: boolean;
  readonly review: Review | null;
  readonly late_items: readonly LateItem[];
}

interface ReviewData {
  readonly scope: "all" | "branch";
  readonly can_settle: boolean;
  readonly role_name: string;
  readonly user_name: string;
  readonly branch_name: string;
  readonly window_days: number;
  readonly shifts: readonly ServerRow[];
}

/** صف الشاشة: خادمي، أو مقفل محلياً ولم يُرفع (يُسمّى ويُستثنى من المجموع). */
interface Row {
  readonly id: string;
  readonly source: "server" | "local";
  readonly userName: string;
  readonly branchName: string;
  readonly deviceName: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly open: boolean;
  readonly abandoned: boolean;
  readonly openHours: number;
  readonly expectedMinor: string;
  readonly countedMinor: string;
  readonly counted: boolean;
  readonly varianceMinor: string;
  readonly review: Review | null;
  readonly lateItems: readonly LateItem[];
}

/** «حركتين معلقتين» / «4 ساعات» — صيغ العدد تتبع المعدود؛ الرقم لاتيني في mono. */
function CountWord({
  n,
  one,
  two,
  few,
  many,
}: {
  n: number;
  one: string;
  two: string;
  few: string;
  many: string;
}) {
  if (n === 1) return <>{one}</>;
  if (n === 2) return <>{two}</>;
  return (
    <>
      <span className="sting-mono">{n}</span> {n >= 3 && n <= 10 ? few : many}
    </>
  );
}

/** «أمس» / «اليوم» / «10 سبتمبر» — الكلمة العربية خارج mono والرقم داخله. */
function DayLabel({ iso, now }: { iso: string; now: Date }) {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return <>اليوم</>;
  if (diff === 1) return <>أمس</>;
  return (
    <>
      <span className="sting-mono">{String(d.getDate()).padStart(2, "0")}</span>{" "}
      {MONTHS[d.getMonth()]}
    </>
  );
}

function Mono({ children }: { children: string }) {
  return <span className="sting-mono">{children}</span>;
}

function toRow(s: ServerRow): Row {
  return {
    id: s.id,
    source: "server",
    userName: s.user_name,
    branchName: s.branch_name,
    deviceName: s.device_name,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    open: s.state === "open",
    abandoned: s.abandoned,
    openHours: s.open_hours,
    expectedMinor: s.state === "open" ? s.expected_cash_minor : s.expected_cash_at_close_minor,
    countedMinor: s.counted_cash_minor,
    counted: s.count_status === "counted",
    varianceMinor: s.variance_minor,
    review: s.review,
    lateItems: s.late_items,
  };
}

function localRow(s: ClosedShift): Row {
  const counted = s.count_status === "counted";
  const variance =
    counted && s.expected_cash_at_close_minor
      ? (BigInt(s.counted_cash_minor) - BigInt(s.expected_cash_at_close_minor)).toString()
      : "";
  return {
    id: s.id,
    source: "local",
    userName: s.user_name,
    branchName: s.branch_name,
    deviceName: s.device_name,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    open: false,
    abandoned: false,
    openHours: 0,
    expectedMinor: s.expected_cash_at_close_minor,
    countedMinor: counted ? s.counted_cash_minor : "",
    counted,
    varianceMinor: variance,
    review: null,
    lateItems: [],
  };
}

const unreviewedLate = (r: Row) => r.lateItems.some((i) => !i.reviewed);
const hasVariance = (r: Row) => r.varianceMinor !== "" && r.varianceMinor !== "0";
/** الفارق بإشارته: «−150.00» نقصاً و«+60.00» زيادةً و«0.00» مطابقة. */
const signed = (minor: string) =>
  BigInt(minor) > 0n ? `+${formatMinor(minor)}` : formatMinor(minor);

/**
 * SHIFT-05 — مراجعة فروق وعمليات متأخرة (38-D30 ready/empty/permission_denied/stale · 06-D2
 * conflict · 15-D10 سجل الورديات). شاشة المالك بعد الإقفال: الفوارق مرتّبة بالقيمة لا بالتاريخ،
 * الفارق يُنسب للوردية لا للشخص، لقطة الإغلاق ثابتة والحركة المتأخرة تُعرض منفصلة ولا تعدّلها
 * (ACC-68)، التسوية للمالك وحده، والوردية المهجورة تُسمّى ولا تُقفل بالمتوقَّع.
 */
export function ReviewShiftsClient() {
  const router = useRouter();
  const app = useApp();
  const [data, setData] = useState<ReviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [local, setLocal] = useState<readonly ClosedShift[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;
  const now = new Date();

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fshifts%2Freview");
      return;
    }
    void (async () => {
      setLocal(await readPendingClosedShifts(getStorage()));
      try {
        const { data, response } = await api().GET("/api/shifts/review");
        // العقد لا يصف الجسم (responses: None) — الشكل من الخادم مباشرةً
        const body: ReviewData | undefined = data;
        if (!response.ok || !body) {
          setFailed(true);
          return;
        }
        setData(body);
      } catch {
        setFailed(true);
      }
    })();
  }, [router]);

  const localIds = new Set(local.map((s) => s.id));
  const rows: Row[] = [
    ...local.map(localRow),
    ...(data?.shifts ?? []).filter((s) => !localIds.has(s.id)).map(toRow),
  ];
  const serverRows = rows.filter((r) => r.source === "server");
  const canSettle = data?.can_settle ?? false;
  const firstConflict = rows.find(unreviewedLate) ?? null;
  const selected =
    (touched ? rows.find((r) => r.id === selectedId) : (firstConflict ?? null)) ?? null;
  const abandoned = rows.filter((r) => r.abandoned);
  const attention = serverRows.some(
    (r) => r.abandoned || !r.counted || hasVariance(r) || unreviewedLate(r),
  );

  const state: State =
    data && !data.can_settle
      ? "permission_denied"
      : selected && unreviewedLate(selected)
        ? "conflict"
        : local.length > 0
          ? "stale"
          : data && !attention && !touched
            ? "empty"
            : "ready";

  // المجموع من الخادمي وحده — المقفل محلياً «يُسمّى ويُستثنى من المجموع» (38-D30 stale)
  const total = serverRows.reduce(
    (acc, r) => (r.varianceMinor ? acc + BigInt(r.varianceMinor) : acc),
    0n,
  );

  const review = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const { data: out, response } = await api().POST("/api/shifts/{shift_id}/review", {
        params: { path: { shift_id: selected.id } },
        body: { reason: reason.trim() },
      });
      const body = out as unknown as { row: ServerRow } | undefined;
      if (!response.ok || !body) return;
      const updated = body.row;
      setData((d) =>
        d ? { ...d, shifts: d.shifts.map((s) => (s.id === updated.id ? updated : s)) } : d,
      );
      // البطاقة تبقى مفتوحة بعد الإقرار ليُقرأ ما سُجّل باسم من
      setTouched(true);
      setSelectedId(updated.id);
      setReason("");
    } finally {
      setBusy(false);
    }
  };

  const openRow = (r: Row) => {
    if (r.source !== "server" || r.open) return;
    setTouched(true);
    setSelectedId(r.id);
    setReason("");
  };

  const columns = [
    {
      key: "who",
      header: "الوردية والمسؤول",
      render: (r: Row) => (
        <div>
          {r.source === "server" && !r.open ? (
            <Button variant="quiet" className="shift-row__open" onClick={() => openRow(r)}>
              <span className="shift-row__kind">{r.userName}</span>
            </Button>
          ) : (
            <div className="shift-row__kind">{r.userName}</div>
          )}
          <div className="acc-choice__note">
            <DayLabel iso={r.openedAt} now={now} /> <Mono>{hhmm(r.openedAt)}</Mono>
            {r.open ? (
              <> — لم تُقفل</>
            ) : r.source === "local" ? (
              <> · جهاز بلا اتصال</>
            ) : (
              <>
                {" – "}
                <Mono>{hhmm(r.closedAt)}</Mono>
              </>
            )}
          </div>
          {data?.scope === "all" ? (
            <div className="acc-choice__note">
              {r.branchName} · {r.deviceName}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: "expected",
      header: "المتوقع",
      mono: true,
      render: (r: Row) => (r.expectedMinor ? formatMinor(r.expectedMinor) : "—"),
    },
    {
      key: "counted",
      header: "المعدود",
      mono: true,
      render: (r: Row) => (r.counted ? formatMinor(r.countedMinor) : "—"),
    },
    {
      key: "variance",
      header: "الفارق",
      mono: true,
      render: (r: Row) => (
        <span
          className={
            r.varianceMinor
              ? BigInt(r.varianceMinor) < 0n
                ? "shift-var--short"
                : BigInt(r.varianceMinor) > 0n
                  ? "shift-var--over"
                  : "shift-var--ok"
              : undefined
          }
        >
          {r.varianceMinor ? signed(r.varianceMinor) : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "الحالة",
      render: (r: Row) => <RowStatus row={r} />,
    },
  ];

  return (
    <Frame title="الورديات" nav={<AppNav currentId="home" />} footer={null}>
      <div className="home" data-screen="SHIFT-05" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">مراجعة فروق وعمليات متأخرة</h2>
            {abandoned.length > 0 ? (
              <Status
                state="server_error"
                label={
                  <>
                    <CountWord
                      n={abandoned.length}
                      one="وردية واحدة مفتوحة"
                      two="ورديتان مفتوحتان"
                      few="ورديات مفتوحة"
                      many="وردية مفتوحة"
                    />{" "}
                    منذ{" "}
                    <CountWord
                      n={Math.max(1, Math.floor((abandoned[0]?.openHours ?? 0) / 24))}
                      one="يوم"
                      two="يومين"
                      few="أيام"
                      many="يوماً"
                    />
                  </>
                }
              />
            ) : null}
          </div>
          <div className="acc-card__body">
            {state === "permission_denied" && data ? (
              <Notice kind="locked" title="مدير الفرع يرى فرعه">
                <p className="acc-lead">يرى فوارق ورديات فرعه ولا يرى الفروع الأخرى.</p>
                <p className="acc-lead">
                  <strong>التسوية للمالك</strong> · المدير يراجع ويعلّق ولا يُسوّي — التسوية إقرارٌ
                  مالي بقبول الفارق.
                </p>
              </Notice>
            ) : null}

            {state === "stale" ? (
              <Notice kind="warning" title="وردية لم تُزامَن بعد">
                <p className="acc-lead">وردية أُقفلت على جهازٍ لم يرفع بعد، فرقمها هنا ناقص.</p>
                <p className="acc-lead">
                  <CountWord
                    n={local.length}
                    one="وردية واحدة بانتظار المزامنة"
                    two="ورديتان بانتظار المزامنة"
                    few="ورديات بانتظار المزامنة"
                    many="وردية بانتظار المزامنة"
                  />
                </p>
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice kind="empty" title="لا فوارق">
                <p className="acc-lead">كل الورديات أُقفلت مطابقةً.</p>
                {serverRows.length > 0 ? (
                  <p className="acc-lead">
                    <CountWord
                      n={serverRows.length}
                      one="وردية واحدة في الأسبوع"
                      two="ورديتان في الأسبوع"
                      few="ورديات في الأسبوع"
                      many="وردية في الأسبوع"
                    />{" "}
                    · كلها مطابقة
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {selected ? (
              <ReviewCard
                row={selected}
                now={now}
                canSettle={canSettle}
                reason={reason}
                onReason={setReason}
                busy={busy}
                onReview={() => void review()}
                onOpenDoc={() => router.push(`/shifts/current?id=${selected.id}`)}
              />
            ) : null}

            <div className="cat-head">
              <h3 className="cat-head__title">الفوارق مرتّبةً بالقيمة</h3>
              <span className="cat-head__hint">
                كل وردية بفارقها ومن عدّها.{" "}
                {serverRows.length > 0 ? (
                  <>
                    الفارق <span className="sting-mono">{signed(total.toString())}</span>
                  </>
                ) : null}
              </span>
            </div>
            <Table
              caption={`سجل الورديات — ${MONTHS[now.getMonth()] ?? ""}`}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={data || failed ? undefined : 3}
              onOpenRow={openRow}
            />
            {abandoned.length > 0 ? (
              <div className="shift-abandoned">
                <Status state="server_error" label="وردية مهجورة" dot={false} />
                <p>
                  <strong>لن نُقفلها تلقائياً بالرقم المتوقع.</strong> إقفال بلا عدّ يعني أن النظام
                  شهد بأن الصندوق مطابق، وهو لم يعدّه. المسار: إقفال إداري بعدّ حاضر يُسجَّل باسم من
                  عدّ، وتُوسم الوردية «مقفلة بإجراء إداري» لا «مقفلة بشهادة الكاشير» — والفارق مهما
                  كان يُنسب للوردية لا لشخص غائب لم يوقّع.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** عمود «الحالة» (15-D10): شارة وملاحظة تشرح ما تراه لا حكماً على شخص. */
function RowStatus({ row: r }: { row: Row }) {
  if (r.source === "local")
    return (
      <div className="shift-status">
        <Status state="stale" label="مقفلة · معلّقة الرفع" />
        <div className="acc-choice__note">
          أُقفلت محلياً وتُرفع عند المزامنة — الأرقام نهائية عندك لا عند الخادم
        </div>
      </div>
    );
  if (r.open)
    return (
      <div className="shift-status">
        <Status
          state="server_error"
          label={
            <>
              مفتوحة{" "}
              <CountWord
                n={Math.max(1, Math.floor(r.openHours / 24))}
                one="يوماً"
                two="يومين"
                few="أيام"
                many="يوماً"
              />
            </>
          }
        />
        <div className="acc-choice__note">
          الصندوق لم يُعدّ. المتوقع ليس عدّاً ولا يصلح إقفالاً.
        </div>
      </div>
    );
  if (unreviewedLate(r))
    return (
      <div className="shift-status">
        <Status state="conflict" label="تعارض" />
        <div className="acc-choice__note">وصلت بعد الإغلاق — خارج اللقطة</div>
      </div>
    );
  if (!r.counted)
    return (
      <div className="shift-status">
        <Status state="stale" label="مقفلة" />
        <div className="acc-choice__note">بلا عدّ — الفارق غير معروف.</div>
      </div>
    );
  const short = BigInt(r.varianceMinor) < 0n;
  if (r.review && hasVariance(r))
    return (
      <div className="shift-status">
        <Status state="synced" label="مقفلة ومعتمدة" />
        <div className="acc-choice__note">
          {short ? "عجز" : "زيادة"} معتمد{short ? "" : "ة"} باسم {r.review.approved_by_name} مع سبب
          مكتوب
        </div>
      </div>
    );
  if (hasVariance(r))
    return (
      <div className="shift-status">
        <Status state="stale" label="فارق غير معتمد" />
        <div className="acc-choice__note">
          {short ? "عجز" : "زيادة"} غير معتمد{short ? "" : "ة"} بعد — تظهر ببندها لا مدموجة
          بالمبيعات
        </div>
      </div>
    );
  return (
    <div className="shift-status">
      <Status state="synced" label="مقفلة" />
      <div className="acc-choice__note">مطابقة</div>
    </div>
  );
}

/**
 * بطاقة المراجعة (06-D2 conflict): لقطة الإغلاق مثبّتة «لا تتغير»، وما وصل بعد الإغلاق خارجها بنداً
 * مستقلاً، و«إقرار المراجعة» تسوية باسم المالك (بسبب حين يوجد فارق).
 */
function ReviewCard({
  row: r,
  now,
  canSettle,
  reason,
  onReason,
  busy,
  onReview,
  onOpenDoc,
}: {
  row: Row;
  now: Date;
  canSettle: boolean;
  reason: string;
  onReason: (v: string) => void;
  busy: boolean;
  onReview: () => void;
  onOpenDoc: () => void;
}) {
  const pending = r.lateItems.filter((i) => !i.reviewed);
  const items = pending.length ? pending : r.lateItems;
  const needsReason = hasVariance(r) && !r.review;
  const closedAt = new Date(r.closedAt);
  const short = r.varianceMinor && BigInt(r.varianceMinor) < 0n;
  return (
    <section className="shift-review" aria-label="مراجعة الوردية">
      <div className="shift-review__head">
        وردية <DayLabel iso={r.openedAt} now={now} /> <Mono>{hhmm(r.openedAt)}</Mono> –{" "}
        <Mono>{hhmm(r.closedAt)}</Mono> · {r.userName}
      </div>
      <div className="shift-snapshot">
        <div className="shift-snapshot__head">
          <span>
            لقطة الإغلاق — مثبّتة <Mono>{hhmm(r.closedAt)}</Mono>
          </span>
          <Status state="synced" label="لا تتغير" dot={false} />
        </div>
        <div className="shift-facts">
          <div>
            <span className="shift-facts__k">النقد المتوقع وقت الإغلاق</span>
            <span className="shift-facts__v sting-mono">{formatMinor(r.expectedMinor)}</span>
          </div>
          <div>
            <span className="shift-facts__k">المعدود</span>
            <span className="shift-facts__v sting-mono">
              {r.counted ? formatMinor(r.countedMinor) : "—"}
            </span>
          </div>
          <div>
            <span className="shift-facts__k">
              <strong>الفرق وقت الإغلاق</strong>
            </span>
            <span
              className={`shift-facts__v sting-mono ${
                r.varianceMinor
                  ? BigInt(r.varianceMinor) < 0n
                    ? "shift-var--short"
                    : BigInt(r.varianceMinor) > 0n
                      ? "shift-var--over"
                      : "shift-var--ok"
                  : ""
              }`}
            >
              {r.varianceMinor ? signed(r.varianceMinor) : "—"}
            </span>
          </div>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="shift-late">
          <div className="shift-late__head">وصلت بعد الإغلاق — خارج اللقطة</div>
          {items.map((i) => {
            const hours = Math.max(
              0,
              Math.round((new Date(i.received_at).getTime() - closedAt.getTime()) / 3_600_000),
            );
            return (
              <div key={i.id} className="shift-late__item">
                <div>
                  <div>
                    <Mono>{i.number || i.id.slice(0, 8).toUpperCase()}</Mono> ·{" "}
                    {KIND_LABEL[i.kind] ?? i.kind} سُجّل <Mono>{hhmm(i.occurred_at)}</Mono> على جهاز
                    غير متصل
                  </div>
                  <div className="acc-choice__note">
                    وصل الخادم <DayLabel iso={i.received_at} now={now} />{" "}
                    <Mono>{hhmm(i.received_at)}</Mono>
                  </div>
                </div>
                <div className="shift-late__amount">
                  <div className="sting-mono">{formatMinor(i.signed_amount_minor)}</div>
                  <div className="acc-choice__note">
                    بعد الإغلاق بـ
                    <CountWord n={hours} one="ساعة" two="ساعتين" few="ساعات" many="ساعة" />
                  </div>
                </div>
              </div>
            );
          })}
          <p className="shift-hidden">
            <strong>لن يتغير فرق الوردية المغلقة.</strong> اللقطة سجلٌ لما عُرف وقت الإغلاق. البيع
            المتأخر يُنسب إلى الوردية بتاريخه، ويُعرض هنا كبند مستقل، ويدخل تقرير المبيعات بيومه
            الصحيح — دون إعادة فتح الوردية ولا تعديل عدّها.
          </p>
        </div>
      ) : null}

      {r.review ? (
        <p className="cat-saving__note">
          {hasVariance(r) ? (
            <>
              {short ? "عجز" : "زيادة"} معتمد{short ? "" : "ة"} باسم{" "}
              <strong>{r.review.approved_by_name}</strong> مع سبب مكتوب
              {r.review.reason ? <> — {r.review.reason}</> : null}
            </>
          ) : (
            <>
              إقرار المراجعة باسم <strong>{r.review.approved_by_name}</strong>
            </>
          )}
        </p>
      ) : null}

      {needsReason && canSettle ? (
        <TextField
          label="السبب"
          hint="إلزامي"
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          disabledReason={busy ? "جارٍ الحفظ" : undefined}
          required
        />
      ) : null}

      <div className="cat-form__actions">
        {!r.review || pending.length > 0 ? (
          <Button
            onClick={onReview}
            loading={busy}
            financial
            disabledReason={
              !canSettle ? "التسوية للمالك" : needsReason && !reason.trim() ? "السبب" : undefined
            }
          >
            إقرار المراجعة
          </Button>
        ) : null}
        {r.lateItems.length > 0 ? (
          <Button variant="secondary" onClick={onOpenDoc}>
            فتح المستند المتأخر
          </Button>
        ) : null}
      </div>
    </section>
  );
}
