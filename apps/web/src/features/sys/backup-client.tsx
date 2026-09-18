"use client";

import {
  type BackupContent,
  type BackupEnvelope,
  backupCounts,
  backupSizeBytes,
  collectBackup,
  sealBackup,
} from "@sting/sync-core";
import { Button, Frame, Notice, Status, TextField } from "@sting/ui-web";
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
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { storageSnapshot } from "@/lib/diagnostics";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";

type State = "ready" | "saving" | "validation_error" | "success" | "server_error";

const MB = 1024 * 1024;
const mb = (bytes: number): string => (Math.round((bytes / MB) * 10) / 10).toString();
/** حجم الغلاف ≈ النص × 4/3 (base64) + هامش */
const envelopeEstimate = (plain: number): number => Math.ceil(plain * 1.4) + 2048;

function fileName(exportedAt: string): string {
  return `sting-backup-${exportedAt.slice(0, 10).replace(/-/g, "")}-${exportedAt.slice(11, 16).replace(":", "")}.stg`;
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * SYS-05 — تصدير نسخة محلية (16-D11 ready/saving/validation_error/success/server_error): مخرج
 * الطوارئ — يعمل بلا اتصال وبلا صلاحية خادمية؛ نطاق التصدير مُعلن والمعلّق مشمول وموسوم؛ بلا أسرار؛
 * كلمة حماية + AES-GCM (قرار المالك 0002 س٤)؛ نحسب المساحة قبل البدء؛ التصدير نسخٌ لا رفع.
 */
export function BackupClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [content, setContent] = useState<BackupContent | null>(null);
  const [free, setFree] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [result, setResult] = useState<{
    name: string;
    bytes: number;
    at: string;
    envelope: BackupEnvelope;
    counts: ReturnType<typeof backupCounts>;
  } | null>(null);
  const [upload, setUpload] = useState<"none" | "uploading" | "done" | "failed">("none");
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async () => {
    const storage = getStorage();
    setContent(await collectBackup(storage));
    const snap = await storageSnapshot();
    setFree(snap?.quota ? snap.free : null);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fsync%2Fbackup");
      return;
    }
    void (async () => {
      setCtx(await readShiftContext(getStorage(), app));
      await load();
    })();
  }, [router, load]);

  const counts = content ? backupCounts(content) : null;
  const fullBytes = content ? envelopeEstimate(backupSizeBytes(content)) : 0;
  const pendingContent: BackupContent | null = content
    ? {
        operations: content.operations.filter((o) => o.state === "local" || o.state === "pending"),
        projections: [],
        counters: content.counters,
      }
    : null;
  const pendingBytes = pendingContent ? envelopeEstimate(backupSizeBytes(pendingContent)) : 0;
  const noSpace = free !== null && fullBytes > free;
  const passwordError = attempted && password.length < 6 ? "كلمة حماية من 6 أحرف فأكثر" : undefined;

  const state: State =
    upload === "failed"
      ? "server_error"
      : phase === "saved"
        ? "success"
        : phase === "saving"
          ? "saving"
          : noSpace && !pendingOnly
            ? "validation_error"
            : "ready";

  const exportNow = async () => {
    if (!content || phase !== "idle") return;
    setAttempted(true);
    if (password.length < 6) return;
    setPhase("saving");
    try {
      const chosen = pendingOnly && pendingContent ? pendingContent : content;
      const exportedAt = new Date().toISOString();
      const envelope = await sealBackup({
        content: chosen,
        password,
        tenantId: appRef.current.session.tenantId ?? "",
        deviceId: ctx?.deviceId ?? "",
        syncEpoch: (await getStorage().read((tx) => tx.getMeta("sync_epoch"))) ?? "",
        exportedAt,
      });
      const text = JSON.stringify(envelope);
      const name = fileName(exportedAt);
      download(name, text);
      setResult({
        name,
        bytes: new TextEncoder().encode(text).length,
        at: exportedAt,
        envelope,
        counts: backupCounts(chosen),
      });
      setPhase("saved");
    } catch {
      setPhase("idle");
    }
  };

  const uploadCopy = async () => {
    if (!result || upload === "uploading") return;
    setUpload("uploading");
    try {
      const { response } = await api().POST("/api/support/backups", {
        body: { file_name: result.name, envelope: JSON.stringify(result.envelope) },
      });
      setUpload(response.ok ? "done" : "failed");
    } catch {
      setUpload("failed");
    }
  };

  const share = async () => {
    if (!result) return;
    const nav = navigator as Navigator & {
      share?: (d: { title: string; text: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ title: result.name, text: `نسخة Sting المحلية ${result.name}` });
      } catch {
        /* أُلغيت المشاركة */
      }
    } else {
      download(result.name, JSON.stringify(result.envelope));
    }
  };

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="backup" />} footer={null}>
      <div className="sys" data-screen="SYS-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تصدير نسخة محلية</h2>
            <span className="cat-head__hint">
              مخرج الطوارئ في كل شاشة تخشى الفقد. يجب أن يعمل بلا اتصال وبلا صلاحية خادمية.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "server_error" ? (
              <Notice
                kind="error"
                title="فشل الرفع إلى التخزين"
                action={<Button onClick={() => void share()}>شارك يدوياً</Button>}
              >
                <p className="acc-lead">
                  اختار رفع النسخة إلى تخزين سحابي وفشل الرفع. الملف المحلي سليم.
                </p>
                <p className="acc-choice__note">
                  <strong>الملف باقٍ</strong> · في مجلد التنزيلات على هذا الجهاز باسم{" "}
                  <span className="sting-mono" dir="ltr">
                    {result?.name}
                  </span>
                  . فشل قناةٍ واحدة لا يُلغي نسخةً أُنتجت.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice
                kind="error"
                title="لا مساحة للملف"
                action={
                  <Button pos onClick={() => setPendingOnly(true)}>
                    تصدير المعلّق وحده (<span className="sting-mono">{mb(pendingBytes)}</span>{" "}
                    ميجابايت)
                  </Button>
                }
              >
                <p className="acc-lead">
                  النسخة تحتاج <span className="sting-mono">{mb(fullBytes)}</span> ميجابايت والمتاح{" "}
                  <span className="sting-mono">{mb(free ?? 0)}</span>. نحسب قبل البدء لا في منتصفه.
                </p>
                <p className="acc-choice__note">
                  <strong>البديل</strong> · تصدير المعلّق وحده — وهو أهم ما في النسخة على أي حال.
                </p>
              </Notice>
            ) : null}

            {state === "success" && result ? (
              <>
                <Notice kind="success" title="صُدّرت النسخة">
                  <p className="acc-lead">
                    اسم الملف وحجمه ووقته ومحتواه بالأرقام. والأهم: ما زالت العمليات{" "}
                    <span className="sting-mono">{result.counts.pending}</span> معلّقة — التصدير
                    نسخٌ لا رفع.
                  </p>
                  <p className="acc-choice__note">
                    <strong>لا نخلط</strong> · نقولها صراحةً لأن من صدّر قد يظنّ أنه «أنهى الموضوع».
                    النسخة حمايةٌ من الفقد لا بديلٌ عن المزامنة.
                  </p>
                </Notice>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">الملف</span>
                    <span className="shift-facts__v sting-mono" dir="ltr">
                      {result.name}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">حجم النسخة</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{mb(result.bytes)}</span> ميجابايت
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الوقت</span>
                    <span className="shift-facts__v sting-mono">{hhmm(result.at)}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المعاملات</span>
                    <span className="shift-facts__v sting-mono">{result.counts.operations}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الأطراف وأرصدتها</span>
                    <span className="shift-facts__v sting-mono">{result.counts.parties}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الأصناف والحركات</span>
                    <span className="shift-facts__v sting-mono">{result.counts.items}</span>
                  </div>
                </div>
                <div className="cat-form__actions">
                  <Button
                    variant="secondary"
                    onClick={() => void uploadCopy()}
                    loading={upload === "uploading"}
                    disabledReason={
                      !online
                        ? "بلا اتصال — الملف المحلي يكفي"
                        : upload === "done"
                          ? "رُفعت"
                          : undefined
                    }
                  >
                    رفع النسخة إلى تخزين المنشأة
                  </Button>
                  <Button variant="quiet" onClick={() => router.push("/sync")}>
                    مركز المزامنة
                  </Button>
                </div>
                {upload === "done" ? (
                  <Status state="synced" label="رُفعت نسخة إلى تخزين المنشأة" />
                ) : null}
              </>
            ) : null}

            {state !== "success" ? (
              <>
                <Notice kind="info" title="ما الذي يُصدَّر">
                  <p className="acc-lead">
                    نطاق التصدير مُعلن: كل بياناتك المحلية — الفواتير والأطراف والأرصدة والمعلّق.
                    وبلا أسرار: لا رموز جلسات ولا مفاتيح.
                  </p>
                  <p className="acc-choice__note">
                    <strong>يعمل بلا اتصال</strong> · وهذا سبب وجوده: من فقد الشبكة أو انتهت جلسته
                    يحتاجه أكثر من غيره.
                  </p>
                  <p className="acc-choice__note">
                    <strong>المعلّق مشمول</strong> · وموسوم بوضوح داخل الملف:{" "}
                    <span className="sting-mono">{counts?.pending ?? 0}</span> عمليات لم تُرفع.
                    النسخة التي تُغفل المعلّق تُطمئن كذباً.
                  </p>
                </Notice>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">المعاملات</span>
                    <span className="shift-facts__v sting-mono">
                      {pendingOnly ? (counts?.pending ?? 0) : (counts?.operations ?? 0)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الأطراف وأرصدتها</span>
                    <span className="shift-facts__v sting-mono">
                      {pendingOnly ? 0 : (counts?.parties ?? 0)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">الأصناف والحركات</span>
                    <span className="shift-facts__v sting-mono">
                      {pendingOnly ? 0 : (counts?.items ?? 0)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">حجم النسخة</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">
                        {mb(pendingOnly ? pendingBytes : fullBytes)}
                      </span>{" "}
                      ميجابايت
                    </span>
                  </div>
                </div>
                <Notice kind="warning" title="النسخة تحمل دفترك كاملاً؛ من يملكها يملك أرقامك">
                  <p className="acc-lead">
                    نطلب كلمة حماية قبل الحفظ، ونذكّرك أنها تحتوي أسماء زبائن وأرصدة ديون — لا
                    ترسلها في مجموعة واتساب.
                  </p>
                  <p className="acc-choice__note">
                    التشفير بكلمة الحماية (AES-GCM) — لا يستطيع النظام استرداد الكلمة إن نُسيت.
                  </p>
                </Notice>
                <TextField
                  label="كلمة الحماية"
                  type="password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  error={passwordError}
                  required
                />
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void exportNow()}
                    loading={phase === "saving"}
                    disabledReason={
                      !content
                        ? "جارٍ الجمع"
                        : noSpace && !pendingOnly
                          ? "لا مساحة للملف"
                          : undefined
                    }
                  >
                    حفظ بكلمة حماية
                  </Button>
                  <Button variant="secondary" disabledReason="المكان مجلد التنزيلات في المتصفح">
                    اختيار المكان
                  </Button>
                  {pendingOnly ? (
                    <Status state="pending_sync" label="المعلّق وحده" dot={false} />
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
