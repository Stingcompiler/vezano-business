"use client";

import type { StoredOperation } from "@sting/platform";
import { pushOnce } from "@sting/sync-core";
import { Button, Frame, Notice, Status } from "@sting/ui-web";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import { setAccessToken } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { downloadLocalBackup } from "@/lib/local-backup";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { createPushTransport } from "@/lib/sync";

type State = "expired" | "saved_local" | "offline" | "pending_sync" | "success";

/** أنواع العمليات كما تُعرض في «على هذا الجهاز ولم يُرفع بعد» (34-D26 pendingWork). */
const KIND_LABEL: Record<string, string> = {
  sale_invoice: "فواتير بيع لم تُرفع",
  receipt: "سندات قبض",
  cash_movement: "حركة صندوق",
};

interface Pending {
  readonly total: number;
  readonly byKind: readonly {
    readonly kind: string;
    readonly label: string | null;
    readonly n: number;
  }[];
}

async function readPending(): Promise<Pending> {
  const ops: StoredOperation[] = await getStorage().read(async (tx) => [
    ...(await tx.listOperationsByState("local")),
    ...(await tx.listOperationsByState("pending")),
  ]);
  const counts = new Map<string, number>();
  for (const op of ops) counts.set(op.kind, (counts.get(op.kind) ?? 0) + 1);
  return {
    total: ops.length,
    byKind: [...counts].map(([kind, n]) => ({ kind, label: KIND_LABEL[kind] ?? null, n })),
  };
}

/**
 * ACC-08. «لا تنتهي جلسةٌ على عملٍ لم يُرفع»: العمل باقٍ على الجهاز، لا يُرفع بجلسة منتهية ولا يُمحى.
 * `expired` (06-D2) حين لا معلّق؛ `saved_local` (34-D26) حين يوجد معلّق؛ ثم `pending_sync` بعد التحقق
 * و`success` بعدد ما رُفع؛ `offline`: صدّر نسخة محلية.
 */
export function SessionExpiredClient() {
  const router = useRouter();
  const params = useSearchParams();
  const app = useApp();
  const online = useOnline();
  const returnTo = params.get("return") ?? "/";
  const [pending, setPending] = useState<Pending | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [uploaded, setUploaded] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exported, setExported] = useState<number | null>(null);
  const started = useRef(false);

  useEffect(() => {
    void readPending().then(setPending);
    void getStorage()
      .read((tx) => tx.getMeta("shift.open"))
      .then((v) => setShiftOpen(Boolean(v)));
  }, []);

  // بعد إعادة التحقق (عاد بجلسة): الرفع بالترتيب الذي وقعت به العمليات
  useEffect(() => {
    if (params.get("phase") !== "upload" || !app.tokens || started.current) return;
    started.current = true;
    setUploading(true);
    void (async () => {
      const storage = getStorage();
      const before = (await readPending()).total;
      const epoch = (await storage.read((tx) => tx.getMeta("sync_epoch"))) ?? "";
      if (app.device) setAccessToken(app.device.access);
      const transport = createPushTransport(async (sent) => (await readPending()).total - sent);
      let synced = 0;
      for (let i = 0; i < 50; i++) {
        const out = await pushOnce(storage, {
          transport,
          syncEpoch: epoch,
          requestId: crypto.randomUUID(),
        });
        if (out.kind === "applied") synced += out.synced;
        if (out.kind === "idle" || out.kind === "halt") break;
        if (out.kind === "retry") await new Promise((r) => setTimeout(r, out.delayMs));
      }
      setUploaded(before === 0 ? 0 : synced);
      setPending(await readPending());
      setUploading(false);
    })();
  }, [app.device, app.tokens, params]);

  const reauth = useCallback(() => {
    const next = `/session-expired?phase=upload&return=${encodeURIComponent(returnTo)}`;
    router.push(`/login?next=${encodeURIComponent(next)}`);
  }, [returnTo, router]);

  const exportBackup = useCallback(async () => {
    setExported(await downloadLocalBackup());
  }, []);

  const state: State =
    uploaded !== null
      ? "success"
      : uploading
        ? "pending_sync"
        : !online
          ? "offline"
          : (pending?.total ?? 0) > 0
            ? "saved_local"
            : "expired";
  const n = pending?.total ?? 0;

  return (
    <Frame title="Sting" footer={null}>
      <div className="acc-page" data-screen="ACC-08" data-state={state}>
        <div className="acc-card" style={{ inlineSize: "min(100%, 540px)" }}>
          {state === "expired" ? (
            <>
              <div
                className="acc-card__head acc-card__head--tone"
                style={
                  {
                    "--acc-head-bg": "var(--color-state-expired-bg)",
                    "--acc-head-border": "var(--color-state-expired-border)",
                    "--acc-head-fg": "var(--color-state-expired-fg)",
                    "--acc-title-fg": "var(--color-state-expired-fg)",
                  } as React.CSSProperties
                }
              >
                <h2 className="acc-card__title" style={{ fontSize: 18 }}>
                  انتهت جلستك
                </h2>
                <p className="acc-card__sub">سجّل الدخول مجدداً لمتابعة المزامنة.</p>
              </div>
              <div className="acc-card__body">
                <dl className="acc-facts">
                  <div>
                    <dt>حالة عملك الآن</dt>
                  </div>
                  <div>
                    <dt>
                      <span className="sting-mono">{n}</span> عمليات محفوظة محلياً
                    </dt>
                    <dd style={{ color: "var(--color-ok)" }}>آمنة</dd>
                  </div>
                  {shiftOpen ? (
                    <div>
                      <dt>الوردية المفتوحة</dt>
                      <dd style={{ color: "var(--color-ok)" }}>مستمرة</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>الرفع إلى الخادم</dt>
                    <dd style={{ color: "var(--color-warn)" }}>متوقف</dd>
                  </div>
                </dl>
                <div className="acc-item acc-item--ok">
                  <div className="acc-item__note">
                    لم يُفقد شيء. البيع المحلي يستمر بعد إعادة الدخول، والعمليات{" "}
                    <span className="sting-mono">{n}</span> تُرفع تلقائياً. لن نطلب منك إعادة
                    إدخالها.
                  </div>
                </div>
                <div className="acc-actions">
                  <Button financial onClick={reauth}>
                    إعادة تسجيل الدخول
                  </Button>
                  <Button variant="secondary" onClick={() => void exportBackup()}>
                    تصدير نسخة محلية أولاً
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {state === "saved_local" && pending ? (
            <>
              <div
                className="acc-card__head acc-card__head--tone"
                style={
                  {
                    "--acc-head-bg": "var(--color-state-saved_local-bg)",
                    "--acc-head-border": "var(--color-state-saved_local-border)",
                    "--acc-head-fg": "var(--color-state-saved_local-fg)",
                    "--acc-title-fg": "var(--color-state-saved_local-fg)",
                  } as React.CSSProperties
                }
              >
                <h2 className="acc-card__title" style={{ fontSize: 16 }}>
                  جلستك انتهت — وعملك محفوظ
                </h2>
              </div>
              <div className="acc-card__body">
                <dl className="acc-facts">
                  <div>
                    <dt>على هذا الجهاز ولم يُرفع بعد</dt>
                  </div>
                  {pending.byKind.map((k) => (
                    <div key={k.kind}>
                      <dt>{k.label ?? <span className="sting-mono">{k.kind}</span>}</dt>
                      <dd className="sting-mono">{k.n}</dd>
                    </div>
                  ))}
                </dl>
                <p className="acc-lead">
                  أعِد التحقق ليُرفع كل ذلك باسمك. <strong>لا نمسح شيئاً</strong>: العمل باقٍ على
                  الجهاز حتى لو أغلقتَ التطبيق أو انتظرتَ أياماً.
                </p>
                <div className="acc-item acc-item--danger">
                  <div className="acc-item__note">
                    <strong>ما لا نفعله:</strong> لا نرفع العمل بجلسة منتهية ولو كان محفوظاً — الرفع
                    يحتاج هويةً حيّة، وإلا نُسب عملٌ لمن لم يكن حاضراً. ولا نمسحه لإنهاء الجلسة
                    «نظيفةً»؛ النظافة هنا إتلاف.
                  </div>
                </div>
                <div className="acc-actions">
                  <Button financial onClick={reauth}>
                    أعد التحقق وارفع
                  </Button>
                  <Button variant="secondary" onClick={() => void exportBackup()}>
                    صدّر نسخة أولاً
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {state === "offline" ? (
            <div className="acc-card__body">
              <Notice kind="offline" title="انتهت الجلسة وأنت بلا اتصال">
                <p className="acc-lead">
                  لا يمكن التحقق بلا شبكة. الجلسة منتهية والعمل محفوظ ومعلّق، والجهاز مقفل على شاشة
                  واحدة.
                </p>
                <div className="acc-links">
                  <Button onClick={() => void exportBackup()}>صدّر نسخة محلية</Button>
                </div>
              </Notice>
            </div>
          ) : null}

          {state === "pending_sync" ? (
            <div className="acc-card__body">
              <Notice kind="info" title="الرفع جارٍ بعد التحقق">
                <p className="acc-lead">
                  <span className="sting-mono">{n}</span> في الطابور تُرفع بالترتيب الذي وقعت به لا
                  بترتيب حجمها.
                </p>
              </Notice>
              <Status state="pending_sync" />
            </div>
          ) : null}

          {state === "success" ? (
            <div className="acc-card__body">
              <Notice kind="success" title="عاد كل شيء">
                <p className="acc-lead">
                  التحقق تمّ و<span className="sting-mono">{uploaded}</span> رُفعت ونُسبت إليك.
                </p>
              </Notice>
              <div className="acc-actions">
                <Button onClick={() => router.replace(returnTo)}>العودة</Button>
              </div>
            </div>
          ) : null}

          {exported !== null ? (
            <div className="acc-card__body" style={{ paddingBlockStart: 0 }}>
              <Status
                state="saved_local"
                label={
                  <>
                    <span className="sting-mono">{exported}</span> محفوظ محلياً
                  </>
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
