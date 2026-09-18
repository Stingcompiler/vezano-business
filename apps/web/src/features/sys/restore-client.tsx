"use client";

import {
  applyRestore,
  type BackupContent,
  type BackupEnvelope,
  backupFileId,
  describeOperation,
  inspectBackup,
  openBackup,
  previewRestore,
  readRestoreProgress,
  type RestorePreview,
  type RestoreProgress,
} from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, Status, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/sys/sys.css";
import { AppNav } from "@/features/home/app-nav";
import { readHomeCache } from "@/features/home/home-cache";
import { dayMonth, hhmm } from "@/features/home/format";
import { useApp } from "@/lib/app-context";
import { downloadLocalBackup } from "@/lib/local-backup";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

type State = "ready" | "validation_error" | "conflict" | "partial" | "success" | "server_error";
type Reject = "corrupt" | "other_tenant" | "newer_version" | "wrong_password";

const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

/** المبلغ المعروض لعملية معلّقة ستُعلن («ما سيُفقد إن تابعت الآن» في الإطار — هنا لا يُفقد شيء). */
function opAmount(
  kind: string,
  members: readonly { entity: string; payload: Record<string, unknown> }[],
): string {
  const find = (e: string) => members.find((m) => m.entity === e)?.payload ?? {};
  if (kind === "sale") return str(find("sales.Sale")["total_minor"]);
  if (kind === "sale_return") return str(find("sales.SaleReturn")["total_minor"]);
  if (kind === "payment_receipt" || kind === "refund")
    return str(find("parties.PaymentReceipt")["amount_minor"]);
  return "";
}

/**
 * SYS-06 — استعادة نسخة ومعاينتها (16-D11 ready/validation_error/conflict/partial/success/server_error):
 * أخطر فعل في النظام. الملف يُفحص قبل قراءة أي سطر (تالف / لمنشأة أخرى بلا كشف اسمها / إصدار
 * أحدث)؛ معاينة قبل أي كتابة تقول الفرق لا المحتوى؛ الاستعادة دمجٌ بالهويات لا إحلال على دفعات
 * قابلة للاستئناف؛ ما نجح ثابت وما تعثّر يُحجز باسم الصنف الناقص؛ مرتين = لا تكرار.
 */
export function RestoreClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [tenantName, setTenantName] = useState("");
  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<BackupEnvelope | null>(null);
  const [reject, setReject] = useState<Reject | null>(null);
  const [password, setPassword] = useState("");
  const [content, setContent] = useState<BackupContent | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [proceed, setProceed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  const [done, setDone] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fsync%2Frestore");
      return;
    }
    void (async () => {
      setTenantName((await readHomeCache())?.summary.tenant_name ?? "");
      // استعادة سابقة انقطعت: نعرض أين وقفنا وزرّ استئناف
      const prior = await readRestoreProgress(getStorage());
      if (prior) {
        setProgress(prior);
        setInterrupted(true);
      }
    })();
  }, [router]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setReject(null);
    setContent(null);
    setPreview(null);
    setProceed(false);
    const text = await file.text();
    setRaw(text);
    const out = inspectBackup(text, appRef.current.session.tenantId ?? "");
    if (!out.ok) {
      setEnvelope(null);
      setReject(out.reason);
      return;
    }
    setEnvelope(out.envelope);
  };

  const unlock = async () => {
    if (!envelope || busy) return;
    setBusy(true);
    try {
      const out = await openBackup(envelope, password);
      if (!out.ok) {
        setReject(out.reason);
        return;
      }
      setReject(null);
      setContent(out.content);
      setPreview(await previewRestore(getStorage(), out.content));
    } finally {
      setBusy(false);
    }
  };

  const run = async (opts: { stopAfter?: number } = {}) => {
    if (!envelope || !content || busy) return;
    setBusy(true);
    try {
      const out = await applyRestore(getStorage(), backupFileId(envelope), content, opts);
      setProgress(out.progress);
      if (out.done) {
        setDone(true);
        setInterrupted(false);
      } else {
        setInterrupted(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const pending = preview?.localPending ?? [];
  const state: State = done
    ? progress && progress.held.length > 0
      ? "partial"
      : "success"
    : interrupted
      ? "server_error"
      : reject
        ? "validation_error"
        : preview && pending.length > 0 && !proceed
          ? "conflict"
          : "ready";

  const exp = envelope ? dayMonth(envelope.exported_at) : null;

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="restore" />} footer={null}>
      <div className="sys" data-screen="SYS-06" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">استعادة نسخة ومعاينتها</h2>
            <span className="cat-head__hint">
              أخطر فعل في النظام: يكتب فوق دفتر قائم. خمس حالات ناقصة، كلها حراسة.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "server_error" && progress ? (
              <Notice
                kind="error"
                title="انقطع أثناء الكتابة"
                action={
                  <Button
                    pos
                    onClick={() => void run()}
                    loading={busy}
                    disabledReason={
                      content ? undefined : "اختر الملف نفسه وافتحه بكلمة الحماية للاستئناف"
                    }
                  >
                    استئناف
                  </Button>
                }
              >
                <p className="acc-lead">أسوأ توقيت. الدفتر الآن نصف مستعاد.</p>
                <p className="acc-choice__note">
                  <strong>لا نترك نصفاً</strong> · الاستعادة تُطبَّق على دفعات قابلة للتراجع: ما
                  اكتمل يبقى وما انقطع يُلغى كاملاً. ونعرض بالضبط أين وقفنا وزرّ استئناف.
                </p>
                <p className="acc-choice__note">
                  وقفنا عند الدفعة <span className="sting-mono">{progress.nextBatch}</span> من{" "}
                  <span className="sting-mono">{progress.totalBatches}</span> · أُضيف حتى الآن{" "}
                  <span className="sting-mono">{progress.added}</span>
                </p>
              </Notice>
            ) : null}

            {state === "success" && progress ? (
              <Notice kind="success" title="اكتملت الاستعادة">
                <p className="acc-lead">
                  ما أُضيف وما حُدّث بالأرقام: أُضيفت{" "}
                  <span className="sting-mono">{progress.added}</span> عملية · حُدّثت{" "}
                  <span className="sting-mono">{progress.updated}</span> أرصدة · لم يُحذف شيء.
                  ومعها: الكتابات الجديدة على هذا الجهاز تأخذ هوية جديدة — فلو استُعيد الملف مرتين
                  لم يتكرّر شيء.
                </p>
                <p className="acc-choice__note">
                  <strong>حماية التكرار</strong> · مذكورة في شاشة النجاح لا في وثيقة. من استعاد مرةً
                  قد يعيدها ظنّاً أنها لم تكتمل.
                </p>
              </Notice>
            ) : null}

            {state === "partial" && progress ? (
              <Notice kind="warning" title="استُعيد بعضه">
                <p className="acc-lead">
                  نزلت <span className="sting-mono">{progress.added - progress.held.length}</span>{" "}
                  فاتورة من <span className="sting-mono">{progress.added}</span>؛{" "}
                  <span className="sting-mono">{progress.held.length}</span> تشير إلى صنف لم يعد
                  موجوداً.
                </p>
                <p className="acc-choice__note">
                  <strong>لا نخترع</strong> · لا نُنشئ الصنف المحذوف تلقائياً لتكتمل الفاتورة.
                  الفواتير تبقى محجوزة باسم الصنف الناقص ليقرّر المالك.
                </p>
                <p className="acc-choice__note">
                  <strong>ما نجح ثابت</strong> · ما نزل لا يُلغى لأن بعضه تعثّر. الاستعادة تتقدّم
                  بما تستطيع وتُعلن ما عجزت عنه.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice
                kind="error"
                title={reject === "wrong_password" ? "كلمة الحماية غير صحيحة" : "الملف لا يُقبل"}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => document.getElementById("restore-file")?.click()}
                  >
                    اختيار ملف آخر
                  </Button>
                }
              >
                {reject === "other_tenant" ? (
                  <>
                    <p className="acc-lead">
                      رُفض الملف — لم يتغير شيء. هذه النسخة تخص منشأة أخرى. لم تُقرأ بياناتها ولم
                      تُكتب على جهازك.
                    </p>
                    <div className="shift-facts">
                      <div>
                        <span className="shift-facts__k">الملف</span>
                        <span className="shift-facts__v" dir="auto">
                          {fileName}
                        </span>
                      </div>
                      <div>
                        <span className="shift-facts__k">منشأة الملف</span>
                        <span className="shift-facts__v">لا تطابق منشأتك</span>
                      </div>
                      <div>
                        <span className="shift-facts__k">منشأتك</span>
                        <span className="shift-facts__v">{tenantName || "—"}</span>
                      </div>
                    </div>
                    <p className="acc-choice__note">
                      لا نعرض اسم المنشأة الأخرى ولا أي محتوى من الملف — عزل المستأجرين يمنع ذلك حتى
                      في رسالة الخطأ.
                    </p>
                  </>
                ) : reject === "newer_version" ? (
                  <p className="acc-lead">
                    <strong>إصدار أحدث</strong> · حدّث التطبيق ثم أعد المحاولة. الملف صالح والتطبيق
                    هو المتخلّف.
                  </p>
                ) : reject === "wrong_password" ? (
                  <p className="acc-lead">لم يُفتح الملف بهذه الكلمة — لم يتغير شيء.</p>
                ) : (
                  <p className="acc-lead">
                    الملف تالف أو ليس نسخة Sting — رُفض قبل قراءة أي سطر ولم يتغير شيء.
                  </p>
                )}
              </Notice>
            ) : null}

            {state === "conflict" ? (
              <Notice kind="warning" title="توقّف قبل الاستعادة">
                <p className="acc-lead">
                  على هذا الجهاز <span className="sting-mono">{pending.length}</span> عمليات لم تصل
                  الخادم. الاستعادة دمجٌ بالهويات لا إحلال — لا تمسّها، لكن ارفعها أولاً كي لا تختلط
                  بما سيُستعاد.
                </p>
                <p className="acc-choice__note">ما سيُفقد إن تابعت الآن: لا شيء — والمعلّق يبقى:</p>
                <ul className="sys-recent">
                  {pending.slice(0, 5).map((op) => {
                    const d = describeOperation(op);
                    const amount = opAmount(op.kind, op.members);
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
                <div className="cat-form__actions">
                  <Button
                    pos
                    onClick={() =>
                      void (async () => {
                        await pushPending(10, { manual: true });
                        if (content) setPreview(await previewRestore(getStorage(), content));
                      })()
                    }
                    disabledReason={!online ? "بلا اتصال" : undefined}
                  >
                    ارفع المعلّق أولاً — الأسلم
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void (async () => {
                        await downloadLocalBackup();
                        setProceed(true);
                      })()
                    }
                  >
                    تصدير المعلّق كملف ثم المتابعة
                  </Button>
                  <Button variant="quiet" onClick={() => setProceed(true)}>
                    متابعة الاستعادة
                  </Button>
                </div>
              </Notice>
            ) : null}

            {!done ? (
              <>
                <Notice kind="info" title="معاينة قبل أي كتابة">
                  <p className="acc-lead">
                    الملف قُرئ ولم يُكتب حرفٌ بعد. نعرض ما فيه: المنشأة، والتاريخ، والعدد، وما الذي
                    سيتغيّر مقارنةً بالحالي.
                  </p>
                  <p className="acc-choice__note">
                    <strong>لا استعادة كاملة عمياء</strong> · الاستعادة دمجٌ بالهويات لا إحلال.
                    الإحلال يمحو ما عمله الجهاز بعد النسخة.
                  </p>
                </Notice>
                <label className="cat-form__field">
                  <span>ملف النسخة</span>
                  <input
                    id="restore-file"
                    type="file"
                    accept=".stg,application/json"
                    aria-label="ملف النسخة"
                    onChange={(ev) => void pick(ev.target.files?.[0])}
                  />
                </label>
                {envelope && !content ? (
                  <>
                    <div className="shift-facts">
                      <div>
                        <span className="shift-facts__k">الملف</span>
                        <span className="shift-facts__v" dir="auto">
                          {fileName}
                        </span>
                      </div>
                      <div>
                        <span className="shift-facts__k">المنشأة</span>
                        <span className="shift-facts__v">{tenantName || "منشأتك"}</span>
                      </div>
                      <div>
                        <span className="shift-facts__k">التاريخ</span>
                        <span className="shift-facts__v">
                          <span className="sting-mono">{exp?.day}</span> {exp?.month}{" "}
                          <span className="sting-mono">{hhmm(envelope.exported_at)}</span>
                        </span>
                      </div>
                      <div>
                        <span className="shift-facts__k">العدد</span>
                        <span className="shift-facts__v">
                          <span className="sting-mono">{envelope.counts.operations}</span> عملية ·{" "}
                          <span className="sting-mono">{envelope.counts.pending}</span> معلّق
                        </span>
                      </div>
                    </div>
                    <TextField
                      label="كلمة الحماية"
                      type="password"
                      value={password}
                      onChange={(ev) => setPassword(ev.target.value)}
                    />
                    <div className="cat-form__actions">
                      <Button pos onClick={() => void unlock()} loading={busy}>
                        فتح الملف ومعاينته
                      </Button>
                    </div>
                  </>
                ) : null}
                {preview ? (
                  <>
                    <Notice kind="info" title="الفرق لا المحتوى">
                      <p className="acc-lead">
                        ستُضاف <span className="sting-mono">{preview.addOperations}</span> فاتورة ·
                        ستُحدَّث <span className="sting-mono">{preview.updateProjections}</span>{" "}
                        أرصدة · لن يُحذف شيء.
                      </p>
                      <p className="acc-choice__note">
                        من يستعيد يخاف مما سيُفقد لا مما سيُضاف. منها{" "}
                        <span className="sting-mono">{preview.addPending}</span> معلّق داخل النسخة ·{" "}
                        <span className="sting-mono">{preview.addProjections}</span> مرجعيات جديدة ·{" "}
                        <span className="sting-mono">{preview.heldOperations}</span> تشير إلى صنف
                        غير موجود وستُحجز.
                      </p>
                    </Notice>
                    {state === "ready" ? (
                      <div className="cat-form__actions">
                        <Button financial pos onClick={() => void run()} loading={busy}>
                          استعادة الآن
                        </Button>
                        {process.env.NODE_ENV !== "production" ? (
                          <Button variant="quiet" onClick={() => void run({ stopAfter: 1 })}>
                            محاكاة انقطاع بعد دفعة
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            {raw && !envelope && !reject ? <Status state="saving" label="يُفحص الملف" /> : null}
            <div className="cat-form__actions">
              <Button variant="quiet" onClick={() => router.push("/sync/backup")}>
                تصدير نسخة محلية
              </Button>
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
