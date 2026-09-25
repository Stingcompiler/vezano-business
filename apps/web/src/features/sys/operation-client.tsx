"use client";

import type { StoredOperation } from "@sting/platform";
import {
  type AttemptEntry,
  describeOperation,
  readAttempts,
  renumberSale,
  requeueOperation,
  SALE_PREFIX,
  savedAt,
} from "@sting/sync-core";
import { Button, Frame, Notice, Status } from "@sting/ui-web";
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
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending, readHalted } from "@/lib/sync";

import { supportLine } from "./sys-format";

type State = "ready" | "empty" | "server_error" | "conflict" | "pending_sync";

interface Quarantine {
  readonly code: string;
  readonly detail: string;
}

const EVENT_LABEL: Record<AttemptEntry["event"], string> = {
  saved: "حُفظت محلياً",
  sent: "حاولت الرفع",
  transient: "تعذّر الوصول إلى الخادم",
  auth: "رُفضت المصادقة — يلزم دخول جديد",
  epoch_mismatch: "جيل الخادم تغيّر — يلزم تنزيل جديد",
  permanent: "رفض الخادم النقل",
  accepted: "قبلها الخادم",
  duplicate: "مقبولة سلفاً — لم تُحسب مرتين",
  conflicted: "تعارض مع ما عند الخادم",
  rejected: "رفضها الخادم",
  pending_dependency: "تنتظر عملية سابقة",
  requeued: "عادت إلى الطابور",
  renumbered: "أُعيد ترقيمها",
  handed_over: "سُلِّمت إلى الحجر — الجهاز مسحوب وينتظر المالك",
};

/** السبب بلغة مفهومة والفعل الواحد لكل رمز رفض من الخادم (§٨.٣: دائم → حجر بلا سدّ الطابور). */
function explainRejection(
  op: StoredOperation,
  q: Quarantine | null,
): { cause: string; action: "renumber" | "requeue"; actionLabel: string } {
  const code = q?.code ?? "";
  const detail = q?.detail ?? "";
  if (op.kind === "sale" && /invoice_number|unique|duplicate key/i.test(detail)) {
    return {
      cause: "رقم الفاتورة استعمله جهاز آخر",
      action: "renumber",
      actionLabel: "إعادة ترقيم بموافقتك ثم رفع",
    };
  }
  if (code === "dependency_rejected")
    return {
      cause: "عملية سابقة تعتمد عليها رُفضت — تُحلّ تلك أولاً",
      action: "requeue",
      actionLabel: "أعد إلى الطابور بعد إصلاح السابقة",
    };
  if (code === "dependency_cycle")
    return {
      cause: "العمليات تعتمد على بعضها في حلقة",
      action: "requeue",
      actionLabel: "أعد إلى الطابور",
    };
  if (code === "commit_failed")
    return {
      cause: "الخادم لم يستطع تثبيتها — قيد في بياناتها",
      action: "requeue",
      actionLabel: "أعد إلى الطابور بعد الإصلاح",
    };
  if (code === "validation")
    return {
      cause: `الخادم رفض بياناتها${detail ? `: ${detail}` : ""}`,
      action: "requeue",
      actionLabel: "أعد إلى الطابور بعد الإصلاح",
    };
  return {
    cause: detail || code || "رفضها الخادم بلا تفصيل",
    action: "requeue",
    actionLabel: "أعد إلى الطابور",
  };
}

/**
 * SYS-02 — تفاصيل عملية متعثرة (16-D11 ready/empty/server_error/conflict/pending_sync): خطّ زمني
 * لعملية واحدة بكل محاولة ووقتها وسببها؛ «بلغة المحل» لا HTTP؛ لكل سبب مخرجٌ واحد؛ التعارض لا يُعاد
 * بل يُحال إلى مراجعة المالك (SYS-03)؛ العائدة إلى الطابور تعود لموضعها الزمني لا رأسه.
 */
export function OperationClient({ operationId }: { operationId: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [op, setOp] = useState<StoredOperation | null | undefined>(undefined);
  const [attempts, setAttempts] = useState<AttemptEntry[]>([]);
  const [quarantine, setQuarantine] = useState<Quarantine | null>(null);
  const [halted, setHalted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const storage = getStorage();
    const [row, q] = await storage.read(async (tx) => [
      await tx.getOperation(operationId),
      await tx.getMeta(`quarantine:${operationId}`),
    ]);
    setOp(row ?? null);
    setAttempts(await readAttempts(storage, operationId));
    setQuarantine(q ? (JSON.parse(q) as Quarantine) : null);
    setHalted(await readHalted());
  }, [operationId]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(`/sync/operations/${operationId}`)}`);
      return;
    }
    void (async () => {
      setCtx(await readShiftContext(getStorage(), app));
      await load();
    })();
  }, [router, load, operationId]);

  const last = [...attempts].reverse().find((a) => a.event !== "saved" && a.event !== "sent");
  const lastFailure = [...attempts]
    .reverse()
    .find((a) =>
      ["transient", "auth", "epoch_mismatch", "permanent", "rejected", "conflicted"].includes(
        a.event,
      ),
    );
  const transportFailed =
    last && ["transient", "auth", "epoch_mismatch", "permanent"].includes(last.event);

  const state: State =
    op === undefined
      ? "empty"
      : !op || op.state === "synced"
        ? "empty"
        : op.state === "conflict"
          ? "conflict"
          : op.state === "quarantined"
            ? "ready"
            : last?.event === "requeued" || last?.event === "renumbered"
              ? "pending_sync"
              : transportFailed || halted
                ? "server_error"
                : "pending_sync";

  const d = op ? describeOperation(op) : null;
  const saved = savedAt(attempts);
  const rejection = op && op.state === "quarantined" ? explainRejection(op, quarantine) : null;
  const support = supportLine({
    status: lastFailure?.status ?? lastFailure?.code ?? (quarantine?.code || undefined),
    operationId,
    devicePrefix: ctx?.devicePrefix,
  });

  const act = async (kind: "requeue" | "renumber" | "retry") => {
    if (busy || !op) return;
    setBusy(true);
    try {
      const storage = getStorage();
      if (kind === "renumber") {
        const parts = {
          branchCode: ctx?.branchCode || "BR",
          devicePrefix: ctx?.devicePrefix || "X",
          yearTwoDigits: new Date().toISOString().slice(2, 4),
        };
        await renumberSale(storage, op.operationId, parts, SALE_PREFIX);
      } else if (kind === "requeue") {
        await requeueOperation(storage, op.operationId);
      } else {
        await pushPending(10, { manual: true });
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(support);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="sync" />} footer={null}>
      <div className="sys" data-screen="SYS-02" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تفاصيل عملية متعثرة</h2>
            <span className="cat-head__hint">
              شاشة تشخيص لصاحب محل لا لمهندس: لماذا وقفت هذه العملية بعينها، وما الذي يفعله الآن.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "empty" && op !== undefined ? (
              <Notice
                kind="empty"
                title="لا عمليات متعثرة"
                action={<Button onClick={() => router.push("/sync")}>مركز المزامنة</Button>}
              >
                <p className="acc-lead">
                  الحالة الصحّية. يُفتح هذا غالباً من إشعارٍ قديم بعد أن حُلّت المشكلة تلقائياً.
                </p>
                <p className="acc-choice__note">
                  <strong>نقول ما جرى</strong> ·{" "}
                  {lastFailure ? (
                    <>
                      لا شيء متعثر — آخر تعثّر كان{" "}
                      <DayLabel iso={lastFailure.at} now={new Date()} />{" "}
                      <span className="sting-mono">{hhmm(lastFailure.at)}</span> وحُلّ{" "}
                      {op?.state === "synced" ? "بإعادة المحاولة" : "أو لم يعد موجوداً"}.
                    </>
                  ) : (
                    "لا شيء متعثر — ولا تعثّر مسجّلاً لهذه العملية."
                  )}
                </p>
              </Notice>
            ) : null}

            {op && d ? (
              <div className="shift-facts">
                <div>
                  <span className="shift-facts__k">العملية</span>
                  <span className="shift-facts__v">
                    {d.title}
                    {d.number ? (
                      <>
                        {" "}
                        <span className="sting-mono">{d.number}</span>
                      </>
                    ) : null}
                  </span>
                </div>
                <div>
                  <span className="shift-facts__k">أثرها على مالك</span>
                  <span className="shift-facts__v">{d.effect || "—"}</span>
                </div>
                <div>
                  <span className="shift-facts__k">الجهاز والوقت</span>
                  <span className="shift-facts__v">
                    {ctx?.deviceName ?? "هذا الجهاز"} ·{" "}
                    {saved ? (
                      <>
                        <DayLabel iso={saved} now={new Date()} />{" "}
                        <span className="sting-mono">{hhmm(saved)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
                <div>
                  <span className="shift-facts__k">الحالة</span>
                  <span className="shift-facts__v">
                    <Status
                      state={
                        op.state === "synced"
                          ? "synced"
                          : op.state === "conflict"
                            ? "conflict"
                            : op.state === "quarantined"
                              ? "server_error"
                              : "pending_sync"
                      }
                      label={
                        op.state === "quarantined"
                          ? "متعثّرة"
                          : op.state === "conflict"
                            ? "محجوز للمراجعة"
                            : op.state === "synced"
                              ? "مؤكَّدة بختم وقت الخادم"
                              : "معلّق على هذا الجهاز"
                      }
                      dot={false}
                    />
                  </span>
                </div>
              </div>
            ) : null}

            {state === "conflict" ? (
              <Notice
                kind="warning"
                title="العملية موقوفة بتعارض"
                action={
                  <Button onClick={() => router.push(`/sync/review?op=${operationId}`)}>
                    مراجعة المالك
                  </Button>
                }
              >
                <p className="acc-lead">
                  ليست فشلاً تقنياً: جهازان عدّلا الشيء نفسه. لا تُعاد المحاولة — إعادة المحاولة لا
                  تحلّ خلافاً.
                </p>
                <p className="acc-choice__note">
                  <strong>التحويل</strong> · مسارها إلى «مراجعة التعارضات» حيث يُراجعها المالك
                  بالنسختين. هنا نُظهر السبب والمسار لا الحلّ.
                </p>
              </Notice>
            ) : null}

            {state === "ready" && rejection ? (
              <>
                <div className="sys-explain">
                  <div>
                    <span className="sys-explain__k">ما الذي لم يحدث</span>
                    <span className="acc-choice__note">
                      {op?.kind === "sale" ? "الفاتورة" : "العملية"} لم تُسجَّل عند الخادم
                    </span>
                  </div>
                  <div>
                    <span className="sys-explain__k">ما الذي حدث فعلاً</span>
                    <span className="acc-choice__note">محفوظة على الجهاز بالكامل</span>
                  </div>
                  <div>
                    <span className="sys-explain__k">السبب بلغة مفهومة</span>
                    <span className="acc-choice__note">{rejection.cause}</span>
                  </div>
                  <div>
                    <span className="sys-explain__k">ما تفعله الآن</span>
                    <span className="acc-choice__note">{rejection.actionLabel}</span>
                  </div>
                </div>
                <p className="acc-choice__note">
                  <strong>الفعل الواحد</strong> · لكل سبب مخرجٌ واحد واضح — لا قائمة خيارات على من
                  لا يعرف الفرق بينها. الأصل محفوظ ولم يُعدّل.
                </p>
                <div className="cat-form__actions">
                  <Button pos onClick={() => void act(rejection.action)} loading={busy}>
                    {rejection.actionLabel}
                  </Button>
                </div>
              </>
            ) : null}

            {state === "server_error" ? (
              <>
                <div className="sys-explain">
                  <div>
                    <span className="sys-explain__k">ما الذي لم يحدث</span>
                    <span className="acc-choice__note">
                      {op?.kind === "sale" ? "الفاتورة" : "العملية"} لم تُسجَّل عند الخادم
                    </span>
                  </div>
                  <div>
                    <span className="sys-explain__k">ما الذي حدث فعلاً</span>
                    <span className="acc-choice__note">محفوظة على الجهاز بالكامل</span>
                  </div>
                  <div>
                    <span className="sys-explain__k">السبب بلغة مفهومة</span>
                    <span className="acc-choice__note">
                      {last?.event === "auth" ? (
                        "انتهت جلسة الجهاز — يلزم دخول جديد"
                      ) : last?.event === "epoch_mismatch" ? (
                        "الخادم استُعيد من نسخة — يلزم تنزيل جديد"
                      ) : last?.status ? (
                        <>
                          الخادم يردّ بخطأ <span className="sting-mono">{last.status}</span> —
                          الشبكة تعمل والخادم يرفض
                        </>
                      ) : (
                        "لم يصل الخادم — الشبكة أو المهلة"
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="sys-explain__k">ما تفعله الآن</span>
                    <span className="acc-choice__note">
                      {halted
                        ? "وقف الرفع التلقائي بعد ثلاث محاولات — إعادة المحاولة بيدك"
                        : "تُعاد المحاولة تلقائياً بفواصل متباعدة"}
                    </span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() => void act("retry")}
                    loading={busy}
                    disabledReason={!online ? "بلا اتصال — يُرفع عند عودة الشبكة" : undefined}
                  >
                    إعادة المحاولة
                  </Button>
                </div>
              </>
            ) : null}

            {state === "pending_sync" ? (
              <Notice kind="info" title="عادت إلى الطابور">
                <p className="acc-lead">
                  {last?.event === "renumbered" ? (
                    <>
                      أُصلح السبب (رقم جديد <span className="sting-mono">{last.detail}</span>)
                      والعملية عادت تنتظر دورها.
                    </>
                  ) : (
                    "أُصلح السبب والعملية عادت تنتظر دورها."
                  )}
                </p>
                <p className="acc-choice__note">
                  <strong>لا قفز</strong> · تعود إلى موضعها الزمني لا إلى رأس الطابور. الترتيب
                  الزمني هو ما يجعل الدفتر مقروءاً بعد شهر.
                </p>
              </Notice>
            ) : null}

            {op ? (
              <>
                <h3 className="cat-head__title">العملية وتاريخها</h3>
                <ul className="sys-timeline">
                  {attempts.map((a, i) => (
                    <li key={i} className="sys-timeline__row">
                      <span className="sys-timeline__at sting-mono">{hhmm(a.at)}</span>
                      <span>
                        {EVENT_LABEL[a.event]}
                        {a.status ? (
                          <>
                            {" "}
                            (<span className="sting-mono">{a.status}</span>)
                          </>
                        ) : null}
                        {a.event === "rejected" && a.code ? (
                          <>
                            {" "}
                            — <span className="sting-mono">{a.code}</span>
                          </>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="acc-choice__note">
                  <strong>بلغة المحل</strong> · «الخادم رفض: الصنف المحذوف» لا «HTTP 422». الرمز
                  التقني يبقى مطوياً خلف «تفاصيل للدعم».
                </p>
                <details className="sys-support">
                  <summary>تفاصيل للدعم</summary>
                  <p className="acc-choice__note">
                    <span className="sting-mono" dir="ltr">
                      {support}
                    </span>{" "}
                    <Button variant="quiet" onClick={() => void copy()}>
                      {copied ? "نُسخ" : "نسخ"}
                    </Button>
                  </p>
                  <p className="acc-choice__note">
                    لا نعرض JSON ولا أثر مكدّس. سطر واحد يكفي الدعم، والباقي شرح بالعربية لما حدث
                    ولماذا لم تضع الفاتورة.
                  </p>
                </details>
              </>
            ) : null}
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/sync")}>
                مركز المزامنة
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
