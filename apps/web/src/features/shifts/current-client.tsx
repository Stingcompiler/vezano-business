"use client";

import {
  type CashRow,
  type LocalShift,
  readOpenShift,
  readShift,
  readShiftCash,
  type ShiftCash,
} from "@sting/sync-core";
import { formatMinor, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/shifts/shifts.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "loading" | "offline" | "pending_sync" | "stale";

/** «حركتين معلقتين» / «4 ساعات» — صيغ العدد العربية تتبع المعدود؛ الرقم لاتيني في mono. */
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

const KIND_LABEL: Record<CashRow["kind"], string> = {
  opening: "افتتاح الدرج",
  deposit: "إيداع في الصندوق",
  withdrawal: "صرف من الصندوق",
  sale: "بيع نقدي",
  receipt: "سداد",
  refund: "مرتجع نقدي",
};
const SYNC_LABEL = { synced: "مؤكد", pending: "معلّق", conflict: "تعارض", quarantined: "محجور" };
const SYNC_STATE = {
  synced: "synced",
  pending: "pending_sync",
  conflict: "conflict",
  quarantined: "server_error",
} as const;

/**
 * SHIFT-02 — الوردية الحالية: حركات نقدية فعلية فقط (06-D2 pending_sync · 38-D30 ready/loading/offline ·
 * 15-D10 stale). الأرقام محلية أصلاً — من الجهاز فوراً ثم تُطابَق. جزء الأربعين من البيع المختلط
 * يدخل، والستون الآجلة لا تدخل (ACC-08/13): عمود «خارج الصندوق» يعرض ما لا يدخل النقد ولا يُحتسب.
 */
export function CurrentShiftClient() {
  const router = useRouter();
  const params = useSearchParams();
  const app = useApp();
  const online = useOnline();
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [cash, setCash] = useState<ShiftCash | null>(null);
  /** المطابقة مع الخادم: null = جارية (loading)، true = مطابَق، false = تعذّرت. */
  const [matched, setMatched] = useState<boolean | null>(null);

  useEffect(() => {
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fshifts%2Fcurrent");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const id = params.get("id");
      const s = id ? await readShift(storage, id) : await readOpenShift(storage);
      setShift(s);
      if (!s) return;
      setCash(await readShiftCash(storage, s));
      if (!online || !app.tokens) {
        setMatched(false);
        return;
      }
      try {
        const { response } = await api().GET("/api/shifts/{shift_id}", {
          params: { path: { shift_id: s.id } },
        });
        setMatched(response.ok);
      } catch {
        /* بلا اتصال فعلي: المحلي كامل لما بيع على هذا الجهاز */
        setMatched(false);
      }
    })();
  }, [app.expired, app.tokens, online, params, router]);

  useEffect(() => {
    if (shift === null) router.replace("/shifts/open");
  }, [router, shift]);

  // من الجهاز فوراً ثم تُطابَق: الأرقام المحلية تُعرض أثناء «جلب الوردية» — لا انتظار
  const state: State =
    !shift || !cash || (online && matched === null)
      ? "loading"
      : shift.state === "closed" && cash.openingSync !== "synced"
        ? "stale"
        : !online
          ? "offline"
          : cash.pendingCount > 0
            ? "pending_sync"
            : "ready";

  const hours = shift
    ? Math.floor((Date.now() - new Date(shift.opened_at).getTime()) / 3_600_000)
    : 0;
  const minutes = shift
    ? Math.floor((Date.now() - new Date(shift.opened_at).getTime()) / 60_000)
    : 0;
  const hasOut = cash?.rows.some((r) => r.outCashMinor) ?? false;

  const columns = [
    {
      key: "doc",
      header: "الوقت والمستند",
      render: (r: CashRow) => (
        <div>
          <div className="sting-mono">{r.doc}</div>
          <div className="acc-choice__note">
            <span className="sting-mono">{hhmm(r.time)}</span>
          </div>
        </div>
      ),
    },
    {
      key: "label",
      header: "البيان",
      render: (r: CashRow) => (
        <div>
          {KIND_LABEL[r.kind]}
          {r.note ? <div className="acc-choice__note">{r.note}</div> : null}
        </div>
      ),
    },
    {
      key: "in",
      header: "داخل الصندوق",
      mono: true,
      render: (r: CashRow) => (r.inCashMinor ? formatMinor(r.inCashMinor) : "—"),
    },
    {
      key: "out",
      header: "خارج الصندوق",
      mono: true,
      render: (r: CashRow) => (r.outCashMinor ? formatMinor(r.outCashMinor) : "—"),
    },
    {
      key: "sync",
      header: "المزامنة",
      render: (r: CashRow) => <Status state={SYNC_STATE[r.sync]} label={SYNC_LABEL[r.sync]} />,
    },
  ];

  return (
    <Frame
      title="الورديات"
      nav={<AppNav currentId="home" />}
      footer={null}
      notice={!online ? <Status state="offline" label="الوردية تعمل بلا اتصال" /> : undefined}
    >
      <div className="home" data-screen="SHIFT-02" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {shift ? (
                <>
                  وردية {shift.user_name} —{" "}
                  {hours >= 1 ? (
                    <CountWord n={hours} one="ساعة واحدة" two="ساعتان" few="ساعات" many="ساعة" />
                  ) : (
                    <CountWord
                      n={minutes}
                      one="دقيقة واحدة"
                      two="دقيقتان"
                      few="دقائق"
                      many="دقيقة"
                    />
                  )}
                </>
              ) : (
                "الوردية الحالية"
              )}
            </h2>
            {shift?.state === "closed" ? (
              <Status state="stale" label="مقفلة · معلّقة الرفع" />
            ) : null}
          </div>
          <div className="acc-card__body">
            {state === "loading" ? (
              <Notice kind="info" title="جلب الوردية">
                <p className="acc-lead">من الجهاز فوراً ثم تُطابَق.</p>
              </Notice>
            ) : null}

            {state === "offline" ? (
              <Notice kind="offline" title="الوردية تعمل بلا اتصال">
                <p className="acc-lead">الأرقام كاملة لما بيع على هذا الجهاز.</p>
                <p className="acc-lead">
                  <strong>الحدّ المُعلن</strong> · لو كان الفرع بجهازين فأرقام الآخر لا تظهر حتى
                  تعود الشبكة
                </p>
              </Notice>
            ) : null}

            {state === "stale" ? (
              <Notice kind="warning" title="مقفلة · معلّقة الرفع">
                <p className="acc-lead">
                  أُقفلت محلياً وتُرفع عند المزامنة — الأرقام نهائية عندك لا عند الخادم
                </p>
              </Notice>
            ) : null}

            {shift && cash ? (
              <>
                <div className="shift-head">
                  <div>
                    <div className="shift-head__title">
                      وردية مفتوحة منذ <span className="sting-mono">{hhmm(shift.opened_at)}</span>
                    </div>
                    <div className="shift-head__sub">
                      {shift.user_name} · {shift.device_name} · {shift.branch_name}
                    </div>
                  </div>
                  <div className="shift-expected">
                    <div className="shift-expected__k">النقد المتوقع في الدرج</div>
                    <div className="shift-expected__v sting-mono">
                      {formatMinor(cash.expectedCashMinor)}
                    </div>
                    {cash.pendingCount > 0 ? (
                      <div className="shift-expected__note">
                        يشمل{" "}
                        <CountWord
                          n={cash.pendingCount}
                          one="حركة معلقة واحدة"
                          two="حركتين معلقتين"
                          few="حركات معلقة"
                          many="حركة معلقة"
                        />{" "}
                        من هذا الجهاز
                      </div>
                    ) : matched === true ? (
                      <div className="shift-expected__note">مطابَق مع الخادم</div>
                    ) : null}
                  </div>
                </div>
                <div className="shift-totals">
                  {(
                    [
                      ["افتتاح الدرج", cash.totals.openingFloatMinor, false],
                      ["مبيعات نقدية", cash.totals.cashSalesMinor, true],
                      ["سدادات نقدية", cash.totals.cashDebtReceiptsMinor, true],
                      ["صرف من الصندوق", cash.totals.cashWithdrawalsMinor, false],
                    ] as const
                  ).map(([k, v, inn]) => (
                    <div
                      key={k}
                      className={`shift-total${inn && v > 0n ? " shift-total--in" : ""}`}
                    >
                      <div className="shift-total__k">{k}</div>
                      <div className="shift-total__v sting-mono">{formatMinor(v)}</div>
                    </div>
                  ))}
                </div>
                <Table
                  caption="حركات الوردية"
                  columns={columns}
                  rows={cash.rows}
                  rowKey={(r) => r.doc + r.time}
                />
                {hasOut ? (
                  <p className="cat-saving__note">
                    عمود «خارج الصندوق» يعرض ما لا يدخل النقد: الجزء الآجل والتحويل البنكي. يظهر هنا
                    لتفهم الفاتورة كاملة، ولا يُحتسب في النقد المتوقع.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
