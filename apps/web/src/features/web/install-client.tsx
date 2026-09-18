"use client";

import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import "@/features/shifts/shifts.css";
import "@/features/sys/sys.css";
import { AppNav } from "@/features/home/app-nav";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import {
  type ApplyUpdateOutcome,
  applyUpdate,
  canPrompt,
  type InstallEnv,
  installEnv,
  onPwaChange,
  promptInstall,
  registerServiceWorker,
  updateReady,
  wasDismissed,
} from "@/lib/pwa";

type State = "ready" | "permission_denied" | "offline" | "success";

/**
 * WEB-01 — تثبيت PWA أو عدم دعم التثبيت (09-D5 ready/offline/success · permission_denied من لوحة
 * WEB-01·WEB-02): تعليمات حسب البيئة لا زر وهمي — Chrome/Android زر تثبيت؛ Safari/iOS خطوتان من
 * المتصفح؛ متصفح داخل تطبيق: غير مدعوم ونقولها. التحديث لا يفقد المعلّق (ACC-93) ولا يُطبَّق من تحت
 * يد المستخدم؛ من رفض لا يُسأل ثانيةً في الجلسة نفسها.
 */
export function InstallClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [env, setEnv] = useState<InstallEnv>("unknown");
  const [promptable, setPromptable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);
  const [update, setUpdate] = useState<ApplyUpdateOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Finstall");
      return;
    }
    const refresh = () => {
      setEnv(installEnv());
      setPromptable(canPrompt());
      setDismissed(wasDismissed());
      setReady(updateReady());
    };
    refresh();
    void registerServiceWorker().then(refresh);
    return onPwaChange(refresh);
  }, [router]);

  const state: State =
    env === "installed"
      ? "success"
      : env === "in_app_browser"
        ? "permission_denied"
        : !online
          ? "offline"
          : "ready";

  const install = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await promptInstall();
    } finally {
      setBusy(false);
      setEnv(installEnv());
      setPromptable(canPrompt());
      setDismissed(wasDismissed());
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const updateBar = ready ? (
    <Notice
      kind="info"
      title="نسخة جديدة جاهزة — أعد التحميل"
      action={
        <Button
          onClick={() =>
            void applyUpdate().then((o) => {
              setUpdate(o);
              setReady(updateReady());
            })
          }
        >
          أعد التحميل
        </Button>
      }
    >
      <p className="acc-lead">
        عند توفر نسخة جديدة لا نُحدِّث من تحت يدك: يظهر شريط «نسخة جديدة جاهزة — أعد التحميل»،
        والتحديث يُطبَّق عند إذنك أو عند إغلاق آخر تبويب. العمليات المحفوظة محلياً غير المزامَنة
        تُقرأ بالنسخة الجديدة ولا تُمحى — ACC-93
      </p>
      {update === "pending_work" ? (
        <p className="acc-choice__note">
          على الجهاز عمليات لم تُرفع بعد — التحديث ينتظر رفعها (مركز المزامنة).
        </p>
      ) : null}
    </Notice>
  ) : null;

  return (
    <Frame title="التثبيت" nav={<AppNav currentId="install" />} footer={null}>
      <div className="sys" data-screen="WEB-01" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">تثبيت PWA أو عدم دعم التثبيت</h2>
            <span className="cat-head__hint">الويب هو الطريق الأول لأغلب المحلات.</span>
          </div>
          <div className="acc-card__body">
            {updateBar}

            {state === "success" ? (
              <Notice kind="success" title="ثُبّت">
                <p className="acc-lead">
                  صار أيقونةً على الشاشة. نقول ما تغيّر: يفتح بلا متصفح، ويعمل بلا اتصال، والتخزين
                  أثبت.
                </p>
                <p className="acc-choice__note">
                  <strong>لا تكرار للطلب</strong> · من رفض التثبيت لا يُسأل ثانيةً في الجلسة نفسها،
                  والمدخل يبقى في الإعدادات.
                </p>
              </Notice>
            ) : null}

            {state === "offline" ? (
              <Notice kind="info" title="يعمل بلا اتصال بعد التثبيت">
                <p className="acc-lead">
                  المثبَّت يفتح ويبيع بلا شبكة؛ وغير المثبَّت في المتصفح كذلك بعد أول زيارة.
                </p>
                <p className="acc-choice__note">
                  <strong>الفرق المُعلن</strong> · المتصفح قد يمسح تخزينه تحت ضغط المساحة، والمثبَّت
                  أثبت. نقولها عند اقتراح التثبيت — سببٌ حقيقي لا إلحاح.
                </p>
                <Status state="offline" label="بلا اتصال الآن — التثبيت متاح حين تعود الشبكة" />
              </Notice>
            ) : null}

            {state === "permission_denied" ? (
              <Notice
                kind="warning"
                title="التثبيت والإشعار غير متاحين هنا"
                action={
                  <Button onClick={() => void copyLink()}>
                    {copied ? "نُسخ الرابط" : "نسخ الرابط لفتحه في المتصفح"}
                  </Button>
                }
              >
                <p className="acc-choice__note">متصفح داخل تطبيق · غير مدعوم</p>
                <p className="acc-lead">
                  فتحتَ الرابط داخل متصفح مدمج في تطبيق آخر. هذه البيئة لا تسمح بالتثبيت ولا
                  بإشعارات الويب، وقد تمحو ما يُحفظ محلياً دون إشعار.
                </p>
                <ol className="acc-choice__note">
                  <li>افتح الرابط في متصفح الجهاز الأساسي</li>
                  <li>سجّل الدخول هناك ثم ثبّت التطبيق</li>
                </ol>
                <p className="acc-choice__note">
                  حتى ذلك الحين يعمل كل شيء عدا التثبيت والإشعار والعمل بلا اتصال. لا نطلب إذناً
                  سيُرفض تلقائياً.
                </p>
              </Notice>
            ) : null}

            {state === "ready" && env === "ios_manual" ? (
              <Notice
                kind="info"
                title="التثبيت بخطوتين من المتصفح"
                action={
                  <Button variant="secondary" onClick={() => setShowSteps((v) => !v)}>
                    عرض التعليمات بالصور
                  </Button>
                }
              >
                <p className="acc-choice__note">Safari · iOS · تثبيت يدوي</p>
                <p className="acc-lead">
                  متصفحك لا يعطي التطبيقات زر تثبيت. الإضافة إلى الشاشة الرئيسية تتم من قائمة
                  المتصفح نفسه.
                </p>
                <ol className="acc-choice__note">
                  <li>افتح قائمة المشاركة في شريط المتصفح</li>
                  <li>اختر «إضافة إلى الشاشة الرئيسية»</li>
                  <li>أكد الاسم ثم افتح التطبيق من أيقونته</li>
                </ol>
                <p className="acc-choice__note">
                  لا نضع زراً يقول «تثبيت» ثم لا يفعل شيئاً. التعليمات تتغيّر حسب متصفحك ونسخته.
                </p>
                {showSteps ? (
                  <p className="acc-choice__note">
                    الصور التوضيحية تُضاف مع مواد الدعم — الخطوات أعلاه كافية.
                  </p>
                ) : null}
              </Notice>
            ) : null}

            {state === "ready" && env !== "ios_manual" ? (
              <Notice
                kind={promptable ? "success" : "info"}
                title={promptable ? "التثبيت متاح" : "التثبيت من قائمة المتصفح"}
                action={
                  <Button
                    pos
                    onClick={() => void install()}
                    loading={busy}
                    disabledReason={
                      dismissed
                        ? "رفضتَ التثبيت في هذه الجلسة — المدخل يبقى هنا"
                        : promptable
                          ? undefined
                          : "متصفحك لم يعرض التثبيت بعد — يظهر بعد التفاعل أو من قائمة المتصفح"
                    }
                  >
                    تثبيت التطبيق
                  </Button>
                }
              >
                <p className="acc-choice__note">Chrome · Android · مدعوم</p>
                <p className="acc-lead">
                  متصفحك يدعم التثبيت. التطبيق المثبَّت يعمل بلا اتصال ويحفظ العمليات محلياً حتى
                  تعود الشبكة.
                </p>
                <p className="acc-choice__note">
                  التثبيت لا يُنشئ حساباً جديداً ولا ينقل بياناتك — هو نفس التطبيق باختصار على
                  شاشتك.
                </p>
                <p className="acc-choice__note">
                  <strong>الفرق المُعلن</strong> · المتصفح قد يمسح تخزينه تحت ضغط المساحة، والمثبَّت
                  أثبت. نقولها عند اقتراح التثبيت — سببٌ حقيقي لا إلحاح.
                </p>
              </Notice>
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
