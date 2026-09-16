"use client";

import { type LocalShift, openShiftLocally, readOpenShift } from "@sting/sync-core";
import {
  Button,
  formatMinor,
  Frame,
  Notice,
  parseMoneyInput,
  Status,
  SyncIndicator,
  TextField,
} from "@sting/ui-web";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/shifts/shifts.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { type ShiftContext, readShiftContext, storeShiftContext } from "./context";

type State = "ready" | "validation_error" | "offline" | "saved_local" | "success";

interface Previous {
  readonly closed_at: string;
  readonly user_name: string;
  readonly counted_cash_minor: string;
  readonly expected_cash_at_close_minor: string;
}

/** «أمس 11:42 م · سالم» — اليوم/أمس بالعربية والوقت بأرقام لاتينية في mono. */
function DayTime({ iso }: { iso: string }) {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  const h = d.getHours();
  const twelve = String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return (
    <>
      {days === 0 ? (
        "اليوم"
      ) : days === 1 ? (
        "أمس"
      ) : (
        <span className="sting-mono">{d.toISOString().slice(0, 10)}</span>
      )}{" "}
      <span className="sting-mono">
        {twelve}:{m}
      </span>{" "}
      {h < 12 ? "ص" : "م"}
    </>
  );
}

/**
 * SHIFT-01 — فتح وردية (38-D30 ready/validation_error/saved_local/success · 06-D2 offline): تُفتح
 * بعدٍّ كما تُقفل بعدّ. الحفظ محلي أولاً (ShiftOpened حدث ثابت) ثم يُرفع فوراً إن كان الاتصال قائماً؛
 * بلا اتصال تُفتح على الجهاز ويعمل البيع وتُرفع مع عملياتها عند العودة (ACC-34).
 */
export function OpenShiftClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [previous, setPrevious] = useState<Previous | null>(null);
  const [counted, setCounted] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [shift, setShift] = useState<LocalShift | null>(null);
  const [synced, setSynced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<LocalShift | null>(null);
  const opIds = useRef({ shiftId: "", operationId: "" });
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fshifts%2Fopen");
      return;
    }
    if (!opIds.current.shiftId)
      opIds.current = { shiftId: crypto.randomUUID(), operationId: crypto.randomUUID() };
    void (async () => {
      const storage = getStorage();
      setExisting(await readOpenShift(storage));
      const local = await readShiftContext(storage, app);
      setCtx(local);
      if (!online || !app.tokens) return;
      try {
        const { data, response } = await api().GET("/api/shifts/current", {
          params: { query: local?.branchId ? { branch_id: local.branchId } : {} },
        });
        if (!response.ok || !data) return;
        const d = data as unknown as {
          branch_id: string;
          branch_name: string;
          device_name: string;
          user_name: string;
          previous: Previous | null;
        };
        const fresh: ShiftContext = {
          branchId: d.branch_id,
          branchName: d.branch_name || local?.branchName || "",
          deviceId: local?.deviceId ?? "",
          deviceName: d.device_name || local?.deviceName || "",
          userId: app.session.userId ?? local?.userId ?? "",
          userName: d.user_name || app.session.displayName || local?.userName || "",
          roleName: local?.roleName ?? "",
        };
        await storeShiftContext(storage, fresh);
        setCtx(fresh);
        setPrevious(d.previous);
      } catch {
        /* بلا اتصال فعلي: السياق المحلي يكفي */
      }
    })();
  }, [app.tokens, app.expired, online, router]);

  const open = async () => {
    if (busy || !ctx) return;
    const minor = parseMoneyInput(counted);
    if (!counted.trim() || minor === null || minor.startsWith("-")) {
      // الفراغ ليس صفراً: «لم أعدّ» تختلف عن «الدرج فارغ»
      setError(
        "درجٌ فارغ حالةٌ مشروعة تُكتب 0.00. والحقل الفارغ يُعلَّم ولا يُحسب صفراً بالنيابة.",
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const now = new Date();
      const { shift: saved } = await openShiftLocally(getStorage(), {
        shiftId: opIds.current.shiftId,
        operationId: opIds.current.operationId,
        branchId: ctx.branchId,
        branchName: ctx.branchName,
        deviceId: ctx.deviceId,
        deviceName: ctx.deviceName,
        userId: ctx.userId,
        userName: ctx.userName,
        openingFloatMinor: minor,
        businessDate: now.toISOString().slice(0, 10),
        occurredAt: now.toISOString(),
      });
      setShift(saved);
      if (online && app.tokens) {
        const out = await pushPending();
        if (out.kind === "applied" || out.kind === "idle") {
          const op = await getStorage().read((tx) => tx.getOperation(saved.operation_id));
          setSynced(op?.state === "synced");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = shift
    ? synced
      ? "success"
      : "saved_local"
    : error
      ? "validation_error"
      : !online
        ? "offline"
        : "ready";
  const openedOffline = shift !== null && !synced && !online;

  return (
    <Frame
      title="الورديات"
      nav={<AppNav currentId="home" />}
      footer={null}
      notice={!online ? <Status state="offline" label="بلا اتصال" /> : undefined}
    >
      <div className="home" data-screen="SHIFT-01" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">فتح وردية</h2>
            {ctx ? (
              <span className="cat-head__hint">
                {ctx.deviceName} · {ctx.userName}
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {existing && !shift ? (
              <Notice
                kind="info"
                title="الوردية مفتوحة"
                action={
                  <Link href="/shifts/current" className="c-btn c-btn--primary">
                    الوردية الحالية
                  </Link>
                }
              >
                <p className="acc-lead">
                  <span className="sting-mono">{existing.number}</span> · منذ{" "}
                  <span className="sting-mono">{hhmm(existing.opened_at)}</span> ·{" "}
                  {existing.user_name}
                </p>
              </Notice>
            ) : null}

            {state === "offline" ? (
              <Notice kind="offline" title="بلا اتصال">
                <p className="acc-lead">
                  لا اتصال بالخادم الآن. تُفتح الوردية محلياً ويعمل البيع كاملاً، وتُرفع مع عملياتها
                  عند عودة الاتصال.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" ? (
              <Notice kind="error" title="عدٌّ بلا رقم">
                <p className="acc-lead">
                  محاولة الفتح والحقل فارغ. الفراغ ليس صفراً: «لم أعدّ» تختلف عن «الدرج فارغ».
                </p>
                <p className="acc-lead">
                  <strong>الصفر يُدخَل صراحةً</strong>
                </p>
              </Notice>
            ) : null}

            {shift ? (
              <Notice
                kind={openedOffline ? "offline" : "success"}
                title={openedOffline ? "فُتحت بلا اتصال" : "الوردية مفتوحة"}
                action={
                  <Link href="/pos" className="c-btn c-btn--primary">
                    نقطة البيع
                  </Link>
                }
              >
                {openedOffline ? (
                  <p className="acc-lead">
                    الوردية مفتوحة على الجهاز والبيع يعمل. تُرفع عند عودة الشبكة.
                  </p>
                ) : (
                  <p className="acc-lead">
                    رقمها ووقتها والمعدود الافتتاحي باسم من عدّ. والمسار الواحد: نقطة البيع.
                  </p>
                )}
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">شهادة الفتح</span>
                    <span className="shift-facts__v">
                      <span className="sting-mono">{shift.number}</span> ·{" "}
                      <span className="sting-mono">{hhmm(shift.opened_at)}</span> ·{" "}
                      <span className="sting-mono">{formatMinor(shift.opening_float_minor)}</span> ·{" "}
                      {shift.user_name}
                    </span>
                  </div>
                </div>
                <SyncIndicator
                  state={synced ? "synced" : openedOffline ? "offline" : "pending_sync"}
                  lastServerAt={synced ? hhmm(shift.opened_at) : null}
                  pendingCount={synced ? 0 : 1}
                  pendingLabel={(n) => (n === 1 ? "عملية واحدة معلّقة" : `${n} عمليات معلّقة`)}
                />
              </Notice>
            ) : null}

            {!shift ? (
              <>
                {previous ? (
                  <div className="shift-prev">
                    <div>
                      <div className="shift-prev__k">الوردية السابقة أُقفلت</div>
                      <div className="shift-prev__v">
                        <DayTime iso={previous.closed_at} /> · {previous.user_name}
                      </div>
                    </div>
                    <div>
                      <div className="shift-prev__k">ما تركته في الدرج</div>
                      <div className="shift-prev__v sting-mono">
                        {formatMinor(
                          previous.counted_cash_minor ||
                            previous.expected_cash_at_close_minor ||
                            "0",
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="cat-price__field">
                  <TextField
                    label="ما تعدّه الآن في الدرج"
                    hint="إلزامي"
                    mono
                    value={counted}
                    onChange={(e) => {
                      setCounted(e.target.value);
                      setError(undefined);
                    }}
                    error={error}
                    disabledReason={busy ? "جارٍ الحفظ" : undefined}
                    required
                  />
                </div>
                <div className="shift-meta">
                  <div className="cat-examples__title">الوردية والفرع والجهاز</div>
                  <div className="shift-facts">
                    <div>
                      <span className="shift-facts__k">الفرع</span>
                      <span className="shift-facts__v">{ctx?.branchName || "—"}</span>
                    </div>
                    <div>
                      <span className="shift-facts__k">الجهاز</span>
                      <span className="shift-facts__v">{ctx?.deviceName || "—"}</span>
                    </div>
                    <div>
                      <span className="shift-facts__k">المسؤول</span>
                      <span className="shift-facts__v">
                        {ctx?.userName || "—"}
                        {ctx?.roleName ? ` (${ctx.roleName})` : ""}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="cat-saving__note">
                  المعدود يطابق ما تركته الوردية السابقة. لو اختلف فليس خطأً يمنع الفتح — يُسجَّل
                  الفارق باسم من عدّ ويُراجَع في SHIFT-05، والبيع يبدأ الآن.
                </p>
                <div className="cat-form__actions">
                  <Button
                    onClick={() => void open()}
                    loading={busy}
                    financial
                    disabledReason={
                      !ctx?.deviceId ? "الجهاز غير مهيّأ — جهّز الجهاز أولاً" : undefined
                    }
                  >
                    افتح الوردية وابدأ البيع
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
