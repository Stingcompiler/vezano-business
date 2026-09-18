"use client";

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
import { DayLabel } from "@/features/pos/invoices-client";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { buildSupportPayload, errorLog, type SupportPayload } from "@/lib/diagnostics";
import { getStorage } from "@/lib/storage";

type State = "ready" | "empty" | "permission_denied" | "success";

const MB = 1024 * 1024;

function downloadReport(payload: SupportPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sting-support-${payload.generated_at.replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * SYS-11 — الدعم والتشخيص (19-D14 ready/empty/permission_denied/success): ما يُرسل معروض قبل
 * الإرسال — إصدار التطبيق ونوع الجهاز ومساحته الحرة وسجل الأخطاء التقنية آخر 48 ساعة ومعرّفات
 * العمليات المتعثّرة؛ لا أسماء ولا أرقام هواتف ولا أرصدة ولا مبالغ ولا رموز (ACC-87). الإرسال قرار
 * المالك؛ الموظف يُنشئ التقرير ويحفظه محلياً ويطلب من المالك إرساله.
 */
export function SupportClient() {
  const router = useRouter();
  const app = useApp();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [payload, setPayload] = useState<SupportPayload | null>(null);
  const [weekErrors, setWeekErrors] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ reference: string; sentKeys: string[] } | null>(null);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  const load = useCallback(async (c: ShiftContext | null) => {
    setPayload(
      await buildSupportPayload({
        id: c?.deviceId ?? "",
        prefix: c?.devicePrefix ?? "",
        branchCode: c?.branchCode ?? "",
      }),
    );
    setWeekErrors((await errorLog(24 * 7)).length);
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fsupport");
      return;
    }
    void (async () => {
      const c = await readShiftContext(getStorage(), app);
      setCtx(c);
      await load(c);
    })();
  }, [router, load]);

  const isOwner = ctx?.roleCode === "owner";
  const state: State = sent
    ? "success"
    : denied || (ctx !== null && !isOwner)
      ? "permission_denied"
      : payload && weekErrors === 0
        ? "empty"
        : "ready";

  const send = async () => {
    if (!payload || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data, response } = await api().POST("/api/support/reports", {
        body: {
          app_version: payload.app.version,
          note: note.trim(),
          payload: payload as unknown as Record<string, unknown>,
        },
      });
      if (response.status === 403) {
        setDenied(true);
        return;
      }
      const body = data as unknown as { reference: string; sent_keys: string[] } | undefined;
      if (!response.ok || !body) {
        setFailed(true);
        return;
      }
      setSent({ reference: body.reference, sentKeys: body.sent_keys });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const saveLocally = () => {
    if (!payload) return;
    downloadReport(payload);
    setSavedLocally(true);
  };

  const preview = payload ? (
    <div className="sys-explain">
      <div>
        <span className="sys-explain__k">يُرسل</span>
        <span className="acc-choice__note">إصدار التطبيق ونوع الجهاز ومساحته الحرة</span>
        <span className="acc-choice__note">
          <span className="sting-mono">{payload.app.version}</span> · {payload.app.ua_family} ·{" "}
          <span className="sting-mono">
            {Math.round(
              payload.storage.quota_bytes > 0
                ? (payload.storage.quota_bytes - payload.storage.usage_bytes) / MB
                : 0,
            )}
          </span>{" "}
          ميجابايت حرة
        </span>
        <span className="acc-choice__note">
          سجلّ الأخطاء التقنية آخر 48 ساعة ومعرّفات العمليات المتعثّرة
        </span>
        <span className="acc-choice__note">
          <span className="sting-mono">{payload.errors.length}</span> خطأ · معلّق{" "}
          <span className="sting-mono">{payload.sync.pending}</span> · محجوز{" "}
          <span className="sting-mono">{payload.sync.held}</span> · فشل طباعة{" "}
          <span className="sting-mono">{payload.print_failures}</span>
        </span>
      </div>
      <div>
        <span className="sys-explain__k">لا يُرسل</span>
        <span className="acc-choice__note">أسماء الأطراف وأرقام هواتفهم وأرصدتهم</span>
        <span className="acc-choice__note">مبالغ الفواتير وتفاصيل الأصناف والأسعار</span>
      </div>
    </div>
  ) : null;

  const errorRows = payload ? (
    <ul className="sys-timeline" aria-label="سجل الأخطاء">
      {payload.errors.slice(0, 20).map((e, i) => (
        <li key={i} className="sys-timeline__row">
          <span className="sys-timeline__at">
            <DayLabel iso={e.at} now={new Date()} />{" "}
            <span className="sting-mono">{hhmm(e.at)}</span>
          </span>
          <span className="sting-mono" dir="ltr">
            {e.event}
            {e.status ? ` ${e.status}` : ""}
            {e.code ? ` ${e.code}` : ""} · op {e.op}
          </span>
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <Frame title="مركز الاتصال والمزامنة" nav={<AppNav currentId="support" />} footer={null}>
      <div className="sys" data-screen="SYS-11" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الدعم والتشخيص</h2>
            <span className="cat-head__hint">
              ما يُرسل إلى الدعم. القاعدة الحاكمة: لا أسرار ولا بيانات مستأجر آخر ولا مبالغ.
            </span>
          </div>
          <div className="acc-card__body">
            {state === "success" && sent ? (
              <>
                <Notice kind="success" title="أُرسل التقرير">
                  <p className="acc-lead">
                    رقم مرجعي يُقال لموظف الدعم، ومعه بالضبط ما أُرسل: سجل الأخطاء، إصدار التطبيق،
                    حالة المزامنة.
                  </p>
                  <p className="acc-lead">
                    المرجع: <span className="sting-mono">{sent.reference}</span>
                  </p>
                  <p className="acc-choice__note">
                    <strong>وما لم يُرسل</strong> · نعدّده صراحةً: لا فواتير ولا مبالغ ولا أسماء
                    عملاء ولا رموز دخول. الثقة تُبنى بقول ما لم نأخذه لا بقول ما أخذنا.
                  </p>
                </Notice>
                {preview}
              </>
            ) : null}

            {state === "permission_denied" ? (
              <Notice kind="info" title="الإرسال للمالك">
                <p className="acc-lead">
                  التقرير يحوي بنية بيانات المنشأة وأسماء فروعها وأجهزتها. إرساله خارج المنشأة قرار
                  مالكها.
                </p>
                <p className="acc-choice__note">
                  <strong>ما يفعله الموظف</strong> · يُنشئ التقرير ويحفظه محلياً ويطلب من المالك
                  إرساله. عمله في التشخيص لا يُهدر.
                </p>
              </Notice>
            ) : null}

            {state === "empty" ? (
              <Notice kind="empty" title="لا شيء يُبلَّغ عنه">
                <p className="acc-lead">
                  لا أخطاء مسجّلة في آخر سبعة أيام. الشاشة تُفتح غالباً بطلب موظف الدعم لا بمبادرة
                  المستخدم.
                </p>
                <p className="acc-choice__note">
                  <strong>المخرج قائم</strong> · «أرسل تقريراً على أي حال» — فالمشكلة قد تكون سلوكاً
                  خاطئاً لا خطأً مسجّلاً.
                </p>
              </Notice>
            ) : null}

            {state !== "success" ? (
              <>
                <h3 className="cat-head__title">ما يُرسل بالضبط، معروض قبل الإرسال</h3>
                {preview}
                {payload && payload.errors.length > 0 ? errorRows : null}
                <p className="acc-choice__note">
                  أسماء الزبائن والأرقام والمبالغ <strong>لا تُرسل افتراضياً</strong>. لو احتاجها
                  الدعم يطلبها بتذكرة، وتُرفق بموافقتك لمرة واحدة تنتهي بإغلاق التذكرة.
                </p>
                <TextField
                  label="ملاحظة للدعم (اختياري)"
                  value={note}
                  onChange={(ev) => setNote(ev.target.value)}
                />
                {failed ? (
                  <Notice kind="error" title="لم يُرسل التقرير">
                    <p className="acc-lead">الخادم لم يقبل التقرير — احفظه محلياً وأعد المحاولة.</p>
                  </Notice>
                ) : null}
                <div className="cat-form__actions">
                  {state === "permission_denied" ? (
                    <>
                      <Button pos onClick={saveLocally}>
                        إنشاء التقرير وحفظه محلياً
                      </Button>
                      <Button disabledReason="الإرسال للمالك">أرسل تقريراً على أي حال</Button>
                    </>
                  ) : (
                    <>
                      <Button pos onClick={() => void send()} loading={busy}>
                        {state === "empty" ? "أرسل تقريراً على أي حال" : "إرسال التقرير"}
                      </Button>
                      <Button variant="secondary" onClick={saveLocally}>
                        حفظ محلياً
                      </Button>
                    </>
                  )}
                </div>
                {savedLocally ? (
                  <Status state="saved_local" label="حُفظ التقرير محلياً — اطلب من المالك إرساله" />
                ) : null}
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
