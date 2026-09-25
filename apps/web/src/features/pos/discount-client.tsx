"use client";

import {
  type CartDiscount,
  type CartDraft,
  cartTotals,
  checkDiscount,
  type DiscountCaps,
  type DiscountCheck,
  readCartDraft,
  requestDiscountOverride,
  writeCartDraft,
} from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, TextField } from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { PosNav } from "./pos-nav";

type State = "ready" | "validation_error" | "permission_denied";

/** سقوف افتراضية حين لم يقل الخادم شيئاً بعد (كاشير — G-09 مؤقتاً). */
const DEFAULT_CAPS: DiscountCaps = {
  per_op_minor: "1000",
  daily_minor: "5000",
  percent: 10,
  used_today_minor: "0",
};

/** «8.00» ↔ 800 بالوحدة الصغرى؛ الأرقام العربية تُقبل. */
function parseAmount(text: string): string | null {
  const t = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("٫", ".");
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(t);
  if (!m) return null;
  return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"))).toString();
}

/**
 * POS-03 — خصم وتجاوز سعر (03-D2 ready/permission_denied · 42-D34 validation_error): حدّ التفويض
 * وسبب وهوية المنفّذ. سقف الدور معلن قبل الكتابة؛ ما يتجاوزه لا يُرفض صامتاً بل يُعرض الحدّ والفارق
 * والمسار: «طلب اعتماد من مدير الفرع» حدثُ تجاوز يُنسب للكاشير ويُراجع عند الاتصال (§٧.٤)، أو
 * «تخفيض الخصم» إلى الحدّ. الفاتورة محفوظة في السلة ولن تُفقد.
 */
export function DiscountClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [mode, setMode] = useState<CartDiscount["mode"]>("amount");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<DiscountCheck | null>(null);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const opIds = useRef({ operationId: "", requestId: "" });
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpos%2Fdiscount");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [d, c] = await Promise.all([readCartDraft(storage), readShiftContext(storage, app)]);
      setDraft(d);
      setCtx(c);
      if (d.discount) {
        setMode(d.discount.mode);
        setValue(
          d.discount.mode === "amount" ? formatMinor(d.discount.value, 2, false) : d.discount.value,
        );
        setReason(d.discount.reason);
      }
    })();
  }, [router]);

  const caps = ctx?.discountCaps ?? DEFAULT_CAPS;
  const totals = draft ? cartTotals(draft.lines) : null;
  const subtotal = totals?.subtotalMinor ?? 0n;
  const unlimited = caps.per_op_minor === "0" && caps.daily_minor === "0" && caps.percent === 0;

  const current = (): CartDiscount | null => {
    const raw =
      mode === "amount"
        ? parseAmount(value)
        : /^(0|[1-9][0-9]*)$/.test(value.trim()) && Number(value) <= 100
          ? value.trim()
          : null;
    return raw === null ? null : { mode, value: raw, reason: reason.trim() };
  };

  const apply = async () => {
    const d = current();
    if (!draft || !d) {
      setCheck({ ok: false, reason: "invalid", cap: "", minor: 0n });
      return;
    }
    const result = checkDiscount(d, caps, subtotal);
    setCheck(result);
    if (!result.ok) return;
    await writeCartDraft(getStorage(), { ...draft, discount: d });
    router.push("/pos");
  };

  const reduce = async () => {
    if (!check || check.ok || !draft) return;
    const capped: CartDiscount = { mode, value: check.cap, reason: reason.trim() };
    await writeCartDraft(getStorage(), { ...draft, discount: capped });
    router.push("/pos");
  };

  const requestApproval = async () => {
    const d = current();
    if (!d || !check || check.ok || busy) return;
    setBusy(true);
    try {
      if (!opIds.current.operationId)
        opIds.current = { operationId: crypto.randomUUID(), requestId: crypto.randomUUID() };
      await requestDiscountOverride(getStorage(), {
        ...opIds.current,
        branchId: ctx?.branchId ?? appRef.current.session.branchId ?? "",
        discount: d,
        cap: check.cap,
        cartTotalMinor: subtotal.toString(),
        occurredAt: new Date().toISOString(),
      });
      setRequested(true);
      if (online) void pushPending();
    } finally {
      setBusy(false);
    }
  };

  const state: State =
    check && !check.ok
      ? check.reason === "over_op" || check.reason === "over_daily"
        ? "permission_denied"
        : "validation_error"
      : "ready";
  const capText = check && !check.ok ? check.cap : "";
  // «٪» حرف عربي — خارج mono دائماً
  const capShown =
    mode === "amount" ? (
      <span className="sting-mono">{formatMinor(capText || "0")}</span>
    ) : (
      <>
        <span className="sting-mono">{capText}</span>٪
      </>
    );
  const requestedValue =
    mode === "amount" ? (
      <span className="sting-mono">{formatMinor(parseAmount(value) ?? "0")}</span>
    ) : (
      <>
        <span className="sting-mono">{value}</span>٪
      </>
    );

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="pos" canSeeReports={ctx?.roleName === "مالك"} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-03" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">خصم على الفاتورة</h2>
            {totals ? (
              <span className="cat-head__hint">
                الإجمالي <span className="sting-mono">{formatMinor(subtotal.toString())}</span>
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {draft && draft.lines.length === 0 ? (
              <Notice
                kind="empty"
                title="السلة فارغة"
                action={<Button onClick={() => router.push("/pos")}>نقطة البيع</Button>}
              >
                <p className="acc-lead">فاتورة جديدة — لم تُحفظ</p>
              </Notice>
            ) : null}

            <div className="pos-chips" role="group" aria-label="نوع الخصم">
              {(
                [
                  ["amount", "مبلغ"],
                  ["percent", "نسبة"],
                ] as const
              ).map(([m, t]) => (
                <button
                  key={m}
                  type="button"
                  className={`pos-chip${mode === m ? " pos-chip--on" : ""}`}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setCheck(null);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="cat-price__field">
              <TextField
                label="قيمة الخصم"
                mono
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setCheck(null);
                }}
                error={
                  check && !check.ok && check.reason === "invalid"
                    ? "اكتب مبلغاً موجباً بأرقام لاتينية."
                    : undefined
                }
                required
              />
            </div>
            <TextField
              label="السبب — إلزامي"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />

            {state === "permission_denied" && check && !check.ok ? (
              <Notice
                kind="locked"
                title={check.reason === "over_op" ? "يتجاوز حدّك للعملية" : "يتجاوز حدّك اليومي"}
              >
                <p className="acc-lead">
                  {check.reason === "over_op" ? (
                    <>
                      حدّك {capShown} والمطلوب {requestedValue}.
                    </>
                  ) : (
                    <>
                      حدّك <span className="sting-mono">{formatMinor(check.cap)}</span> يومياً
                      والمستخدَم اليوم{" "}
                      <span className="sting-mono">{formatMinor(caps.used_today_minor)}</span>.
                    </>
                  )}{" "}
                  يحتاج اعتماد مدير الفرع أو المالك. الفاتورة محفوظة في السلة ولن تُفقد.
                </p>
              </Notice>
            ) : null}

            {state === "validation_error" &&
            check &&
            !check.ok &&
            check.reason === "over_percent" ? (
              <Notice kind="error" title="خصم يتجاوز سقف الدور">
                <p className="acc-lead">
                  سقفك <span className="sting-mono">{check.cap}</span>٪ — يحتاج هذا الخصم تفويض مدير
                  الفرع
                </p>
              </Notice>
            ) : null}

            {requested ? (
              <Notice kind="info" title="طلب اعتماد من مدير الفرع">
                <p className="acc-lead">طلب تفويضٍ يسجَّل باسم من وافق.</p>
              </Notice>
            ) : null}

            {!unlimited ? (
              <p className="cat-saving__note">
                حدّك كـ<strong>{ctx?.roleName || "كاشير"}</strong>:{" "}
                <span className="sting-mono">{formatMinor(caps.per_op_minor)}</span> للعملية ·{" "}
                <span className="sting-mono">{formatMinor(caps.daily_minor)}</span> يومياً.
                المستخدَم اليوم{" "}
                <span className="sting-mono">{formatMinor(caps.used_today_minor)}</span>.
                <br />
                القيم تجريبية — تُضبط في مصفوفة الأدوار.
              </p>
            ) : null}

            <div className="cat-form__actions">
              {check && !check.ok && check.reason !== "invalid" ? (
                <>
                  <Button
                    financial
                    onClick={() => void requestApproval()}
                    loading={busy}
                    disabledReason={
                      requested
                        ? "طلب تفويضٍ يسجَّل باسم من وافق"
                        : !reason.trim()
                          ? "السبب — إلزامي"
                          : undefined
                    }
                  >
                    طلب اعتماد من مدير الفرع
                  </Button>
                  <Button variant="secondary" onClick={() => void reduce()}>
                    تخفيض الخصم إلى {capShown}
                  </Button>
                </>
              ) : (
                <Button
                  financial
                  onClick={() => void apply()}
                  disabledReason={
                    !draft?.lines.length
                      ? "السلة فارغة"
                      : !reason.trim()
                        ? "السبب — إلزامي"
                        : undefined
                  }
                >
                  تطبيق الخصم
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}
