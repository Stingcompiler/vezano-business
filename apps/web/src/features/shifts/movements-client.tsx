"use client";

import {
  type CashMovementKind,
  type LocalCashMovement,
  type LocalShift,
  readMovements,
  readOpenShift,
  readShiftCash,
  saveCashMovement,
  type ShiftCash,
  type DiscountCaps,
  readSaleCashRows,
} from "@sting/sync-core";
import {
  Button,
  formatMinor,
  Frame,
  Notice,
  parseMoneyInput,
  Table,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/shifts/shifts.css";
import { AppNav } from "@/features/home/app-nav";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { type ShiftContext, readShiftContext, storeShiftContext } from "./context";

type State = "ready" | "validation_error" | "permission_denied" | "success";

/** أنواع الحركة كما في الإطار: إيداع / سحب / مصروف. */
const KINDS: readonly { readonly k: CashMovementKind; readonly t: string }[] = [
  { k: "deposit", t: "إيداع" },
  { k: "withdrawal", t: "سحب" },
  { k: "expense", t: "مصروف" },
];
const KIND_TEXT: Record<CashMovementKind, string> = {
  deposit: "إيداع",
  withdrawal: "سحب",
  expense: "مصروف",
};

interface FieldErr {
  readonly field: "amount" | "reason";
  readonly label: string;
  readonly text: string;
}

/** «سالم · 2:40 م» — الوقت بأرقام لاتينية في mono. */
function WhoWhen({ who, iso }: { who: string; iso: string }) {
  const d = new Date(iso);
  const h = d.getHours();
  return (
    <>
      {who} ·{" "}
      <span className="sting-mono">
        {String(h % 12 === 0 ? 12 : h % 12)}:{String(d.getMinutes()).padStart(2, "0")}
      </span>{" "}
      {h < 12 ? "ص" : "م"}
    </>
  );
}

/** «منذ 4 س» — الساعات بأرقام لاتينية. */
function since(iso: string): { n: number; unit: "س" | "د" } {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins >= 60 ? { n: Math.floor(mins / 60), unit: "س" } : { n: mins, unit: "د" };
}

/**
 * SHIFT-03 — حركة صندوق وتسوية (31-D23): الصندوق دفتر لا درج. كل حركة خارج البيع لها سبب مكتوب واسم
 * من نفّذها ووقتها؛ لا تُحذف ولا تُعدَّل — تُعكَس بحركة مضادّة تشير إليها. الإيداع والمصروف للكاشير،
 * والسحب للمالك وحده (يُخرج النقد من دورة المحل). الحفظ محلي ثم رفع فوري عند الاتصال.
 */
export function MovementsClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [cash, setCash] = useState<ShiftCash | null>(null);
  const [movements, setMovements] = useState<LocalCashMovement[]>([]);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [kind, setKind] = useState<CashMovementKind>("expense");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErr[]>([]);
  const [denied, setDenied] = useState(false);
  const [requested, setRequested] = useState(false);
  const [saved, setSaved] = useState<LocalCashMovement | null>(null);
  const [busy, setBusy] = useState(false);
  const opIds = useRef({ movementId: "", operationId: "" });
  const reasonRef = useRef<HTMLInputElement>(null);
  const appRef = useRef(app);
  appRef.current = app;

  const reload = useCallback(async (s: LocalShift) => {
    const storage = getStorage();
    setCash(await readShiftCash(storage, s, await readSaleCashRows(storage, s.id)));
    setMovements(await readMovements(storage, s.id));
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fshifts%2Fmovements");
      return;
    }
    if (!opIds.current.movementId)
      opIds.current = { movementId: crypto.randomUUID(), operationId: crypto.randomUUID() };
    void (async () => {
      const storage = getStorage();
      const s = await readOpenShift(storage);
      setShift(s);
      const local = await readShiftContext(storage, app);
      setCtx(local);
      if (!s) return;
      await reload(s);
      if (!online || !app.tokens) return;
      try {
        const { data, response } = await api().GET("/api/shifts/current", {
          params: { query: { branch_id: s.branch_id } },
        });
        if (!response.ok || !data) return;
        const d = data as unknown as {
          role_name: string;
          can_withdraw: boolean;
          owner_name: string;
          role_code?: string;
          discount_caps?: DiscountCaps;
          branch_code?: string;
          user_name: string;
        };
        const fresh: ShiftContext = {
          branchId: s.branch_id,
          branchName: s.branch_name,
          deviceId: s.device_id,
          deviceName: s.device_name,
          userId: app.session.userId ?? local?.userId ?? "",
          userName: d.user_name || app.session.displayName || local?.userName || "",
          roleName: d.role_name,
          canWithdraw: d.can_withdraw,
          ownerName: d.owner_name,
          roleCode: d.role_code,
          discountCaps: d.discount_caps,
          branchCode: d.branch_code || local?.branchCode,
          devicePrefix: local?.devicePrefix,
        };
        await storeShiftContext(storage, fresh);
        setCtx(fresh);
      } catch {
        /* بلا اتصال فعلي: السياق المحلي يكفي */
      }
    })();
  }, [app.tokens, app.expired, online, reload, router]);

  useEffect(() => {
    if (shift === null) router.replace("/shifts/open");
  }, [router, shift]);

  const canWithdraw = ctx?.canWithdraw ?? false;
  const balance = cash?.expectedCashMinor ?? 0n;

  const validate = (): FieldErr[] => {
    const errs: FieldErr[] = [];
    const minor = parseMoneyInput(amount);
    if (!amount.trim() || minor === null || BigInt(minor) <= 0n) {
      errs.push({ field: "amount", label: "المبلغ", text: "اكتب مبلغاً موجباً بأرقام لاتينية." });
    } else if (kind !== "deposit" && BigInt(minor) > balance) {
      const over = formatMinor(BigInt(minor) - balance);
      errs.push({
        field: "amount",
        label: "المبلغ",
        text: `السحب يتجاوز الرصيد بـ${over}. الصندوق لا يصير سالباً بحركة يدوية — وإن كان فيه نقص فهو فرقُ عدّ يُراجَع في SHIFT-05، لا سحبٌ يُسجَّل هنا.`,
      });
    }
    const words = reason.trim().split(/\s+/).filter(Boolean);
    const kindNames = KINDS.map((k) => k.t);
    if (words.length < 2 || (words.length === 1 && kindNames.includes(words[0]!))) {
      const said = reason.trim() || KIND_TEXT[kind];
      errs.push({
        field: "reason",
        label: "السبب",
        text: `«${said}» يعيد اسم النوع ولا يقول شيئاً. من يقرأ التقرير بعد شهر يحتاج: على ماذا، ولمن، وبأيّ إيصال.`,
      });
    }
    return errs;
  };

  const record = async (reverses?: LocalCashMovement) => {
    if (busy || !shift || !ctx) return;
    const errs = reverses ? [] : validate();
    if (errs.length) {
      setErrors(errs);
      setSaved(null);
      // المبلغ يبقى كما كُتب والمؤشّر يذهب إلى السبب
      if (errs.some((e) => e.field === "reason")) reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const now = new Date().toISOString();
      const ids = reverses
        ? { movementId: crypto.randomUUID(), operationId: crypto.randomUUID() }
        : opIds.current;
      const { movement } = await saveCashMovement(getStorage(), {
        movementId: ids.movementId,
        operationId: ids.operationId,
        shift,
        kind: reverses ? reverses.kind : kind,
        amountMinor: reverses
          ? (BigInt(reverses.signed_amount_minor) < 0n
              ? -BigInt(reverses.signed_amount_minor)
              : BigInt(reverses.signed_amount_minor)
            ).toString()
          : parseMoneyInput(amount)!,
        reason: reverses ? `عكس ${KIND_TEXT[reverses.kind]} ${reverses.number}` : reason.trim(),
        actorUserId: ctx.userId,
        actorName: ctx.userName,
        reversesMovementId: reverses?.id,
        occurredAt: now,
      });
      opIds.current = { movementId: crypto.randomUUID(), operationId: crypto.randomUUID() };
      setSaved(movement);
      setAmount("");
      setReason("");
      await reload(shift);
      if (online && app.tokens) await pushPending();
    } finally {
      setBusy(false);
    }
  };

  const requestFromOwner = async () => {
    if (busy || !shift) return;
    const minor = parseMoneyInput(amount);
    if (!minor || BigInt(minor) <= 0n || !reason.trim()) {
      setErrors(validate());
      return;
    }
    setBusy(true);
    try {
      const { response } = await api().POST("/api/shifts/{shift_id}/requests", {
        params: { path: { shift_id: shift.id } },
        body: { kind: "withdrawal", amount_minor: minor, reason: reason.trim() },
      });
      if (response.ok) setRequested(true);
    } finally {
      setBusy(false);
    }
  };

  const state: State = saved
    ? "success"
    : errors.length
      ? "validation_error"
      : denied
        ? "permission_denied"
        : "ready";
  const reversedIds = new Set(movements.map((m) => m.reverses_movement_id).filter(Boolean));
  const byId = new Map(movements.map((m) => [m.id, m]));
  const errorFor = (f: FieldErr["field"]) => errors.find((e) => e.field === f)?.text;
  const sinceOpen = shift ? since(shift.opened_at) : null;

  interface Row {
    readonly id: string;
    readonly kind: string;
    readonly why: string;
    readonly amount: string;
    readonly who: string;
    readonly when: string;
    readonly reversed: boolean;
    readonly reversal: boolean;
    readonly source: LocalCashMovement | null;
  }
  const rows: Row[] = shift
    ? [
        ...movements.map((m) => {
          const original = m.reverses_movement_id ? byId.get(m.reverses_movement_id) : undefined;
          const reversedBy = movements.find((x) => x.reverses_movement_id === m.id);
          return {
            id: m.id,
            kind: original
              ? `عكس ${KIND_TEXT[original.kind]} ${original.number}`
              : reversedBy
                ? `${KIND_TEXT[m.kind]} — معكوس`
                : KIND_TEXT[m.kind],
            why: reversedBy ? `${m.reason} · عُكس بحركة ${reversedBy.number}` : m.reason,
            amount: m.signed_amount_minor,
            who: m.actor_name,
            when: m.occurred_at,
            reversed: Boolean(reversedBy),
            reversal: Boolean(original),
            source: m,
          };
        }),
        {
          id: "opening",
          kind: "إيداع افتتاحي",
          why: "عهدة بداية الوردية",
          amount: shift.opening_float_minor,
          who: shift.user_name,
          when: shift.opened_at,
          reversed: false,
          reversal: false,
          source: null,
        },
      ].sort((a, b) => b.when.localeCompare(a.when))
    : [];

  const columns = [
    {
      key: "kind",
      header: "الحركة والسبب",
      render: (r: Row) => (
        <div className={r.reversed ? "shift-row--reversed" : undefined}>
          <div className="shift-row__kind">{r.kind}</div>
          <div className="acc-choice__note">{r.why}</div>
          {r.source && !r.reversed && !r.reversal ? (
            <Button
              variant="secondary"
              onClick={() => void record(r.source!)}
              disabledReason={busy ? "جارٍ الحفظ" : undefined}
            >
              اعكس هذه الحركة
            </Button>
          ) : null}
        </div>
      ),
    },
    {
      key: "amount",
      header: "المبلغ",
      mono: true,
      render: (r: Row) => (BigInt(r.amount) >= 0n ? "+" : "") + formatMinor(r.amount),
    },
    {
      key: "who",
      header: "من ومتى",
      render: (r: Row) => <WhoWhen who={r.who} iso={r.when} />,
    },
  ];

  return (
    <Frame title="الورديات" nav={<AppNav currentId="home" />} footer={null}>
      <div className="home" data-screen="SHIFT-03" data-state={state}>
        <div className="shift-two">
          <div className="cat-table">
            <div className="cat-head">
              <h2 className="cat-head__title">حركة صندوق</h2>
            </div>
            <div className="acc-card__body">
              {shift && cash ? (
                <div className="shift-head">
                  <div>
                    <div className="shift-prev__k">الرصيد الحالي</div>
                    <div className="shift-expected__v sting-mono">{formatMinor(balance)}</div>
                  </div>
                  <div>
                    <div className="shift-prev__k">وردية مفتوحة</div>
                    <div className="shift-prev__v">
                      {shift.user_name} · منذ <span className="sting-mono">{sinceOpen?.n}</span>{" "}
                      {sinceOpen?.unit}
                    </div>
                  </div>
                </div>
              ) : null}

              {state === "validation_error" ? (
                <div className="cat-errors" role="alert">
                  <div className="cat-errors__title">
                    {errors.length === 2 ? "خطآن يمنعان التسجيل" : "خطأ يمنع التسجيل"}
                  </div>
                  {errors.map((e) => (
                    <div key={e.field} className="cat-error">
                      <div className="cat-error__head">
                        <span className="cat-error__field">{e.label}</span>
                      </div>
                      <div className="cat-error__why">{e.text}</div>
                    </div>
                  ))}
                  <p className="cat-errors__foot">
                    المبلغ يبقى كما كُتب والمؤشّر يذهب إلى السبب. لا نمسح رقماً صحيح الصياغة لأن
                    قيمته كبيرة.
                  </p>
                </div>
              ) : null}

              {state === "permission_denied" && ctx ? (
                <Notice
                  kind="locked"
                  title="الكاشير يودع ولا يسحب"
                  action={
                    requested ? null : (
                      <Button onClick={() => void requestFromOwner()} loading={busy}>
                        اطلب من {ctx.ownerName || "المالك"}
                      </Button>
                    )
                  }
                >
                  <p className="acc-lead">
                    الإيداع والمصروف مفتوحان ل{ctx.userName}، والسحب للمالك وحده — لأنه يُخرج النقد
                    من دورة المحل إلى خارجها.
                  </p>
                  <p className="acc-lead">
                    <strong>المخرج الحاضر</strong> · الحركة تُنسب لمن أذن بها لا لمن أدخلها، وكلاهما
                    مذكور في السطر.
                  </p>
                  {requested ? (
                    <p className="acc-lead" role="status">
                      أُرسل الطلب إلى {ctx.ownerName || "المالك"} بالمبلغ والسبب.
                    </p>
                  ) : null}
                </Notice>
              ) : null}

              {state === "success" && saved && cash ? (
                <Notice kind="success" title="سُجّلت الحركة">
                  <p className="acc-lead">
                    {saved.reverses_movement_id ? "عكس" : KIND_TEXT[saved.kind]}{" "}
                    <span className="sting-mono">
                      {formatMinor(
                        BigInt(saved.signed_amount_minor) < 0n
                          ? -BigInt(saved.signed_amount_minor)
                          : BigInt(saved.signed_amount_minor),
                      )}
                    </span>{" "}
                    مسجّل. الرصيد{" "}
                    <span className="sting-mono shift-row__kind">{formatMinor(balance)}</span>،
                    والحركة رقم <span className="sting-mono">{saved.number}</span> باسم{" "}
                    {saved.actor_name} في <WhoWhen who="" iso={saved.occurred_at} />
                  </p>
                </Notice>
              ) : null}

              <div className="shift-kinds" role="group" aria-label="نوع الحركة">
                {KINDS.map((k) => {
                  const locked = k.k === "withdrawal" && !canWithdraw;
                  return (
                    <button
                      key={k.k}
                      type="button"
                      className={`c-btn ${kind === k.k && !locked ? "c-btn--primary" : "c-btn--secondary"}`}
                      aria-pressed={kind === k.k}
                      aria-disabled={locked || undefined}
                      onClick={() => {
                        setSaved(null);
                        setErrors([]);
                        if (locked) {
                          // لا نُخفي الزرّ: يظهر معطّلاً ومعه سببه والمخرج الحاضر
                          setDenied(true);
                          return;
                        }
                        setDenied(false);
                        setKind(k.k);
                      }}
                    >
                      {k.t}
                    </button>
                  );
                })}
              </div>
              {!canWithdraw ? <p className="c-field__hint">السحب للمالك وحده</p> : null}
              <div className="cat-price__field">
                <TextField
                  label="المبلغ"
                  mono
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  error={errorFor("amount")}
                  disabledReason={busy ? "جارٍ الحفظ" : undefined}
                  required
                />
              </div>
              <TextField
                ref={reasonRef}
                label="السبب"
                hint="إلزامي"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                error={errorFor("reason")}
                disabledReason={busy ? "جارٍ الحفظ" : undefined}
                required
              />
              <p className="cat-saving__note">
                تُسجَّل باسم <strong>{ctx?.userName || "—"}</strong> وبوقتها، وتظهر في تسوية الوردية
                بنداً مستقلاً عن البيع. السبب يُقرأ بعد شهر في تقرير المصروفات — فاكتبه لمن يقرأ لا
                لمن يعرف.
              </p>
              <div className="cat-form__actions">
                <Button
                  onClick={() => void record()}
                  loading={busy}
                  financial
                  disabledReason={
                    !shift ? "لا وردية مفتوحة" : denied ? "السحب للمالك وحده" : undefined
                  }
                >
                  سجّل الحركة
                </Button>
              </div>
            </div>
          </div>

          <div className="cat-table">
            <div className="cat-head">
              <h2 className="cat-head__title">حركات الوردية</h2>
              <span className="cat-head__hint">البيع لا يظهر هنا — له سجلّه</span>
            </div>
            <Table
              caption="حركات الوردية"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              loading={shift === undefined ? 3 : undefined}
            />
            {reversedIds.size ? (
              <div className="cat-foot">
                الحركة المعكوسة تبقى ومعها الأصلية مشطوبةً لا محذوفة. من راجع الدفتر بعد شهر يحتاج
                أن يرى أن خطأً وقع وصُحِّح، لا دفتراً نظيفاً لم يقع فيه شيء.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
