"use client";

import { readOpenShift } from "@sting/sync-core";
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
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import {
  APP_UPDATE_META,
  APP_VERSION,
  LAST_BACKUP_META,
  SAFE_MIN_BYTES,
  storageSnapshot,
} from "@/lib/diagnostics";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { countPending, pushPending } from "@/lib/sync";

type State = "ready" | "pending_sync" | "validation_error" | "success" | "server_error";

interface UpdateInfo {
  readonly latest_version: string;
  readonly notes: string;
  readonly schema_version: number;
  readonly released_at: string;
}

interface UpdateRecord {
  readonly from: string;
  readonly to: string;
  readonly at: string;
  readonly pendingBefore: number;
}

const WEEK_MS = 7 * 86_400_000;
const MB = 1024 * 1024;

/**
 * SYS-09 — تحديث التطبيق مع عمليات معلّقة (19-D14 ready/pending_sync/success/server_error ·
 * 16-D11 validation_error): التحديث يستبدل الكود على قاعدة فيها عملٌ لم يُرفع. لا تحديث إجباري
 * فوري؛ «ارفع ثم حدّث» بزرّ واحد؛ التحديث رغم المعلّق بتأكيد يقول المخاطرة؛ المسار الآمن: ارفع
 * المعلّق ← صدّر نسخة ← حدّث؛ الرجوع الآمن هو الافتراضي عند الفشل.
 */
export function UpdateClient({ updated }: { updated: string }) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [info, setInfo] = useState<UpdateInfo | null | undefined>(undefined);
  const [pending, setPending] = useState(0);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [free, setFree] = useState<number | null>(null);
  const [record, setRecord] = useState<UpdateRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const storage = getStorage();
    setPending(await countPending());
    const [lb, rec, shift] = await Promise.all([
      storage.read((tx) => tx.getMeta(LAST_BACKUP_META)),
      storage.read((tx) => tx.getMeta(APP_UPDATE_META)),
      readOpenShift(storage),
    ]);
    setLastBackup(lb || null);
    setShiftOpen(Boolean(shift));
    const snap = await storageSnapshot();
    setFree(snap?.quota ? snap.free : null);
    if (rec) {
      const r = JSON.parse(rec) as UpdateRecord;
      setRecord(r);
      // بعد إعادة التشغيل: نقول أولاً أن المعلّق نجا، ثم نمحو الأثر
      if (updated) await storage.transaction((tx) => tx.putMeta(APP_UPDATE_META, ""));
    }
    try {
      const { data, response } = await api().GET("/api/app/update", {});
      const body = data as unknown as UpdateInfo | undefined;
      setInfo(response.ok && body ? body : null);
      if (!response.ok) setFailed(true);
    } catch {
      setInfo(null);
      setFailed(true);
    }
  }, [updated]);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(
        `/login?next=${encodeURIComponent(updated ? "/sync/update?updated=1" : "/sync/update")}`,
      );
      return;
    }
    void load();
  }, [router, load, updated]);

  const available = Boolean(info?.latest_version && info.latest_version !== APP_VERSION);
  const backupFresh = Boolean(lastBackup && Date.now() - new Date(lastBackup).getTime() < WEEK_MS);
  const spaceOk = free === null || free > SAFE_MIN_BYTES * 2;
  const blockers = !backupFresh;

  const state: State =
    updated && record
      ? "success"
      : failed
        ? "server_error"
        : !available
          ? "ready"
          : pending > 0 && !confirmRisk
            ? "pending_sync"
            : blockers && !confirmRisk
              ? "validation_error"
              : "ready";

  const doUpdate = async () => {
    if (!info || busy) return;
    setBusy(true);
    try {
      const storage = getStorage();
      await storage.transaction((tx) =>
        tx.putMeta(
          APP_UPDATE_META,
          JSON.stringify({
            from: APP_VERSION,
            to: info.latest_version,
            at: new Date().toISOString(),
            pendingBefore: pending,
          } satisfies UpdateRecord),
        ),
      );
      // التطبيق ويب: «التركيب» = إعادة التحميل لالتقاط الحزمة الجديدة؛ فشل جلب الإصدار يُبقي القديم
      window.location.assign("/sync/update?updated=1");
    } catch {
      await getStorage().transaction((tx) => tx.putMeta(APP_UPDATE_META, ""));
      setFailed(true);
      setBusy(false);
    }
  };

  const uploadThenUpdate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await pushPending(10, { manual: true });
      const left = await countPending();
      setPending(left);
      if (left === 0 && backupFresh) {
        setBusy(false);
        await doUpdate();
        return;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="update" />} footer={null}>
      <div className="sys" data-screen="SYS-09" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تحديث التطبيق مع عمليات معلقة</h2>
            <span className="cat-head__hint">
              التحديث يستبدل الكود على قاعدة بيانات فيها عملٌ لم يُرفع.
            </span>
          </div>
          <div className="acc-card__body">
            <div className="shift-facts">
              <div>
                <span className="shift-facts__k">الإصدار الحالي</span>
                <span className="shift-facts__v sting-mono" dir="ltr">
                  {APP_VERSION}
                </span>
              </div>
              <div>
                <span className="shift-facts__k">تحديث متاح</span>
                <span className="shift-facts__v">
                  {info === undefined ? (
                    "—"
                  ) : available && info ? (
                    <>
                      <span className="sting-mono" dir="ltr">
                        {info.latest_version}
                      </span>
                      {info.notes ? ` · ${info.notes}` : ""}
                    </>
                  ) : (
                    "لا تحديث متاحاً"
                  )}
                </span>
              </div>
              <div>
                <span className="shift-facts__k">كم عملية معلّقة الآن؟</span>
                <span className="shift-facts__v sting-mono">{pending}</span>
              </div>
            </div>

            {state === "success" && record ? (
              <Notice kind="success" title="حُدّث التطبيق">
                <p className="acc-lead">
                  الإصدار الجديد يعمل، والمعلّق نجا كما هو:{" "}
                  <span className="sting-mono">{pending}</span> عملية ما زالت في الطابور بترتيبها.
                </p>
                <p className="acc-choice__note">
                  <strong>نقول ذلك أولاً</strong> · قبل أي ذكر لمزايا الإصدار. من حدّث وعنده معلّق
                  يسأل عنه لا عن الجديد.
                </p>
                <p className="acc-choice__note">
                  من{" "}
                  <span className="sting-mono" dir="ltr">
                    {record.from}
                  </span>{" "}
                  إلى{" "}
                  <span className="sting-mono" dir="ltr">
                    {record.to}
                  </span>{" "}
                  · <DayLabel iso={record.at} now={new Date()} />{" "}
                  <span className="sting-mono">{hhmm(record.at)}</span>
                </p>
              </Notice>
            ) : null}

            {state === "server_error" ? (
              <Notice
                kind="error"
                title="فشل التحديث"
                action={
                  <Button
                    onClick={() => {
                      setFailed(false);
                      void load();
                    }}
                  >
                    أعد المحاولة
                  </Button>
                }
              >
                <p className="acc-lead">
                  التنزيل أو التركيب تعثّر. الإصدار القديم يعمل كما كان والمعلّق سليم.
                </p>
                <p className="acc-choice__note">
                  <strong>الرجوع الآمن</strong> · هو السلوك الافتراضي لا خياراً. تطبيقٌ نصف محدَّث
                  على دفتر مالٍ حالةٌ لا نسمح بوجودها.
                </p>
              </Notice>
            ) : null}

            {state === "pending_sync" ? (
              <Notice kind="warning" title="حدّث بعد رفع المعلّق">
                <p className="acc-lead">
                  <span className="sting-mono">{pending}</span> عملية معلّقة والتحديث ينتظر. لا نمنع
                  — نُرتّب.
                </p>
                <p className="acc-choice__note">
                  <strong>الترتيب المقترح</strong> · ارفع ثم حدّث. وزرّه واحد ينفّذ الاثنين بالترتيب
                  بلا أن يعود المستخدم مرتين.
                </p>
                <p className="acc-choice__note">
                  <strong>التحديث رغم المعلّق</strong> · متاح بتأكيد يقول المخاطرة صراحةً: التحديث
                  يُهاجر قاعدة البيانات، ومعلّقٌ من إصدار قديم قد يحتاج تدخّلاً.
                </p>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void uploadThenUpdate()}
                    loading={busy}
                    disabledReason={!online ? "بلا اتصال — الرفع أولاً يحتاج الشبكة" : undefined}
                  >
                    ارفع ثم حدّث
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmRisk(true)}>
                    التحديث رغم المعلّق
                  </Button>
                  <Button variant="quiet" onClick={() => setDeferred(true)}>
                    تأجيل التحديث حتى المزامنة
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="warning" title="تحديث التطبيق مؤجَّل">
                <p className="acc-lead">
                  التحديث يغيّر صيغة التخزين. تشغيله الآن مع معلّق غير مرفوع مخاطرة لا داعي لها.
                </p>
                <p className="acc-choice__note">
                  <strong>المسار الآمن:</strong> ارفع المعلّق ← صدّر نسخة ← حدّث. لو تعذّر الرفع،
                  التحديث يبقى متاحاً باختيارك بعد تصدير نسخة، ونقول إن العودة للإصدار السابق غير
                  مضمونة.
                </p>
                <div className="sys-legend">
                  <div className="sys-legend__item">
                    <Status state="server_error" label="مانع" dot={false} />
                    <span className="acc-choice__note">
                      لا توجد نسخة محلية محفوظة خلال آخر 7 أيام
                    </span>
                  </div>
                  <div className="sys-legend__item">
                    <Status
                      state={spaceOk ? "synced" : "server_error"}
                      label={spaceOk ? "سليم" : "مانع"}
                      dot={false}
                    />
                    <span className="acc-choice__note">
                      {spaceOk
                        ? "مساحة كافية للتحديث وللنسخة الاحتياطية معاً"
                        : "المساحة لا تكفي للتحديث وللنسخة معاً"}
                      {free !== null ? (
                        <>
                          {" "}
                          · <span className="sting-mono">{Math.round(free / MB)}</span> ميجابايت
                        </>
                      ) : null}
                    </span>
                  </div>
                  {shiftOpen ? (
                    <div className="sys-legend__item">
                      <Status state="stale" label="تنبيه" dot={false} />
                      <span className="acc-choice__note">
                        التحديث سيُعيد تشغيل التطبيق — لا تبدأه أثناء وردية مفتوحة
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="cat-form__actions">
                  <Button pos onClick={() => router.push("/sync/backup")}>
                    صدّر نسخة
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmRisk(true)}>
                    التحديث بلا نسخة — على مسؤوليتي
                  </Button>
                  <Button variant="quiet" onClick={() => setDeferred(true)}>
                    تأجيل التحديث حتى المزامنة
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "ready" && available ? (
              <Notice kind="info" title="تحديث متاح">
                <p className="acc-lead">
                  رقم الإصدار وما فيه، ثم السؤال الحاسم: كم عملية معلّقة الآن؟ صفرٌ يعني تحديثاً
                  آمناً، وغيره يعني قراراً.
                </p>
                <p className="acc-choice__note">
                  <strong>لا تحديث إجباري فوري</strong> · التحديث في منتصف يوم بيعٍ مزدحم قرارٌ سيئ
                  ولو كان الإصدار أفضل. نقترح «بعد إقفال الوردية».
                </p>
                {confirmRisk ? (
                  <p className="acc-choice__note">
                    <Status state="conflict" label="على مسؤوليتك" dot={false} /> التحديث يُهاجر
                    قاعدة البيانات ومعلّقٌ من إصدار قديم قد يحتاج تدخّلاً — والعودة للإصدار السابق
                    غير مضمونة.
                  </p>
                ) : null}
                <div className="cat-form__actions">
                  <Button financial pos onClick={() => void doUpdate()} loading={busy}>
                    حدّث الآن
                  </Button>
                  <Button variant="quiet" onClick={() => setDeferred(true)}>
                    بعد إقفال الوردية
                  </Button>
                </div>
              </Notice>
            ) : null}

            {state === "ready" && !available && info !== undefined && !updated ? (
              <p className="acc-choice__note">الإصدار الحالي هو الأحدث — لا شيء يُحدَّث.</p>
            ) : null}
            {deferred ? (
              <Status
                state="pending_sync"
                label="أُجّل التحديث حتى المزامنة — نحاول رفع المعلّق أولاً لو كان الجهاز متصلاً"
              />
            ) : null}
            {lastBackup ? (
              <p className="acc-choice__note">
                آخر نسخة محلية: <DayLabel iso={lastBackup} now={new Date()} />{" "}
                <span className="sting-mono">{hhmm(lastBackup)}</span>
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
