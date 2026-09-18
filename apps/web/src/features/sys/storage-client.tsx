"use client";

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
import { useApp } from "@/lib/app-context";
import {
  PENDING_STALE_MS,
  SAFE_MIN_BYTES,
  safeCleanup,
  type StorageSnapshot,
  storageSnapshot,
  type UsageBreakdown,
  usageBreakdown,
  WRITE_FAIL_EVENT,
  writeFailureCount,
} from "@/lib/diagnostics";
import { downloadLocalBackup } from "@/lib/local-backup";

type State = "ready" | "validation_error" | "server_error";

const MB = 1024 * 1024;
const mb = (bytes: number): string => String(Math.round(bytes / MB));

/**
 * SYS-04 — انخفاض التخزين أو فشل استدامته (16-D11 ready/validation_error/server_error): بالأيام لا
 * بالميجابايت؛ نمنع قبل الحفظ لا بعده — لا نجاح كاذب؛ التنظيف الآمن لا يلمس معلّقاً والمعاملات نفسها
 * لا تُحذف لتحرير مساحة أبداً؛ البديل الآمن تصدير نسخة.
 */
export function StorageClient({ blocked }: { blocked: string }) {
  const router = useRouter();
  const app = useApp();
  const [snap, setSnap] = useState<StorageSnapshot | null>(null);
  const [usage, setUsage] = useState<UsageBreakdown | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cleaned, setCleaned] = useState<number | null>(null);
  const [writeFails, setWriteFails] = useState(0);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    setSnap(await storageSnapshot());
    setUsage(await usageBreakdown());
    setWriteFails(writeFailureCount());
    setLoaded(true);
  }, []);

  useEffect(() => {
    // فشل كتابة أثناء العرض: الشاشة تعيد القراءة فوراً — «الجهاز الذي امتلأ يكذب» إن لم نُظهره
    const onFail = () => setWriteFails(writeFailureCount());
    window.addEventListener(WRITE_FAIL_EVENT, onFail);
    return () => window.removeEventListener(WRITE_FAIL_EVENT, onFail);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fsync%2Fstorage");
      return;
    }
    void load();
  }, [router, load]);

  const free = snap?.free ?? 0;
  const low = Boolean(snap && snap.quota > 0 && free < SAFE_MIN_BYTES);
  const writeFailed = writeFails >= 2;
  const state: State =
    loaded && low && writeFailed
      ? "server_error"
      : loaded && (low || blocked)
        ? "validation_error"
        : "ready";

  // «يكفي N أيام بيع بمعدّلك»: الاستهلاك اليومي = المستعمَل ÷ أيام منذ أقدم حفظ
  const days = (() => {
    if (!snap || !usage?.oldestSavedAt || snap.usage <= 0) return null;
    const elapsed = Math.max(
      1,
      (Date.now() - new Date(usage.oldestSavedAt).getTime()) / 86_400_000,
    );
    const perDay = snap.usage / elapsed;
    return perDay > 0 ? Math.floor(free / perDay) : null;
  })();
  const pendingStale = Boolean(
    usage?.oldestPendingAt &&
    Date.now() - new Date(usage.oldestPendingAt).getTime() > PENDING_STALE_MS,
  );
  const reclaimMb = usage ? Math.round((usage.reclaimableBytes / MB) * 10) / 10 : 0;

  const cleanup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setCleaned(await safeCleanup());
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cleanupButton = (
    <Button
      pos
      onClick={() => void cleanup()}
      loading={busy}
      disabledReason={
        usage && usage.reclaimableBytes > 0 ? undefined : "لا صور محلية ولا سجلات قديمة قابلة للحذف"
      }
    >
      فرّغ <span className="sting-mono">{reclaimMb}</span> ميجابايت بحذف الصور المحلية
    </Button>
  );

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="storage" />} footer={null}>
      <div className="sys" data-screen="SYS-04" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">مساحة الجهاز</h2>
            <span className="cat-head__hint">
              كم بقي، وكم يكفي من أيام البيع بمعدّلك، وما الذي يشغل المساحة — والصور أولها غالباً.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "server_error" ? (
              <Notice kind="error" title="مساحة الجهاز على وشك النفاد">
                <p className="acc-lead">
                  المتبقي أقل من <span className="sting-mono">40</span> ميغابايت. آخر محاولتي كتابة
                  فشلتا.
                </p>
                <p className="acc-choice__note">لن تظهر رسالة «تم الحفظ» ما دامت الكتابة تفشل.</p>
                <p className="acc-choice__note">
                  البديل الآمن: تصدير نسخة إلى ذاكرة خارجية ثم تفريغ المرفقات القديمة. المعاملات
                  نفسها لا تُحذف لتحرير مساحة أبداً.
                </p>
                <div className="sys-explain">
                  <div>
                    <span className="sys-explain__k">يتوقف</span>
                    <span className="acc-choice__note">إرفاق صور بالفواتير والمستندات الجديدة</span>
                    <span className="acc-choice__note">
                      البيع بالذمة — لأن قيده قد لا يُكتب، ودَين بلا قيد خسارة
                    </span>
                  </div>
                  <div>
                    <span className="sys-explain__k">يستمر</span>
                    <span className="acc-choice__note">
                      البيع النقدي بإيصال مختصر يُكتب في مساحة محجوزة سلفاً
                    </span>
                    <span className="acc-choice__note">قراءة التقارير والكشوف المحفوظة</span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button pos onClick={() => void downloadLocalBackup()}>
                    تصدير نسخة محلية
                  </Button>
                  {cleanupButton}
                </div>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="error" title="المساحة لا تكفي لعملية" action={cleanupButton}>
                <p className="acc-lead">
                  محاولة حفظ فاتورة والمساحة أقلّ من الحدّ الآمن. نمنع قبل الحفظ لا بعده.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نجاح كاذب</strong> · الأسوأ من المنع أن نقبل ثم نفقد. المنع مؤلمٌ
                  لحظةً، والفقد يُكتشف بعد أسبوع.
                </p>
                <p className="acc-choice__note">
                  <strong>مخرج فوري</strong> · زرٌّ حاضر ينفّذ الآن — الكاشير والزبون واقفان.
                </p>
              </Notice>
            ) : null}

            <div className="shift-facts">
              <div>
                <span className="shift-facts__k">المتبقي</span>
                <span className="shift-facts__v">
                  {snap ? (
                    <>
                      <span className="sting-mono">{mb(free)}</span> ميجابايت
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div>
                <span className="shift-facts__k">بالأيام لا بالميجابايت</span>
                <span className="shift-facts__v">
                  {days !== null ? (
                    <>
                      يكفي <span className="sting-mono">{days}</span> أيام بيع بمعدّلك
                    </>
                  ) : (
                    "لا معدّل بعد"
                  )}
                </span>
              </div>
              <div>
                <span className="shift-facts__k">الاستدامة</span>
                <span className="shift-facts__v">
                  {snap?.persisted === true ? (
                    <Status state="synced" label="تخزين مستديم" dot={false} />
                  ) : snap?.persisted === false ? (
                    <Status state="stale" label="غير مستديم — قد يُمحى" dot={false} />
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              {pendingStale ? (
                <div>
                  <span className="shift-facts__k">المعلّق</span>
                  <span className="shift-facts__v">
                    <Status
                      state="pending_sync"
                      label={
                        <>
                          معلّق منذ أكثر من <span className="sting-mono">6</span> ساعات
                        </>
                      }
                      dot={false}
                    />
                  </span>
                </div>
              ) : null}
            </div>

            <h3 className="cat-head__title">ما يشغل المساحة</h3>
            <div className="shift-facts">
              <div>
                <span className="shift-facts__k">صور الأصناف</span>
                <span className="shift-facts__v">لا صور محلية</span>
              </div>
              <div>
                <span className="shift-facts__k">عمليات مؤكدة</span>
                <span className="shift-facts__v sting-mono">{usage?.synced ?? 0}</span>
              </div>
              <div>
                <span className="shift-facts__k">عمليات معلّقة</span>
                <span className="shift-facts__v sting-mono">{usage?.pending ?? 0}</span>
              </div>
              <div>
                <span className="shift-facts__k">مرجعيات وأرصدة</span>
                <span className="shift-facts__v sting-mono">{usage?.projections ?? 0}</span>
              </div>
            </div>
            <p className="acc-choice__note">
              <strong>التنظيف الآمن</strong> · صور الأصناف تُحذف محلياً وتبقى على الخادم؛ الفواتير
              المؤكَّدة القديمة كذلك. لا نعرض زرّ تنظيف يلمس معلّقاً.
            </p>
            {state === "ready" ? <div className="cat-form__actions">{cleanupButton}</div> : null}
            {cleaned !== null ? (
              <p className="acc-choice__note">
                حُذفت سجلات <span className="sting-mono">{cleaned}</span> عملية مؤكدة قديمة —
                المعاملات نفسها باقية.
              </p>
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
