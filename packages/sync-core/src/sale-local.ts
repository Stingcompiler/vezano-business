/**
 * خط حفظ البيع (§٣.٢ بند 4–5، §٨.٢؛ POS-05): عملية `sale` بأعضائها — رأس البيع وسطوره وتسويته
 * وحركات المخزون — في معاملة محلية واحدة مع الإسقاطات ورقم الفاتورة وتفريغ السلة؛ النجاح بعد
 * اكتمال الحفظ فقط، والطباعة خطوة لاحقة. الآثار من `@sting/domain` (§٧.٢): مخزون −الكمية بالوحدة
 * الأساسية، النقد وحده يدخل الصندوق، الآجل ذمّة على الطرف.
 *
 * تنبيه Dexie: كل `await` داخل المُسقِط على المعاملة مباشرةً.
 */
import { parseUnitFactor, toBaseQtyMilli } from "@sting/domain";
import type { StoragePort, StoredOperation } from "@sting/platform";

import { formatInvoiceNumber, INVOICE_SEQ_META, type InvoiceNumberParts } from "./invoice-number";
import { saveOperation } from "./local-save";
import { BALANCE_PREFIX, CART_META, type CartDraft, cartTotals } from "./pos-local";
import type { CashRow, LocalShift } from "./shift-local";
import type { OperationDraft } from "./types";

export const SALE_PREFIX = "entity:sales.Sale:";
export const LAST_SALE_META = "sales.last";

export type SalePaymentMethod = "cash" | "bank" | "credit";

export interface SalePaymentInput {
  readonly paymentId: string;
  readonly method: SalePaymentMethod;
  readonly amountMinor: string;
  /** للنقد: المستلَم والباقي (ACC-24) — محسوبان في المجال بنفس التقريب. */
  readonly receivedMinor?: string | undefined;
  readonly changeMinor?: string | undefined;
  readonly reference?: string | undefined;
}

export interface SaleInput {
  readonly operationId: string;
  readonly saleId: string;
  readonly draft: CartDraft;
  readonly payments: readonly SalePaymentInput[];
  readonly shift: LocalShift;
  readonly branchCode: string;
  readonly devicePrefix: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly userName: string;
  readonly businessDate: string;
  readonly occurredAt: string;
  /** عمليات محلية يعتمد عليها البيع غير فتح الوردية (إنشاء طرف سريع لم يُؤكَّد بعد). */
  readonly extraDependencies?: readonly string[] | undefined;
  /** معرّفات ثابتة للأعضاء — تُولَّد مرة واحدة على الشاشة حتى لا تُنشئ إعادة الضغط هوية جديدة. */
  readonly memberIds: {
    readonly lines: readonly string[];
    readonly movements: readonly string[];
  };
}

/** إسقاط البيع المحلي (POS-08/09 يقرآنه) — الأرقام سلاسل بالوحدة الصغرى. */
export interface LocalSale {
  readonly id: string;
  readonly invoice_number: string;
  readonly shift_id: string;
  readonly branch_id: string;
  readonly device_id: string;
  readonly user_id: string;
  readonly user_name: string;
  readonly party_id: string;
  readonly party_name: string;
  readonly subtotal_minor: string;
  readonly discount_minor: string;
  readonly total_minor: string;
  readonly cash_minor: string;
  readonly bank_minor: string;
  readonly credit_minor: string;
  readonly received_minor: string;
  readonly change_minor: string;
  readonly lines: readonly {
    readonly id: string;
    readonly item_id: string;
    readonly item_name: string;
    readonly unit_code: string;
    /** معامل الوحدة (اختياري في الإسقاطات القديمة — يُقرأ من حدث البيع عند الحاجة). */
    readonly factor_milli?: string | undefined;
    readonly qty_milli: string;
    readonly decimal_places: number;
    readonly unit_price_minor: string;
    readonly line_total_minor: string;
    readonly manual_price: boolean;
  }[];
  readonly business_date: string;
  readonly occurred_at: string;
  readonly operation_id: string;
}

/** يبني أعضاء العملية من السلة: الإجماليات من المجال ولا يُعاد تقريب المجموع (§٦.٢). */
export function saleDraft(input: SaleInput, invoiceNumber: string): OperationDraft {
  const { draft } = input;
  if (draft.lines.length === 0) throw new Error("empty_cart");
  if (input.memberIds.lines.length !== draft.lines.length)
    throw new Error("member ids must match lines");
  const totals = cartTotals(draft.lines, draft.discount);
  const settlement = { cashMinor: 0n, bankMinor: 0n, creditMinor: 0n };
  for (const p of input.payments) {
    if (p.method === "cash") settlement.cashMinor += BigInt(p.amountMinor);
    else if (p.method === "bank") settlement.bankMinor += BigInt(p.amountMinor);
    else settlement.creditMinor += BigInt(p.amountMinor);
  }
  if (settlement.cashMinor + settlement.bankMinor + settlement.creditMinor !== totals.totalMinor)
    throw new Error("settlement_mismatch");
  if (settlement.creditMinor > 0n && !draft.customer) throw new Error("party_required");
  // آثار المخزون (§٧.٢): −الكمية بالوحدة الأساسية لكل سطر — التحويل من المجال، دقيق أو مرفوض
  const stock = draft.lines.map((l) => ({
    itemId: l.item_id,
    deltaBaseQtyMilli: -toBaseQtyMilli(
      BigInt(l.qty_milli),
      parseUnitFactor(l.factor_milli, "1000"),
    ),
  }));
  if (input.memberIds.movements.length !== stock.length)
    throw new Error("member ids must match movements");
  const head = {
    sale_id: input.saleId,
    invoice_number: invoiceNumber,
    branch_id: input.shift.branch_id,
    device_id: input.deviceId,
    shift_id: input.shift.id,
    user_id: input.userId,
    ...(draft.customer ? { party_id: draft.customer.id } : {}),
    subtotal_minor: totals.subtotalMinor.toString(),
    ...(draft.discount
      ? {
          discount_mode: draft.discount.mode,
          discount_value: draft.discount.value,
          discount_minor: totals.discountMinor.toString(),
          discount_reason: draft.discount.reason,
        }
      : {}),
    total_minor: totals.totalMinor.toString(),
    business_date: input.businessDate,
    occurred_at: input.occurredAt,
  };
  return {
    operationId: input.operationId,
    kind: "sale",
    opVersion: 1,
    dependencies: [input.shift.operation_id, ...(input.extraDependencies ?? [])],
    members: [
      { entity: "sales.Sale", id: input.saleId, schemaVersion: 1, payload: head },
      ...draft.lines.map((l, i) => ({
        entity: "sales.SaleLine",
        id: input.memberIds.lines[i]!,
        schemaVersion: 1,
        payload: {
          line_id: input.memberIds.lines[i]!,
          sale_id: input.saleId,
          item_id: l.item_id,
          item_name: l.item_name,
          unit_id: l.unit_id,
          unit_code: l.unit_code,
          factor_milli: l.factor_milli,
          qty_milli: l.qty_milli,
          unit_price_minor: l.unit_price_minor,
          line_total_minor: (totals.lineTotals.get(l.id) ?? 0n).toString(),
          manual_price: Boolean(l.manual_price),
          sort_order: i,
        },
      })),
      ...input.payments.map((p) => ({
        entity: "sales.Payment",
        id: p.paymentId,
        schemaVersion: 1,
        payload: {
          payment_id: p.paymentId,
          sale_id: input.saleId,
          method: p.method,
          amount_minor: p.amountMinor,
          ...(p.receivedMinor ? { received_minor: p.receivedMinor } : {}),
          ...(p.changeMinor ? { change_minor: p.changeMinor } : {}),
          ...(p.reference ? { reference: p.reference } : {}),
        },
      })),
      ...stock.map((s, i) => ({
        entity: "inventory.StockMovement",
        id: input.memberIds.movements[i]!,
        schemaVersion: 1,
        payload: {
          movement_id: input.memberIds.movements[i]!,
          branch_id: input.shift.branch_id,
          item_id: s.itemId,
          delta_base_qty_milli: s.deltaBaseQtyMilli.toString(),
          reason: "sale",
          source_entity: "sales.Sale",
          source_id: input.saleId,
          occurred_at: input.occurredAt,
        },
      })),
    ],
  };
}

/**
 * يحفظ البيع محلياً في معاملة واحدة: العملية بأعضائها + رقم الفاتورة (عدّاد داخل المعاملة) + إسقاط
 * البيع + تحديث الأرصدة المحلية (ما له رصيد معروف) + تفريغ السلة. إعادة الضغط بالمعرّف نفسه لا
 * تنشئ هوية جديدة (`alreadySaved`).
 */
export async function saveSaleLocally(
  storage: StoragePort,
  input: SaleInput,
): Promise<{ sale: LocalSale; alreadySaved: boolean }> {
  const parts: InvoiceNumberParts = {
    branchCode: input.branchCode,
    devicePrefix: input.devicePrefix,
    yearTwoDigits: input.businessDate.slice(2, 4),
  };
  // الرقم يُحسم داخل المعاملة؛ المسودّة تُبنى بمكان مؤقت ثم يُثبَّت الرقم في الحدث نفسه
  const provisional = saleDraft(input, formatInvoiceNumber(parts, 0));
  const totals = cartTotals(input.draft.lines, input.draft.discount);
  const out = await saveOperation(storage, provisional, async (tx, op) => {
    const seq = Number((await tx.getMeta(INVOICE_SEQ_META)) ?? "0") + 1;
    await tx.putMeta(INVOICE_SEQ_META, String(seq));
    const number = formatInvoiceNumber(parts, seq);
    const fixed: StoredOperation = {
      ...op,
      members: op.members.map((m) =>
        m.entity === "sales.Sale" ? { ...m, payload: { ...m.payload, invoice_number: number } } : m,
      ),
    };
    await tx.putOperation(fixed);
    const cash = input.payments.find((p) => p.method === "cash");
    const sum = (method: SalePaymentMethod) =>
      input.payments
        .filter((p) => p.method === method)
        .reduce((a, p) => a + BigInt(p.amountMinor), 0n)
        .toString();
    const sale: LocalSale = {
      id: input.saleId,
      invoice_number: number,
      shift_id: input.shift.id,
      branch_id: input.shift.branch_id,
      device_id: input.deviceId,
      user_id: input.userId,
      user_name: input.userName,
      party_id: input.draft.customer?.id ?? "",
      party_name: input.draft.customer?.name ?? "",
      subtotal_minor: totals.subtotalMinor.toString(),
      discount_minor: totals.discountMinor.toString(),
      total_minor: totals.totalMinor.toString(),
      cash_minor: sum("cash"),
      bank_minor: sum("bank"),
      credit_minor: sum("credit"),
      received_minor: cash?.receivedMinor ?? "",
      change_minor: cash?.changeMinor ?? "",
      lines: input.draft.lines.map((l, i) => ({
        id: input.memberIds.lines[i]!,
        item_id: l.item_id,
        item_name: l.item_name,
        unit_code: l.unit_code,
        factor_milli: l.factor_milli,
        qty_milli: l.qty_milli,
        decimal_places: l.decimal_places,
        unit_price_minor: l.unit_price_minor,
        line_total_minor: (totals.lineTotals.get(l.id) ?? 0n).toString(),
        manual_price: Boolean(l.manual_price),
      })),
      business_date: input.businessDate,
      occurred_at: input.occurredAt,
      operation_id: op.operationId,
    };
    await tx.putProjection({ key: SALE_PREFIX + sale.id, value: { ...sale } });
    // الرصيد المحلي يتحرّك بما بيع؛ صنف بلا رصيد معروف يبقى مجهولاً (لا صفر مزعوم)
    for (const m of fixed.members) {
      if (m.entity !== "inventory.StockMovement") continue;
      const key = BALANCE_PREFIX + String(m.payload["item_id"]);
      const row = await tx.getProjection(key);
      if (!row) continue;
      const v = row.value as { qty_milli?: string; as_of?: string };
      const next = BigInt(v.qty_milli ?? "0") + BigInt(String(m.payload["delta_base_qty_milli"]));
      await tx.putProjection({ key, value: { ...v, qty_milli: next.toString() } });
    }
    await tx.putMeta(CART_META, JSON.stringify({ lines: [], updated_at: input.occurredAt }));
    await tx.putMeta(LAST_SALE_META, sale.id);
  });
  const row = await storage.read((tx) => tx.getProjection(SALE_PREFIX + input.saleId));
  return { sale: row!.value as unknown as LocalSale, alreadySaved: out.alreadySaved };
}

export async function readSale(storage: StoragePort, saleId: string): Promise<LocalSale | null> {
  const row = await storage.read((tx) => tx.getProjection(SALE_PREFIX + saleId));
  return row ? (row.value as unknown as LocalSale) : null;
}

export async function readSales(storage: StoragePort): Promise<LocalSale[]> {
  const rows = await storage.read((tx) => tx.listProjections(SALE_PREFIX));
  return rows
    .map((r) => r.value as unknown as LocalSale)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

/**
 * سطور البيع النقدي لدرج الوردية (SHIFT-02/04 عبر `extraRows` في `readShiftCash`): جزء النقد فقط
 * يدخل الصندوق؛ الآجل والتحويل في عمود «خارج الصندوق» (ACC-08/13).
 */
export async function readSaleCashRows(storage: StoragePort, shiftId: string): Promise<CashRow[]> {
  const [sales, ops] = await storage.read(async (tx) => {
    const rows = (await tx.listProjections(SALE_PREFIX))
      .map((r) => r.value as unknown as LocalSale)
      .filter((s) => s.shift_id === shiftId);
    const opById = new Map<string, StoredOperation>();
    for (const s of rows) {
      const op = await tx.getOperation(s.operation_id);
      if (op) opById.set(s.operation_id, op);
    }
    return [rows, opById] as const;
  });
  const syncOf = (op: StoredOperation | undefined): CashRow["sync"] =>
    !op
      ? "pending"
      : op.state === "synced"
        ? "synced"
        : op.state === "conflict"
          ? "conflict"
          : op.state === "quarantined"
            ? "quarantined"
            : "pending";
  return sales.map((s) => {
    const out = BigInt(s.bank_minor) + BigInt(s.credit_minor);
    return {
      doc: s.invoice_number,
      time: s.occurred_at,
      kind: "sale",
      note: s.party_name,
      inCashMinor: BigInt(s.cash_minor) > 0n ? s.cash_minor : null,
      outCashMinor: out > 0n ? out.toString() : null,
      sync: syncOf(ops.get(s.operation_id)),
    };
  });
}

// ─── الرصيد المركّب والتجاوز (POS-06؛ ACC-02، §٧.٤) ───────────────────────

/** الآجل المحفوظ على هذا الجهاز لطرفٍ ولم يؤكّده الخادم بعد — «معلّق هذا الجهاز» في الرصيد المركّب. */
export async function readPartyPendingCredit(
  storage: StoragePort,
  partyId: string,
): Promise<{ readonly pendingMinor: bigint; readonly count: number }> {
  return storage.read(async (tx) => {
    const rows = (await tx.listProjections(SALE_PREFIX))
      .map((r) => r.value as unknown as LocalSale)
      .filter((s) => s.party_id === partyId && BigInt(s.credit_minor) > 0n);
    let pending = 0n;
    let count = 0;
    for (const s of rows) {
      const op = await tx.getOperation(s.operation_id);
      if (op && op.state === "synced") continue;
      pending += BigInt(s.credit_minor);
      count += 1;
    }
    return { pendingMinor: pending, count };
  });
}

export interface CreditOverrideInput {
  readonly operationId: string;
  readonly overrideId: string;
  readonly saleId: string;
  /** عملية البيع المحلية التي يعتمد عليها التجاوز. */
  readonly saleOperationId: string;
  readonly partyId: string;
  readonly branchId: string;
  readonly creditLimitMinor: string;
  readonly balanceAfterMinor: string;
  readonly reason: string;
  readonly occurredAt: string;
}

/** «يظهر تنبيه بالمبلغ الزائد ويُطلب سبب، ثم يُكمَل البيع»: حدث تجاوز يُراجع عند الاتصال. */
export async function recordCreditOverride(
  storage: StoragePort,
  input: CreditOverrideInput,
): Promise<{ alreadySaved: boolean }> {
  const draft: OperationDraft = {
    operationId: input.operationId,
    kind: "credit_override",
    opVersion: 1,
    dependencies: [input.saleOperationId],
    members: [
      {
        entity: "sales.CreditOverride",
        id: input.overrideId,
        schemaVersion: 1,
        payload: {
          override_id: input.overrideId,
          sale_id: input.saleId,
          party_id: input.partyId,
          branch_id: input.branchId,
          credit_limit_minor: input.creditLimitMinor,
          balance_after_minor: input.balanceAfterMinor,
          reason: input.reason.trim(),
          occurred_at: input.occurredAt,
        },
      },
    ],
  };
  const out = await saveOperation(storage, draft, async () => {});
  return { alreadySaved: out.alreadySaved };
}

/** مرجع تحويل بنكي لا يُستهلك مرتين على هذا الجهاز (ACC-15) — الفحص الخادمي مع المطابقة البنكية. */
export async function bankReferenceUsed(storage: StoragePort, reference: string): Promise<boolean> {
  const ref = reference.trim();
  if (!ref) return false;
  const ops = await storage.read(async (tx) => {
    const all: StoredOperation[] = [];
    for (const st of ["local", "pending", "synced", "conflict", "quarantined"] as const)
      all.push(...(await tx.listOperationsByState(st)));
    return all;
  });
  return ops.some(
    (op) =>
      op.kind === "sale" &&
      op.members.some((m) => m.entity === "sales.Payment" && m.payload["reference"] === ref),
  );
}
