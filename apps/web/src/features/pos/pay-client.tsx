"use client";

import { parseUnitFactor, toBaseQtyMilli } from "@sting/domain";
import {
  type CartDraft,
  type CartDraftLine,
  cartTotals,
  type LocalBalance,
  type LocalSale,
  type LocalShift,
  readBalanceMatchedAt,
  readCartDraft,
  readLocalBalances,
  readOpenShift,
  saveSaleLocally,
  writeCartDraft,
} from "@sting/sync-core";
import {
  Button,
  formatMinor,
  formatQty,
  Frame,
  Money,
  Notice,
  SyncIndicator,
  TextField,
} from "@sting/ui-web";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import "@/features/acc/acc.css";
import "@/features/home/home.css";
import "@/features/catalog/catalog.css";
import "@/features/pos/pos.css";
import { hhmm } from "@/features/home/format";
import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { api } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

import { PayMethods } from "./pay-methods";
import { PosNav } from "./pos-nav";

type State = "ready" | "validation_error" | "saving" | "saved_local" | "success";

/** «200.00» ↔ 20000 بالوحدة الصغرى؛ الأرقام العربية تُقبل. */
function parseAmount(text: string): bigint | null {
  const t = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("٫", ".");
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

/** اليوم بتاريخ الأعمال المحلي `YYYY-MM-DD`. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type PriceMode = "operation" | "item" | "skip";

/**
 * POS-05 — الدفع النقدي (03-D2 ready · 14-D9 validation_error · 42-D34 saving/saved_local/success):
 * مستلَم وباقٍ محسوبان محلياً بنفس التقريب (ACC-24)، وخط حفظ البيع في معاملة محلية واحدة (§٣.٢ بند
 * 4)؛ النجاح بعد اكتمال الحفظ لا قبله ولا بعد الطباعة (بند 5). صنف بلا سعر لا يوقف زبوناً واقفاً:
 * يُطلب الرقم ويُسجَّل من أدخله. بيع فوق الرصيد الدفتري يمرّ ويُوسم (ACC-17).
 */
export function PayClient() {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [balances, setBalances] = useState<Map<string, LocalBalance>>(new Map());
  const [matchedAt, setMatchedAt] = useState<string | null>(null);
  const [received, setReceived] = useState("");
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [sale, setSale] = useState<LocalSale | null>(null);
  const [synced, setSynced] = useState(false);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [priceMode, setPriceMode] = useState<Record<string, PriceMode>>({});
  const ids = useRef<{
    operationId: string;
    saleId: string;
    paymentId: string;
    lines: string[];
    movements: string[];
  } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace("/login?next=%2Fpos%2Fpay");
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [d, s, c, b, at] = await Promise.all([
        readCartDraft(storage),
        readOpenShift(storage),
        readShiftContext(storage, app),
        readLocalBalances(storage),
        readBalanceMatchedAt(storage),
      ]);
      setDraft(d);
      setShift(s);
      setCtx(c);
      setBalances(b);
      setMatchedAt(at);
    })();
  }, [router]);

  useEffect(() => {
    // لا سلة ولا بيع: العودة إلى نقطة البيع؛ لا وردية: POS-01 يقول «افتح وردية»
    if (phase === "idle" && draft && draft.lines.length === 0) router.replace("/pos");
    if (shift === null) router.replace("/pos");
  }, [draft, phase, router, shift]);

  const lines = draft?.lines ?? [];
  const unpriced = lines.filter(
    (l) => BigInt(l.unit_price_minor) === 0n && priceMode[l.id] !== "skip",
  );
  const effectiveLines: CartDraftLine[] = lines
    .filter((l) => priceMode[l.id] !== "skip")
    .map((l) => {
      const typed = BigInt(l.unit_price_minor) === 0n ? parseAmount(manual[l.id] ?? "") : null;
      return typed && typed > 0n
        ? { ...l, unit_price_minor: typed.toString(), manual_price: true }
        : l;
    });
  const totals = cartTotals(effectiveLines, draft?.discount);
  const total = totals.totalMinor;
  const receivedMinor = parseAmount(received);
  const change = receivedMinor !== null && receivedMinor >= total ? receivedMinor - total : null;
  const unresolved = unpriced.filter((l) => {
    const v = parseAmount(manual[l.id] ?? "");
    return v === null || v === 0n;
  });
  const overStock = effectiveLines
    .map((l) => {
      const b = balances.get(l.item_id);
      if (!b) return null;
      const base = toBaseQtyMilli(BigInt(l.qty_milli), parseUnitFactor(l.factor_milli, "1000"));
      const have = BigInt(b.qty_milli);
      return base > have ? { line: l, have, need: base, after: have - base } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const state: State =
    phase === "saving"
      ? "saving"
      : phase === "saved"
        ? synced || online
          ? "success"
          : "saved_local"
        : unresolved.length > 0
          ? "validation_error"
          : "ready";

  const save = async () => {
    if (!draft || !shift || !ctx || phase !== "idle") return;
    if (unresolved.length || receivedMinor === null || receivedMinor < total) return;
    setPhase("saving");
    try {
      if (!ids.current)
        ids.current = {
          operationId: crypto.randomUUID(),
          saleId: crypto.randomUUID(),
          paymentId: crypto.randomUUID(),
          lines: effectiveLines.map(() => crypto.randomUUID()),
          movements: effectiveLines.map(() => crypto.randomUUID()),
        };
      const storage = getStorage();
      // الصنف المتخطّى يُحذف من السلة؛ السعر اليدوي يُثبَّت على السطر باسم من أدخله
      await writeCartDraft(storage, { ...draft, lines: effectiveLines });
      const { sale: saved } = await saveSaleLocally(storage, {
        operationId: ids.current.operationId,
        saleId: ids.current.saleId,
        draft: { ...draft, lines: effectiveLines },
        payments: [
          {
            paymentId: ids.current.paymentId,
            method: "cash",
            amountMinor: total.toString(),
            receivedMinor: receivedMinor.toString(),
            changeMinor: (receivedMinor - total).toString(),
          },
        ],
        shift,
        branchCode: ctx.branchCode || "BR",
        devicePrefix: ctx.devicePrefix || "X",
        deviceId: ctx.deviceId,
        userId: ctx.userId,
        userName: ctx.userName,
        businessDate: shift.business_date || today(),
        occurredAt: new Date().toISOString(),
        memberIds: { lines: ids.current.lines, movements: ids.current.movements },
      });
      setSale(saved);
      // «واعتماده سعراً للصنف» — للمالك: سطر سعر في بطاقة الصنف (CAT-04) بعد الحفظ وعند الاتصال
      if (online) {
        for (const l of effectiveLines) {
          if (l.manual_price && priceMode[l.id] === "item" && ctx.roleName === "مالك") {
            try {
              await api().POST("/api/catalog/items/{item_id}/price", {
                params: { path: { item_id: l.item_id } },
                body: { price_minor: l.unit_price_minor, confirm_below_cost: false },
              });
            } catch {
              /* يبقى السعر لهذه العملية؛ البطاقة تُسعَّر لاحقاً */
            }
          }
        }
        // الرفع خطوة لاحقة لا شرط للنجاح (§٣.٢ بند 6)
        try {
          const out = await pushPending();
          setSynced(out.kind === "applied" || out.kind === "idle");
        } catch {
          setSynced(false);
        }
      }
    } finally {
      setPhase("saved");
    }
  };

  const changeShown = change ?? 0n;

  return (
    <Frame
      title="نقطة البيع"
      nav={<PosNav currentId="pos" canSeeReports={ctx?.roleName === "مالك"} />}
      footer={null}
    >
      <div className="pos" data-screen="POS-05" data-state={state}>
        <div className="cat-table pos-card">
          <div className="cat-head">
            <h2 className="cat-head__title">الدفع النقدي</h2>
            {shift ? (
              <span className="cat-head__hint">
                وردية مفتوحة <span className="sting-mono">{hhmm(shift.opened_at)}</span> ·{" "}
                {shift.user_name}
              </span>
            ) : null}
          </div>
          <div className="acc-card__body">
            {phase === "saved" && sale ? (
              <>
                <Notice
                  kind="success"
                  title={state === "success" ? "اكتمل البيع" : "حُفظ على الجهاز"}
                >
                  {state === "success" ? (
                    <p className="acc-lead">
                      <strong>النجاح بعد الحفظ</strong> · لا بعد الطباعة. فشل الطابعة بعده لا يلغي
                      البيع: «أعد الطباعة» تُخرج نسخة بنفس الرقم لا بيعاً جديداً (ACC-84).
                    </p>
                  ) : (
                    <p className="acc-lead">
                      النجاح بلا اتصال يُسمّى باسمه: «محفوظ على هذا الجهاز — يُرفع عند الاتصال».
                    </p>
                  )}
                </Notice>
                <div className="pos-pay__change pos-pay__change--big">
                  <span>الباقي للعميل</span>
                  <Money minor={sale.change_minor || "0"} currency="ج.س" size="title" />
                </div>
                <div className="shift-facts">
                  <div>
                    <span className="shift-facts__k">رقم الفاتورة</span>
                    <span className="shift-facts__v sting-mono">{sale.invoice_number}</span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المطلوب</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(sale.total_minor)}
                    </span>
                  </div>
                  <div>
                    <span className="shift-facts__k">المبلغ المستلم</span>
                    <span className="shift-facts__v sting-mono">
                      {formatMinor(sale.received_minor || sale.total_minor)}
                    </span>
                  </div>
                </div>
                <SyncIndicator
                  state={!online ? "offline" : synced ? "synced" : "pending_sync"}
                  lastServerAt={
                    synced ? hhmm(sale.occurred_at) : matchedAt ? hhmm(matchedAt) : null
                  }
                  pendingCount={synced ? 0 : 1}
                  pendingLabel={(n) =>
                    n === 1 ? "عملية واحدة معلقة من هذا الجهاز" : `${n} عمليات معلقة من هذا الجهاز`
                  }
                />
                <div className="cat-form__actions">
                  <Button onClick={() => router.push("/pos")} pos>
                    نقطة البيع
                  </Button>
                </div>
              </>
            ) : (
              <>
                <PayMethods current="cash" />
                {state === "saving" ? (
                  <Notice kind="info" title="جارٍ الحفظ">
                    <p className="acc-lead">زرّ واحد يُقفل، والطباعة لا تبدأ قبل تمام الحفظ.</p>
                  </Notice>
                ) : null}

                {unpriced.map((l) => (
                  <section key={l.id} className="pos-unpriced" aria-label={l.item_name}>
                    <h3 className="pos-unpriced__title">«{l.item_name}» بلا سعر في بطاقته</h3>
                    <p className="acc-lead">
                      أُضيف الصنف من جرد سابق ولم يُسعَّر. الزبون واقف، والبيع يكمل.
                    </p>
                    <div className="pos-unpriced__field">
                      <TextField
                        label="سعر البيع لهذه العملية"
                        mono
                        inputMode="decimal"
                        value={manual[l.id] ?? ""}
                        onChange={(e) => setManual((m) => ({ ...m, [l.id]: e.target.value }))}
                        hint={`SDG / ال${l.unit_name}`}
                        required
                      />
                    </div>
                    <p className="acc-choice__note">
                      يُسجَّل باسمك ووقته في سجل التدقيق، ويظهر في تقرير «أسعار أُدخلت يدوياً»
                      لمراجعة المالك.
                    </p>
                    <div className="pos-unpriced__modes" role="radiogroup" aria-label="السعر">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={(priceMode[l.id] ?? "operation") === "operation"}
                        className={`pos-unit__option${(priceMode[l.id] ?? "operation") === "operation" ? " pos-unit__option--on" : ""}`}
                        onClick={() => setPriceMode((m) => ({ ...m, [l.id]: "operation" }))}
                      >
                        <span className="pos-unit__name">لهذه العملية فقط</span>
                        <span className="pos-unit__factor">
                          الأسلم افتراضاً: لا يغيّر بطاقة الصنف، والمالك يسعّرها لاحقاً بهدوء
                        </span>
                      </button>
                      <Button
                        variant="secondary"
                        onClick={() => setPriceMode((m) => ({ ...m, [l.id]: "item" }))}
                        disabledReason={
                          ctx?.roleName === "مالك"
                            ? undefined
                            : "يحتاج صلاحية تسعير — الكاشير لا يملكها"
                        }
                        aria-pressed={priceMode[l.id] === "item"}
                      >
                        واعتماده سعراً للصنف
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setPriceMode((m) => ({ ...m, [l.id]: "skip" }))}
                      >
                        تخطي الصنف وإكمال البيع
                      </Button>
                      <span className="acc-choice__note">
                        يُباع الباقي، ويُسجَّل أن صنفاً سقط من العملية لنقص سعر
                      </span>
                    </div>
                    <p className="acc-choice__note">
                      لن نقترح سعراً من متوسط أصناف أخرى ولا من آخر شراء: أي رقم نقترحه سيُقبل
                      بالضغط ويصبح سعرك المعتمد بلا قرار منك.
                    </p>
                  </section>
                ))}

                {overStock.length ? (
                  <Notice kind="warning" title="الكمية المطلوبة تتجاوز الرصيد الدفتري">
                    {overStock.map((o) => (
                      <p key={o.line.id} className="acc-lead">
                        {o.line.item_name}: الدفتر يقول{" "}
                        <span className="sting-mono">
                          {formatQty(o.have, o.line.decimal_places)}
                        </span>{" "}
                        والزبون يطلب{" "}
                        <span className="sting-mono">
                          {formatQty(o.need, o.line.decimal_places)}
                        </span>
                        . البضاعة أمامك — الدفتر هو الذي قد يكون متأخراً.
                      </p>
                    ))}
                    <p className="acc-lead">
                      <strong>البيع يمر.</strong> منع البيع لأجل رصيد دفتري متأخر يخسر زبوناً حاضراً
                      ولا يصحّح الدفتر. يُسجَّل البيع كاملاً، ويُوسم الصنف «رصيد سالب — يحتاج جرداً»
                      في <span className="sting-mono">INV-01</span>
                    </p>
                    <div className="shift-facts">
                      {overStock.map((o) => (
                        <div key={o.line.id}>
                          <span className="shift-facts__k">الرصيد بعد البيع</span>
                          <span className="shift-facts__v sting-mono">
                            {formatQty(o.after, o.line.decimal_places)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="acc-choice__note">
                      يُوسم الصنف «رصيد سالب» في قائمة المخزون بلون تحذير، لا يختفي حتى يُجرد.
                    </p>
                  </Notice>
                ) : null}

                <div className="pos-pay__required">
                  <span>المطلوب</span>
                  <Money minor={total.toString()} currency="ج.س" size="title" />
                </div>
                <div className="cat-price__field">
                  <TextField
                    label="المبلغ المستلم"
                    mono
                    inputMode="decimal"
                    value={received}
                    onChange={(e) => setReceived(e.target.value)}
                    disabledReason={phase !== "idle" ? "جارٍ الحفظ" : undefined}
                    required
                  />
                </div>
                <div className="pos-chips" role="group" aria-label="مبالغ سريعة">
                  {["100", "200", "500"].map((v) => (
                    <button
                      key={v}
                      type="button"
                      className="pos-chip sting-mono"
                      onClick={() => setReceived(`${v}.00`)}
                    >
                      {v}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="pos-chip"
                    onClick={() => setReceived(formatMinor(total.toString(), 2, false))}
                  >
                    مبلغ مضبوط
                  </button>
                </div>
                <div className="pos-pay__change">
                  <span>الباقي للعميل</span>
                  <span className="sting-mono">
                    {change === null ? "—" : formatMinor(changeShown.toString())}
                  </span>
                </div>
                <div className="cat-form__actions">
                  <Button
                    financial
                    pos
                    onClick={() => void save()}
                    loading={phase === "saving"}
                    disabledReason={
                      !lines.length
                        ? "السلة فارغة"
                        : unresolved.length
                          ? "سعر البيع لهذه العملية"
                          : receivedMinor === null || receivedMinor < total
                            ? "المبلغ المستلم"
                            : undefined
                    }
                  >
                    حفظ البيع — <span className="sting-mono">{formatMinor(total.toString())}</span>{" "}
                    ج.س
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}
