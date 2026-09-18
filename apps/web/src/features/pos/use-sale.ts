"use client";

import { parseUnitFactor, toBaseQtyMilli } from "@sting/domain";
import {
  type CartDraft,
  type CartDraftLine,
  cartTotals,
  type LocalBalance,
  type LocalParty,
  type LocalSale,
  type LocalShift,
  readBalanceMatchedAt,
  readCartDraft,
  readLocalBalances,
  readLocalParties,
  readOpenShift,
  readPartyPendingCredit,
  type SalePaymentInput,
  saveSaleLocally,
  writeCartDraft,
} from "@sting/sync-core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { type ShiftContext, readShiftContext } from "@/features/shifts/context";
import { useApp } from "@/lib/app-context";
import { storageLow } from "@/lib/diagnostics";
import { useOnline } from "@/lib/online";
import { getStorage } from "@/lib/storage";
import { pushPending } from "@/lib/sync";

export type SavePhase = "idle" | "saving" | "saved";
export type PushResult = "none" | "synced" | "pending" | "failed";

/** سطر يتجاوز الرصيد الدفتري المعروف — تنبيه لا منع (ACC-17). */
export interface OverStock {
  readonly line: CartDraftLine;
  readonly have: bigint;
  readonly need: bigint;
  readonly after: bigint;
}

/** اليوم بتاريخ الأعمال المحلي `YYYY-MM-DD`. */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** «200.00» ↔ 20000 بالوحدة الصغرى؛ الأرقام العربية تُقبل. */
export function parseAmount(text: string): bigint | null {
  const t = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("٫", ".");
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

/**
 * ما تشترك فيه شاشات الدفع (POS-05/06/07): السلة والوردية والسياق والأرصدة والطرف، وخط الحفظ
 * الواحد (`saveSaleLocally`) بمعرّفات ثابتة لكل شاشة، ثم محاولة الرفع الأولى — النجاح بعد الحفظ
 * المحلي لا بعد الرفع (§٣.٢ بند 5–6).
 */
export function useSale(nextPath: string) {
  const router = useRouter();
  const app = useApp();
  const online = useOnline();
  const [draft, setDraft] = useState<CartDraft | null>(null);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);
  const [ctx, setCtx] = useState<ShiftContext | null>(null);
  const [balances, setBalances] = useState<Map<string, LocalBalance>>(new Map());
  const [matchedAt, setMatchedAt] = useState<string | null>(null);
  const [party, setParty] = useState<LocalParty | null>(null);
  const [pendingCredit, setPendingCredit] = useState<{ pendingMinor: bigint; count: number }>({
    pendingMinor: 0n,
    count: 0,
  });
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [sale, setSale] = useState<LocalSale | null>(null);
  const [push, setPush] = useState<PushResult>("none");
  const ids = useRef<{
    operationId: string;
    saleId: string;
    payments: string[];
    lines: string[];
    movements: string[];
  } | null>(null);
  const appRef = useRef(app);
  appRef.current = app;

  useEffect(() => {
    const app = appRef.current;
    if (!app.tokens && !app.expired) {
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      return;
    }
    void (async () => {
      const storage = getStorage();
      const [d, s, c, b, at, parties] = await Promise.all([
        readCartDraft(storage),
        readOpenShift(storage),
        readShiftContext(storage, app),
        readLocalBalances(storage),
        readBalanceMatchedAt(storage),
        readLocalParties(storage),
      ]);
      setDraft(d);
      setShift(s);
      setCtx(c);
      setBalances(b);
      setMatchedAt(at);
      if (d.customer) {
        setParty(parties.find((p) => p.id === d.customer!.id) ?? null);
        setPendingCredit(await readPartyPendingCredit(storage, d.customer.id));
      }
    })();
  }, [nextPath, router]);

  useEffect(() => {
    if (phase === "idle" && draft && draft.lines.length === 0) router.replace("/pos");
    if (shift === null) router.replace("/pos");
  }, [draft, phase, router, shift]);

  const overStockOf = (lines: readonly CartDraftLine[]): OverStock[] =>
    lines
      .map((l) => {
        const b = balances.get(l.item_id);
        if (!b) return null;
        const base = toBaseQtyMilli(BigInt(l.qty_milli), parseUnitFactor(l.factor_milli, "1000"));
        const have = BigInt(b.qty_milli);
        return base > have ? { line: l, have, need: base, after: have - base } : null;
      })
      .filter((x): x is OverStock => x !== null);

  /** يحفظ البيع بالسطور المعطاة (بعد أي سعر يدوي/تخطٍّ) والدفعات؛ يعيد البيع المحفوظ. */
  const save = async (
    lines: readonly CartDraftLine[],
    payments: readonly Omit<SalePaymentInput, "paymentId">[],
    extraDependencies: readonly string[] = [],
  ): Promise<LocalSale | null> => {
    if (!draft || !shift || !ctx || phase !== "idle") return null;
    // «نمنع قبل الحفظ لا بعده» (SYS-04): مساحة دون الحدّ الآمن → لا نجاح كاذب
    if (await storageLow()) {
      router.push("/sync/storage?blocked=sale");
      return null;
    }
    setPhase("saving");
    try {
      if (!ids.current)
        ids.current = {
          operationId: crypto.randomUUID(),
          saleId: crypto.randomUUID(),
          payments: payments.map(() => crypto.randomUUID()),
          lines: lines.map(() => crypto.randomUUID()),
          movements: lines.map(() => crypto.randomUUID()),
        };
      const storage = getStorage();
      await writeCartDraft(storage, { ...draft, lines });
      const { sale: saved } = await saveSaleLocally(storage, {
        operationId: ids.current.operationId,
        saleId: ids.current.saleId,
        draft: { ...draft, lines },
        payments: payments.map((p, i) => ({ ...p, paymentId: ids.current!.payments[i]! })),
        shift,
        branchCode: ctx.branchCode || "BR",
        devicePrefix: ctx.devicePrefix || "X",
        deviceId: ctx.deviceId,
        userId: ctx.userId,
        userName: ctx.userName,
        businessDate: shift.business_date || today(),
        occurredAt: new Date().toISOString(),
        extraDependencies,
        memberIds: { lines: ids.current.lines, movements: ids.current.movements },
      });
      setSale(saved);
      return saved;
    } finally {
      /* الحالة تُقفل من المُستدعي بعد الرفع */
    }
  };

  /** محاولة الرفع الأولى بعد الحفظ؛ فشلها لا يمسّ البيع المحفوظ (§٣.٢ بند 6). */
  const pushAfterSave = async () => {
    if (!online) {
      setPush("pending");
      setPhase("saved");
      return;
    }
    try {
      const out = await pushPending();
      setPush(
        out.kind === "applied" || out.kind === "idle"
          ? "synced"
          : out.kind === "retry"
            ? "failed"
            : "pending",
      );
    } catch {
      setPush("failed");
    } finally {
      setPhase("saved");
    }
  };

  const totals = cartTotals(draft?.lines ?? [], draft?.discount);
  return {
    router,
    online,
    draft,
    shift,
    ctx,
    balances,
    matchedAt,
    party,
    pendingCredit,
    totals,
    phase,
    sale,
    push,
    overStockOf,
    save,
    pushAfterSave,
    setPhase,
  };
}
