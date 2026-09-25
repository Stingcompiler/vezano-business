"use client";

import type { StoredOperation } from "@sting/platform";
import { describeOperation, EPOCH_RECONCILED_META } from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status } from "@sting/ui-web";
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
import { useApp } from "@/lib/app-context";
import { getStorage } from "@/lib/storage";
import {
  type EpochChange,
  readEpochChange,
  type ReconcileOutcome,
  reconcileEpoch,
} from "@/lib/sync";

type State = "stale" | "conflict" | "pending_sync" | "success";

interface Reconciled {
  readonly previous: string;
  readonly next: string;
  readonly at: string;
  readonly present: number;
  readonly uploaded: number;
  readonly held: number;
}

const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

function amountOf(op: StoredOperation): string {
  const find = (e: string) => op.members.find((m) => m.entity === e)?.payload ?? {};
  if (op.kind === "sale") return str(find("sales.Sale")["total_minor"]);
  if (op.kind === "sale_return") return str(find("sales.SaleReturn")["total_minor"]);
  if (op.kind === "payment_receipt" || op.kind === "refund")
    return str(find("parties.PaymentReceipt")["amount_minor"]);
  return "";
}

/** «G-17» — آخر مقطع مقروء من معرّف الجيل للعرض داخل mono. */
const short = (epoch: string): string => (epoch.length > 8 ? epoch.slice(-8) : epoch) || "—";

/**
 * SYS-08 — تغيّر جيل الخادم والمصالحة (19-D14 stale/conflict/pending_sync/success): الخادم استُعيد
 * إلى نقطة أقدم فصار عند الجهاز عملٌ لا يعرفه. نعترف بالأمر ولا نمسح ولا نرفع تلقائياً: المصالحة
 * تُقارن بالهويات الأصلية — ما نجا يُترك، وما فُقد يُرفع، وما اختلف يُحجز. المعلَّق ليس مفقوداً.
 */
export function EpochClient() {
  const router = useRouter();
  const app = useApp();
  const [change, setChange] = useState<EpochChange | null>(null);
  const [pending, setPending] = useState<StoredOperation[]>([]);
  const [synced, setSynced] = useState<StoredOperation[]>([]);
  const [reconciled, setReconciled] = useState<Reconciled | null>(null);
  const [outcome, setOutcome] = useState<ReconcileOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const storage = getStorage();
    setChange(await readEpochChange());
    const [local, pend, syn, rec] = await storage.read(async (tx) => [
      await tx.listOperationsByState("local"),
      await tx.listOperationsByState("pending"),
      await tx.listOperationsByState("synced"),
      await tx.getMeta(EPOCH_RECONCILED_META),
    ]);
    setPending([...local, ...pend]);
    setSynced(syn);
    setReconciled(rec ? (JSON.parse(rec) as Reconciled) : null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fsync%2Fepoch");
      return;
    }
    void load();
  }, [router, load]);

  const state: State = outcome
    ? "success"
    : busy
      ? "pending_sync"
      : change
        ? synced.length > 0
          ? "conflict"
          : "stale"
        : "success";

  const start = async () => {
    if (!change || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setOutcome(await reconcileEpoch(change));
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const pendingValue = pending.reduce((a, op) => a + BigInt(amountOf(op) || "0"), 0n);

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="epoch" />} footer={null}>
      <div className="sys" data-screen="SYS-08" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مصالحة بعد تغيّر جيل الخادم</h2>
            <span className="cat-head__hint">
              الخادم استُعيد إلى نقطة أقدم، فصار عند الأجهزة عملٌ لا يعرفه. أندر الحالات وأخطرها.
            </span>
          </div>
          <div className="acc-card__body">
            {change ? (
              <div className="shift-facts">
                <div>
                  <span className="shift-facts__k">الجيل الحالي</span>
                  <span className="shift-facts__v sting-mono" dir="ltr">
                    {short(change.next)}
                  </span>
                </div>
                <div>
                  <span className="shift-facts__k">· وصلت ردود تخصّ</span>
                  <span className="shift-facts__v sting-mono" dir="ltr">
                    {short(change.previous)}
                  </span>
                </div>
                <div>
                  <span className="shift-facts__k">اكتُشف</span>
                  <span className="shift-facts__v">
                    <DayLabel iso={change.detectedAt} now={new Date()} />{" "}
                    <span className="sting-mono">{hhmm(change.detectedAt)}</span>
                  </span>
                </div>
              </div>
            ) : null}

            {state === "conflict" ? (
              <Notice
                kind="error"
                title="الخادم لا يعرف عملك"
                action={
                  <Button financial pos onClick={() => void start()} loading={busy}>
                    ابدأ المصالحة
                  </Button>
                }
              >
                <p className="acc-lead">
                  جيل جديد للخادم: استُعيد إلى نقطة سابقة، وعلى جهازك{" "}
                  <span className="sting-mono">{synced.length}</span> عملية مؤكَّدة بعد تلك النقطة.
                  كانت «مؤكَّدة» وصارت غير معروفة.
                </p>
                <p className="acc-choice__note">
                  <strong>نعترف بالأمر</strong> · «الخادم استُعيد إلى نقطة سابقة — عملك سليم على
                  جهازك ولم يعد عنده». لا نلوم الشبكة ولا نُخفي خلف رسالة مزامنة عامة.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نمسح ولا نرفع تلقائياً</strong> · رفعٌ أعمى قد يُنتج ازدواجاً مع ما نجا
                  عند الخادم. المصالحة تُقارن بالهويات الأصلية أولاً.
                </p>
              </Notice>
            ) : null}

            {state === "stale" ? (
              <Notice
                kind="warning"
                title="المعلَّق ليس مفقوداً."
                action={
                  <Button financial pos onClick={() => void start()} loading={busy}>
                    ابدأ المصالحة
                  </Button>
                }
              >
                <p className="acc-lead">
                  يبقى في قائمة محدَّدة بعدد وقيمة، وتُعاد محاولته على الجيل الجديد. لن يختفي رقم من
                  دفترك لأن الخادم تغيّر.
                </p>
                <p className="acc-choice__note">
                  <span className="sting-mono">{pending.length}</span> عملية معلّقة بقيمة{" "}
                  <span className="sting-mono">{formatMinor(pendingValue.toString())}</span>
                </p>
              </Notice>
            ) : null}

            {state === "pending_sync" ? (
              <Notice kind="info" title="المصالحة جارية">
                <p className="acc-lead">
                  تُقارَن هويات <span className="sting-mono">{synced.length + pending.length}</span>{" "}
                  عملية بما عند الخادم: ما نجا يُترك، وما فُقد يُرفع، وما اختلف يُحجز.
                </p>
                <p className="acc-choice__note">
                  <strong>العدّاد ثلاثي</strong> · موجودة · سترفع · للمراجعة — والبيع مستمر أثناء
                  ذلك.
                </p>
                <Status state="saving" label="جارٍ" />
              </Notice>
            ) : null}

            {state === "success" ? (
              <Notice kind="success" title="تمّت المصالحة">
                <p className="acc-lead">
                  استقرّ الدفتران.{" "}
                  {outcome || reconciled ? (
                    <>
                      <span className="sting-mono">
                        {outcome?.present ?? reconciled?.present ?? 0}
                      </span>{" "}
                      موجودة ·{" "}
                      <span className="sting-mono">
                        {outcome?.toUpload ?? reconciled?.uploaded ?? 0}
                      </span>{" "}
                      رُفعت ·{" "}
                      <span className="sting-mono">{outcome?.held ?? reconciled?.held ?? 0}</span>{" "}
                      للمراجعة
                      {(outcome?.held ?? reconciled?.held ?? 0) > 0 ? (
                        <>
                          {" "}
                          —{" "}
                          <Button variant="quiet" onClick={() => router.push("/sync/review")}>
                            البندان المحجوزان في مراجعة التعارضات
                          </Button>
                        </>
                      ) : null}
                    </>
                  ) : loaded ? (
                    "لا تغيّر جيلٍ معلّقاً على هذا الجهاز."
                  ) : null}
                </p>
                <p className="acc-choice__note">
                  <strong>أثرٌ دائم</strong> · الحدث يبقى في سجل التدقيق بتاريخه. من يراجع بعد أشهر
                  سيجد فجوةً في الترقيم — هذا السطر يفسّرها.
                </p>
              </Notice>
            ) : null}

            {failed ? (
              <Notice kind="error" title="تعذّرت المصالحة">
                <p className="acc-lead">الخادم لم يردّ على المقارنة — أعد المحاولة لاحقاً.</p>
              </Notice>
            ) : null}

            <div className="sys-legend">
              <div className="sys-legend__item">
                <Status state="synced" label="مؤكَّد" dot={false} />
                <span className="acc-choice__note">عمليات ثبتت على الجيل الجديد</span>
                <span className="acc-choice__note">موجودة في دفتر الخادم بأرقامها</span>
              </div>
              <div className="sys-legend__item">
                <Status state="pending_sync" label="معلَّق" dot={false} />
                <span className="acc-choice__note">ردود تخصّ جيلاً قديماً</span>
                <span className="acc-choice__note">
                  لن تُطبَّق. تُعاد محاولتها على الجيل الجديد ويُعرض ناتجها قبل الاعتماد.
                </span>
              </div>
              <div className="sys-legend__item">
                <Status state="conflict" label="يحتاجك" dot={false} />
                <span className="acc-choice__note">عمليات نجحت عندك وغابت عن الخادم</span>
                <span className="acc-choice__note">
                  موجودة في جهازك ومفقودة عنده. تُرفع من جديد بعد مراجعتك — ولا تُحذف تلقائياً
                  لتطابق الخادم.
                </span>
              </div>
              <div className="sys-legend__item">
                <Status state="empty" label="محسوم" dot={false} />
                <span className="acc-choice__note">مكرّرات مُنعت</span>
                <span className="acc-choice__note">وصلت مرتين بمعرّف واحد فحُسبت مرة</span>
              </div>
            </div>

            {pending.length > 0 && state !== "success" ? (
              <ul className="sys-recent" aria-label="المعلّق">
                {pending.slice(0, 10).map((op) => {
                  const d = describeOperation(op);
                  const amount = amountOf(op);
                  return (
                    <li key={op.operationId} className="sys-recent__row">
                      <span>
                        {d.title} <span className="sting-mono">{d.number}</span>
                      </span>
                      {amount ? <span className="sting-mono">{formatMinor(amount)}</span> : null}
                    </li>
                  );
                })}
              </ul>
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
