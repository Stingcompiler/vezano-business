"use client";

import type { StoredOperation } from "@sting/platform";
import { describeOperation, readAttempts, savedAt } from "@sting/sync-core";
import { Button, Frame, Notice, Status, Table } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/sys/sys.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { DayLabel } from "@/features/pos/invoices-client";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { useApp } from "@/lib/app-context";
import { downloadLocalBackup } from "@/lib/local-backup";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { readHalted, readLastOk, readLastPush, reconcileNow } from "@/lib/sync";

import { Ago, supportLine } from "./sys-format";

type State = "ready" | "pending_sync" | "synced" | "stale" | "server_error" | "offline";

interface Row {
  readonly op: StoredOperation;
  readonly title: string;
  readonly number: string;
  readonly effect: string;
  readonly savedAt: string | null;
  readonly code: string;
}

/** آخر مطابقة ناجحة أقدم من هذا = «قديمة» وإن كان الطابور فارغاً والاتصال قائماً (07-D3 stale). */
const STALE_MS = 60 * 60_000;
const RECENT_LIMIT = 20;

const STATE_LABEL: Record<StoredOperation["state"], string> = {
  local: "محفوظ محلياً",
  pending: "قيد الرفع",
  synced: "مؤكد اليوم",
  conflict: "محجوز للمراجعة",
  quarantined: "متعثّرة",
};

/**
 * SYS-01 — مركز الاتصال والمزامنة (07-D3 ready/synced/stale/server_error · 16-D11 pending_sync/offline):
 * الجواب أولاً بجملة واحدة — هل عملي وصل؟ — والسجل تحته؛ ثلاث حالات لا اثنتان (محفوظ محلياً، قيد
 * الرفع، مؤكَّد)؛ «هناك شبكة» ≠ «نجح الوصول»؛ ثلاث محاولات ثم وقوف معلَن والطابور محفوظ؛ البيع مستمر.
 */
export function SyncCenterClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [halted, setHalted] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [justSynced, setJustSynced] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const storage = getStorage();
    const ops = await storage.read(async (tx) => [
      ...(await tx.listOperationsByState("local")),
      ...(await tx.listOperationsByState("pending")),
      ...(await tx.listOperationsByState("conflict")),
      ...(await tx.listOperationsByState("quarantined")),
      ...(await tx.listOperationsByState("synced")),
    ]);
    const open = ops.filter((o) => o.state !== "synced");
    const recent = ops
      .filter((o) => o.state === "synced")
      .sort((a, b) => b.createdLocalSeq - a.createdLocalSeq)
      .slice(0, RECENT_LIMIT);
    const out: Row[] = [];
    for (const op of [...open.sort((a, b) => a.createdLocalSeq - b.createdLocalSeq), ...recent]) {
      const attempts = await readAttempts(storage, op.operationId);
      const last = [...attempts].reverse().find((a) => a.event !== "saved" && a.event !== "sent");
      const d = describeOperation(op);
      out.push({
        op,
        title: d.title,
        number: d.number,
        effect: d.effect,
        savedAt: savedAt(attempts),
        code: last?.code ?? (last?.status ? String(last.status) : ""),
      });
    }
    setRows(out);
    setLastOk(await readLastOk());
    setHalted(await readHalted());
    setLastStatus((await readLastPush())?.status);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fsync");
      return;
    }
    void (async () => {
      setCtx(await readShiftContext(getStorage(), app));
      await load();
    })();
  }, [router, load, online]);

  const pendingRows = rows.filter((r) => r.op.state === "local" || r.op.state === "pending");
  const conflictRows = rows.filter((r) => r.op.state === "conflict");
  const quarantinedRows = rows.filter((r) => r.op.state === "quarantined");
  const openRows = rows.filter((r) => r.op.state !== "synced");
  const recentRows = rows.filter((r) => r.op.state === "synced");
  const pending = pendingRows.length;
  const stale = !lastOk || Date.now() - new Date(lastOk).getTime() > STALE_MS;

  const state: State = !online
    ? "offline"
    : halted
      ? "server_error"
      : pending > 0
        ? "pending_sync"
        : justSynced > 0
          ? "synced"
          : loaded && stale
            ? "stale"
            : "ready";

  const syncNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { synced } = await reconcileNow();
      setJustSynced(synced);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: "op",
      header: "العملية",
      render: (r: Row) => (
        <div>
          <Button
            variant="quiet"
            className="shift-row__open"
            onClick={() => router.push(`/sync/operations/${r.op.operationId}`)}
          >
            {r.title}
            {r.number ? (
              <>
                {" "}
                <span className="sting-mono">{r.number}</span>
              </>
            ) : null}
          </Button>
          <div className="acc-choice__note">
            {ctx?.deviceName ?? "هذا الجهاز"} ·{" "}
            {r.savedAt ? (
              <>
                <DayLabel iso={r.savedAt} now={new Date()} />{" "}
                <span className="sting-mono">{hhmm(r.savedAt)}</span>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>
      ),
    },
    { key: "effect", header: "أثرها على مالك", render: (r: Row) => r.effect },
    {
      key: "state",
      header: "الحالة",
      render: (r: Row) => (
        <Status
          state={
            r.op.state === "synced"
              ? "synced"
              : r.op.state === "conflict"
                ? "conflict"
                : r.op.state === "quarantined"
                  ? "server_error"
                  : "pending_sync"
          }
          label={STATE_LABEL[r.op.state]}
          dot={false}
        />
      ),
    },
    {
      key: "action",
      header: "الإجراء",
      render: (r: Row) =>
        r.op.state === "conflict" ? (
          "يحتاج قرارك"
        ) : r.op.state === "quarantined" ? (
          <>
            خطأ خادم
            {r.code ? (
              <>
                {" "}
                <span className="sting-mono">{r.code}</span>
              </>
            ) : null}
          </>
        ) : r.op.state === "synced" ? (
          "وصل الخادم"
        ) : halted ? (
          "بانتظار محاولة يدوية"
        ) : (
          "يُرفع تلقائياً"
        ),
    },
  ];

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="sync" />} footer={null}>
      <div className="sys" data-screen="SYS-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">حالة المزامنة</h2>
            <span className="cat-head__hint">
              محفوظ محلياً · معلّق · مؤكد · محجوز. كل بند بأثره المالي لا برسالة تقنية.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "offline" ? (
              <Notice kind="warning" title="بلا اتصال — البيع يعمل">
                <p className="acc-lead">
                  كل ما تبيعه الآن محفوظ على هذا الجهاز ويُرفع عند عودة الشبكة.
                </p>
                <p className="acc-choice__note">
                  <span className="sting-mono">{pending}</span> عمليات معلّقة
                  {lastOk ? (
                    <>
                      {" "}
                      · آخر اتصال ناجح قبل <Ago iso={lastOk} />
                    </>
                  ) : null}
                </p>
              </Notice>
            ) : null}

            {state === "server_error" ? (
              <Notice kind="error" title="الخادم يرفض الطابور">
                <p className="acc-lead">
                  الشبكة تعمل والخادم يردّ بخطأ. ثلاث محاولات متباعدة ثم وقوف — والطابور محفوظ كما
                  هو.
                </p>
                <p className="acc-choice__note">
                  <strong>لا إعادة بلا حدّ</strong> · التكرار الأبدي يُخفي العطب أسبوعاً حتى يُكتشف
                  بجردٍ لا يطابق. الوقوف المعلَن أصدق من محاولةٍ صامتة.
                </p>
                <p className="acc-choice__note">
                  <strong>البيع مستمر</strong> · POS لا يتوقف. الطابور يكبر ويُعرض عدده، والعمل لا
                  ينقطع لأن خادماً تعثّر.
                </p>
                <p className="acc-choice__note sting-mono" dir="ltr">
                  {supportLine({ status: lastStatus, devicePrefix: ctx?.devicePrefix })}
                </p>
              </Notice>
            ) : null}

            {state === "pending_sync" ? (
              <Notice kind="info" title="معلّق">
                <p className="acc-lead">
                  <span className="sting-mono">{pending}</span> عمليات معلّقة
                </p>
                <p className="acc-choice__note">
                  {lastOk ? (
                    <>
                      آخر اتصال ناجح قبل <Ago iso={lastOk} />
                    </>
                  ) : (
                    "لم يصل الخادم من هذا الجهاز بعد"
                  )}
                </p>
              </Notice>
            ) : null}

            {state === "synced" ? (
              <Notice kind="success" title="اكتمل الرفع الآن">
                <p className="acc-lead">
                  رُفعت <span className="sting-mono">{justSynced}</span> عملية
                </p>
                <p className="acc-choice__note">
                  <strong>نقول العدد</strong> · «رُفعت <span className="sting-mono">12</span> عملية»
                  لا «تمت المزامنة». العدد هو ما كان يقلقه.
                </p>
              </Notice>
            ) : null}

            {state === "stale" ? (
              <Notice
                kind="warning"
                title="آخر مطابقة قديمة"
                action={
                  <Button onClick={() => void syncNow()} loading={busy}>
                    طابق الآن
                  </Button>
                }
              >
                <p className="acc-lead">
                  لا شيء في الطابور والاتصال قائم، لكن آخر مطابقة ناجحة{" "}
                  {lastOk ? (
                    <>
                      قبل <Ago iso={lastOk} />
                    </>
                  ) : (
                    "لم تحدث بعد"
                  )}
                  . لا معلّق عندك ولا تأكيد أن ما عند الخادم وصلك.
                </p>
                <p className="acc-choice__note">
                  <strong>ما نعرضه</strong> · وقت آخر مطابقة ناجحة بارزاً، و«طابق الآن»، وتحذير أن
                  أرقام اليوم قد تنقصها مبيعات أجهزة أخرى.
                </p>
              </Notice>
            ) : null}

            {state === "ready" ? (
              <Notice kind="success" title="كل عملك وصل">
                <p className="acc-lead">
                  {lastOk ? (
                    <>
                      آخر مطابقة قبل <Ago iso={lastOk} />
                    </>
                  ) : (
                    "لا مطابقة بعد"
                  )}{" "}
                  · لا شيء في الطابور
                </p>
              </Notice>
            ) : null}

            <div className="sys-legend">
              <div className="sys-legend__item">
                <Status state="saved_local" label="محفوظ محلياً" dot={false} />
                <span className="acc-choice__note">آمن على الجهاز</span>
              </div>
              <div className="sys-legend__item">
                <Status state="pending_sync" label="معلّق الرفع" dot={false} />
                <span className="acc-choice__note">ينتظر الاتصال</span>
              </div>
              <div className="sys-legend__item">
                <Status state="synced" label="مؤكد اليوم" dot={false} />
                <span className="acc-choice__note">وصل الخادم</span>
              </div>
              <div className="sys-legend__item">
                <Status state="conflict" label="محجوز للمراجعة" dot={false} />
                <span className="acc-choice__note">يحتاج قرار المالك</span>
              </div>
            </div>

            <div className="cat-form__actions">
              <Button
                onClick={() => void syncNow()}
                loading={busy}
                disabledReason={!online ? "بلا اتصال — يُرفع عند عودة الشبكة" : undefined}
              >
                محاولة رفع الآن
              </Button>
              <Button
                variant="secondary"
                onClick={() => void downloadLocalBackup()}
                disabledReason={openRows.length === 0 ? "لا معلّق لتصديره" : undefined}
              >
                تصدير المعلّق كنسخة
              </Button>
            </div>

            {openRows.length > 0 ? (
              <Table
                caption="المعلّق والمحجوز"
                columns={columns}
                rows={openRows}
                rowKey={(r) => r.op.operationId}
                onOpenRow={(r) => router.push(`/sync/operations/${r.op.operationId}`)}
              />
            ) : null}
            {conflictRows.length + quarantinedRows.length > 0 ? (
              <p className="acc-choice__note">
                <span className="sting-mono">{conflictRows.length}</span> محجوز للمراجعة ·{" "}
                <span className="sting-mono">{quarantinedRows.length}</span> خطأ خادم
              </p>
            ) : null}

            <h3 className="cat-head__title">آخر ما رُفع</h3>
            {recentRows.length === 0 ? (
              <p className="acc-choice__note">لم يُرفع شيء من هذا الجهاز بعد.</p>
            ) : (
              <ul className="sys-recent">
                {recentRows.map((r) => (
                  <li key={r.op.operationId} className="sys-recent__row">
                    <span>
                      {r.title}
                      {r.number ? (
                        <>
                          {" "}
                          <span className="sting-mono">{r.number}</span>
                        </>
                      ) : null}
                    </span>
                    <Status state="synced" label="مؤكد" dot={false} />
                    <span className="sting-mono">{r.savedAt ? hhmm(r.savedAt) : "—"}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="acc-choice__note">
              معرّفات الدعم مثل <span className="sting-mono">ERR-SYNC-0112</span> للفريق التقني ولا
              تحتوي بيانات عملاء. لا يُعرض عليك JSON ولا رسائل خادم خام.
            </p>
          </div>
        </div>
      </div>
    </Frame>
  );
}
