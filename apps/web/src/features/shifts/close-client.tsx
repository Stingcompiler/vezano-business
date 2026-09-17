"use client";

import { varianceMinor } from "@sting/domain";
import {
  closeShiftLocally,
  type ClosedShift,
  type LocalShift,
  readOpenShift,
  readShiftCash,
  readSaleCashRows,
} from "@sting/sync-core";
import { Button, formatMinor, Frame, Notice, SyncIndicator, TextField } from "@sting/ui-web";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/shifts/shifts.css";
import { AppNav } from "@/features/home/app-nav";
import { hhmm } from "@/features/home/format";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { type ShiftContext, readShiftContext } from "./context";

type State = "ready" | "validation_error" | "partial" | "saved_local" | "success";

/** فئات النقد (الجنيه السوداني) كما في الإطار 33-D25 — بالوحدة الصغرى. */
const FACES = ["50000", "10000", "5000", "1000", "500", "100"] as const;
const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** بطاقة معلّقة الكشف (POS/المزوّد يكتبها) — الإقفال نصفه جاهز (partial). */
interface PendingCard {
  readonly count: number;
  readonly amount_minor: string;
}

/**
 * SHIFT-04 — إغلاق وعدّ الصندوق (33-D25): العدّ يسبق الرقم. المتوقَّع محجوب حتى يُدخل المعدود — لا
 * يُحسب ولا يُطلب من الخادم قبل تأكيد العدّ (DOM والشبكة معاً). الفراغ ليس صفراً: كل فئة تحتاج
 * إدخالاً صريحاً. الإقفال حدث ثابت بلقطة `expected_cash_at_close`؛ الشهادة وقائع لا تحتاج شبكة.
 */
export function CloseShiftClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [emptyFaces, setEmptyFaces] = useState<readonly string[]>([]);
  const [closed, setClosed] = useState<ClosedShift | null>(null);
  const [synced, setSynced] = useState(false);
  const [pendingCard, setPendingCard] = useState<PendingCard | null>(null);
  const [busy, setBusy] = useState(false);
  const opIds = useRef({ operationId: "", countId: "", closeId: "" });
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fshifts%2Fclose");
      return;
    }
    if (!opIds.current.operationId)
      opIds.current = {
        operationId: crypto.randomUUID(),
        countId: crypto.randomUUID(),
        closeId: crypto.randomUUID(),
      };
    void (async () => {
      const storage = getStorage();
      const s = await readOpenShift(storage);
      setShift(s);
      setCtx(await readShiftContext(storage, app));
    })();
  }, [app.tokens, app.expired, router]);

  useEffect(() => {
    if (shift === null) router.replace("/shifts/open");
  }, [router, shift]);

  const parsedCounts = FACES.map((face) => {
    const raw = (counts[face] ?? "")
      .trim()
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const n = /^\d+$/.test(raw) ? Number(raw) : null;
    return { face, n, sum: n === null ? null : BigInt(face) * BigInt(n) };
  });
  const allFilled = parsedCounts.every((c) => c.n !== null);
  const countedMinor = allFilled
    ? parsedCounts.reduce((acc, c) => acc + (c.sum ?? 0n), 0n).toString()
    : null;

  const confirm = async () => {
    if (busy || !shift || !ctx) return;
    const empty = parsedCounts.filter((c) => c.n === null).map((c) => c.face);
    if (empty.length) {
      setEmptyFaces(empty);
      inputs.current[empty[0]!]?.focus();
      return;
    }
    setBusy(true);
    setEmptyFaces([]);
    try {
      const storage = getStorage();
      // المتوقَّع يُحسب الآن فقط — بعد تأكيد العدّ — من بيانات الجهاز (لقطة ثابتة)
      const cash = await readShiftCash(storage, shift, await readSaleCashRows(storage, shift.id));
      const now = new Date().toISOString();
      const { shift: done } = await closeShiftLocally(storage, {
        operationId: opIds.current.operationId,
        countId: opIds.current.countId,
        closeId: opIds.current.closeId,
        shift,
        countedCashMinor: countedMinor!,
        denominations: parsedCounts.map((c) => ({ face_minor: c.face, count: c.n ?? 0 })),
        expectedCashAtCloseMinor: cash.expectedCashMinor.toString(),
        actorUserId: ctx.userId,
        actorName: ctx.userName,
        occurredAt: now,
      });
      setClosed(done as ClosedShift);
      const card = await storage.read((tx) =>
        tx.getProjection(`entity:shifts.PendingCard:${shift.id}`),
      );
      if (card) setPendingCard(card.value as unknown as PendingCard);
      if (online && app.tokens) {
        const out = await pushPending();
        if (out.kind === "applied" || out.kind === "idle") {
          const op = await storage.read((tx) => tx.getOperation(opIds.current.operationId));
          setSynced(op?.state === "synced");
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const state: State = closed
    ? pendingCard
      ? "partial"
      : synced
        ? "success"
        : "saved_local"
    : emptyFaces.length
      ? "validation_error"
      : "ready";

  const variance = closed
    ? varianceMinor(
        closed.count_status === "counted" ? BigInt(closed.counted_cash_minor) : null,
        BigInt(closed.expected_cash_at_close_minor),
      )
    : null;
  const closedAt = closed ? new Date(closed.closed_at) : null;

  return (
    <Frame title="الورديات" nav={<AppNav currentId="home" />} footer={null}>
      <div className="home" data-screen="SHIFT-04" data-state={state}>
        <div className="cat-table">
          <div className="cat-head">
            <h2 className="cat-head__title">
              {closed
                ? "أُقفلت الوردية"
                : shift
                  ? `عدّ صندوق وردية ${shift.user_name}`
                  : "عدّ الصندوق"}
            </h2>
          </div>
          <div className="acc-card__body">
            {state === "validation_error" ? (
              <Notice kind="error" title="عدٌّ غير مكتمل">
                <p className="acc-lead">
                  <span className="sting-mono">{emptyFaces.length}</span> فئات تُركت فارغة والإقفال
                  مطلوب. الفراغ ليس صفراً: «لم أعدّ» تختلف عن «عددتُ فوجدتُ صفراً».
                </p>
                <p className="acc-lead">
                  <strong>نفرّق بينهما</strong> · كل فئة تحتاج إدخالاً صريحاً ولو كان صفراً. الحقل
                  الفارغ يُعلَّم ولا يُحسب صفراً بالنيابة.
                </p>
                <p className="acc-lead">
                  <strong>لا نجمع الناقص</strong> · لا نعرض «المعدود» ما دامت فئة بلا إدخال — مجموعٌ
                  ناقص يُقرأ كاملاً ويُبنى عليه الفارق.
                </p>
              </Notice>
            ) : null}

            {!closed && shift ? (
              <>
                <div className="shift-denoms">
                  <div className="shift-denoms__head">
                    <span>عدّ الفئات</span>
                    <span>العدد × الفئة</span>
                  </div>
                  {parsedCounts.map((c) => (
                    <div key={c.face} className="shift-denom" data-face={c.face}>
                      <span className="sting-mono shift-denom__face">
                        {formatMinor(c.face, 2, false).replace(/\.00$/, "")}
                      </span>
                      <TextField
                        ref={(el) => {
                          inputs.current[c.face] = el;
                        }}
                        label={`عدد فئة ${formatMinor(c.face, 2, false).replace(/\.00$/, "")}`}
                        mono
                        value={counts[c.face] ?? ""}
                        onChange={(e) =>
                          setCounts((prev) => ({ ...prev, [c.face]: e.target.value }))
                        }
                        error={emptyFaces.includes(c.face) ? "لم أعدّ" : undefined}
                        disabledReason={busy ? "جارٍ الحفظ" : undefined}
                        required
                      />
                      <span className="sting-mono shift-denom__sum">
                        {c.sum === null ? "—" : formatMinor(c.sum)}
                      </span>
                    </div>
                  ))}
                  <div className="shift-denoms__total">
                    <span>المعدود</span>
                    <span className="sting-mono">
                      {countedMinor === null ? "—" : formatMinor(countedMinor)}
                    </span>
                  </div>
                </div>
                <div className="shift-hidden">
                  <strong>المتوقَّع محجوب.</strong> يظهر بعد تأكيد العدّ، ومعه الفارق. الترتيب هو
                  الضمانة — لا رسالة تحذير ولا سياسة مكتوبة.
                </div>
                <div className="cat-form__actions">
                  <Button onClick={() => void confirm()} loading={busy} financial>
                    أكّد العدّ واعرض الفارق
                  </Button>
                </div>
              </>
            ) : null}

            {closed ? (
              <>
                {state === "saved_local" ? (
                  <Notice kind="offline" title="العدّ محفوظ بلا اتصال">
                    <p className="acc-lead">
                      المتوقَّع محسوب محلياً — قد تنقصه مبيعات أجهزة أخرى. الفارق المعروض احتمال لا
                      حكم.
                    </p>
                    <p className="acc-lead">
                      <strong>الشهادة</strong> · تُحفظ بالعدّ وبوقته وباسم من عدّ. هذه وقائع لا
                      تحتاج شبكة، والفارق وحده هو المؤجَّل.
                    </p>
                  </Notice>
                ) : null}
                {state === "partial" && pendingCard ? (
                  <Notice kind="warning" title="النقد عُدّ والبطاقة لم تُسوَّ">
                    <p className="acc-lead">
                      <strong>نُقفل النقد</strong> · شهادة عدّ النقد تُسجَّل الآن باسم من عدّ.
                    </p>
                    <p className="acc-lead">
                      <strong>نُبقي البطاقة</strong> · بند مفتوح موسوم «بانتظار كشف المزوّد»:{" "}
                      <span className="sting-mono">{pendingCard.count}</span> حركة بمبلغ{" "}
                      <span className="sting-mono">{formatMinor(pendingCard.amount_minor)}</span>،
                      ويُسوّى في SHIFT-05 حين يصل. الوردية «مقفلة نقداً · بطاقة معلّقة».
                    </p>
                  </Notice>
                ) : null}
                <div className="cat-counters">
                  <div className="cat-counter">
                    <div className="cat-counter__k">المعدود</div>
                    <div className="cat-counter__v sting-mono">
                      {closed.count_status === "counted"
                        ? formatMinor(closed.counted_cash_minor)
                        : "—"}
                    </div>
                  </div>
                  <div className="cat-counter">
                    <div className="cat-counter__k">المتوقَّع</div>
                    <div className="cat-counter__v sting-mono">
                      {formatMinor(closed.expected_cash_at_close_minor)}
                    </div>
                  </div>
                  <div
                    className={`cat-counter${variance !== null && variance !== 0n ? " cat-counter--bad" : ""}`}
                  >
                    <div className="cat-counter__k">الفارق</div>
                    <div className="cat-counter__v sting-mono">
                      {variance === null ? "—" : formatMinor(variance)}
                    </div>
                  </div>
                </div>
                <p className="cat-saving__note">
                  {variance === null ? (
                    <strong>بلا عدّ — الفارق غير معروف.</strong>
                  ) : variance === 0n ? (
                    <strong>مطابقة.</strong>
                  ) : (
                    <>
                      <strong>
                        فارق{" "}
                        <span className="sting-mono">
                          {formatMinor(variance < 0n ? -variance : variance)}
                        </span>{" "}
                        {variance < 0n ? "نقصاً" : "زيادةً"}.
                      </strong>{" "}
                      يُسجَّل باسم الوردية لا باسم {closed.counted_by_name} شخصياً، ولا يُطالَب به
                      تلقائياً. الفارق واقعةٌ تُراجَع في SHIFT-05، والمطالبة قرار إنسان لا نتيجة
                      حساب.
                    </>
                  )}
                </p>
                <div className="shift-meta">
                  <div className="cat-examples__title">شهادة العدّ</div>
                  <div className="shift-facts shift-certificate">
                    <div>
                      <span className="shift-facts__k">عدَّ</span>
                      <span className="shift-facts__v">
                        {closed.counted_by_name}
                        {ctx?.roleName ? ` — ${ctx.roleName}` : ""}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">الوقت</span>
                      <span className="shift-facts__v">
                        {closedAt ? (
                          <>
                            <span className="sting-mono">{hhmm(closed.closed_at)}</span> ·{" "}
                            <span className="sting-mono">{closedAt.getDate()}</span>{" "}
                            {MONTHS[closedAt.getMonth()]}
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div>
                      <span className="shift-facts__k">الصيغة</span>
                      <span className="shift-facts__v">
                        {closed.count_status === "counted"
                          ? "مقفلة بشهادة الكاشير"
                          : "مقفلة بلا عدّ"}
                      </span>
                    </div>
                  </div>
                </div>
                <SyncIndicator
                  state={synced ? "synced" : !online ? "offline" : "pending_sync"}
                  lastServerAt={synced ? hhmm(closed.closed_at) : null}
                  pendingCount={synced ? 0 : 1}
                  pendingLabel={(n) => (n === 1 ? "عملية واحدة معلّقة" : `${n} عمليات معلّقة`)}
                />
                <div className="cat-form__actions">
                  <Button variant="secondary" onClick={() => window.print()}>
                    اطبع الشهادة
                  </Button>
                  <Link href="/shifts/open" className="c-btn c-btn--primary">
                    افتح وردية جديدة
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Frame>
  );
}
