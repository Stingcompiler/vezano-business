/**
 * نقطة البيع محلياً (POS-01/POS-02؛ §١٢.٤ CSR من الإسقاط المحلي): صفوف الكتالوج صنفاً × وحدة،
 * الأرصدة الموسومة بآخر مطابقة (ACC-76)، ومسودّة السلة على الجهاز (تشغيل بارد بلا شبكة). كل حساب
 * مالي من `@sting/domain` — لا تقريب في الواجهة (§٦.٢).
 *
 * السلة مسودّة لا عملية: لا تدخل الطابور ولا تُرفع؛ خط حفظ البيع (`sale`) يأتي مع POS-05 (T1.16).
 */
import {
  assertQtyPrecision,
  type DecimalPlaces,
  DomainError,
  invoiceTotalMinor,
  lineTotalMinor,
  matchesPrefix,
  normalizeSearch,
  parseQtyString,
  roundHalfAwayDiv,
} from "@sting/domain";
import type { StoragePort } from "@sting/platform";

import type { LocalItem, LocalItemUnit } from "./catalog-local";
import { saveOperation } from "./local-save";
import type { OperationDraft } from "./types";

// ─── الأرصدة ───────────────────────────────────────────────────────────────

export const BALANCE_PREFIX = "entity:inventory.Balance:";
export const BALANCE_MATCH_META = "inventory.balances_as_of";

/** رصيد صنف في فرع الجهاز بالوحدة الأساسية (أجزاء الألف) ووقت آخر مطابقة خادمية. */
export interface LocalBalance {
  readonly item_id: string;
  readonly qty_milli: string;
  readonly as_of: string;
}

export async function readLocalBalances(storage: StoragePort): Promise<Map<string, LocalBalance>> {
  const rows = await storage.read((tx) => tx.listProjections(BALANCE_PREFIX));
  const out = new Map<string, LocalBalance>();
  for (const r of rows) {
    // الإسقاط إمّا مسطّح (النسخة المادية) أو بغلاف PULL {payload}
    const v = r.value as { payload?: Record<string, unknown> } & Record<string, unknown>;
    const src = v.payload ?? v;
    const str = (x: unknown, fallback: string) => (typeof x === "string" ? x : fallback);
    const itemId = str(src["item_id"], r.key.slice(BALANCE_PREFIX.length));
    out.set(itemId, {
      item_id: itemId,
      qty_milli: str(src["qty_milli"], "0"),
      as_of: str(src["as_of"], ""),
    });
  }
  return out;
}

/** يطبّق مطابقة خادمية للأرصدة: يكتب الأرصدة الواردة ويثبّت وقت المطابقة في meta. */
export async function storeBalances(
  storage: StoragePort,
  asOf: string,
  balances: readonly { readonly item_id: string; readonly qty_milli: string }[],
): Promise<void> {
  await storage.transaction(async (tx) => {
    for (const b of balances) {
      await tx.putProjection({
        key: BALANCE_PREFIX + b.item_id,
        value: { item_id: b.item_id, qty_milli: b.qty_milli, as_of: asOf },
      });
    }
    await tx.putMeta(BALANCE_MATCH_META, asOf);
  });
}

export async function readBalanceMatchedAt(storage: StoragePort): Promise<string | null> {
  return (await storage.read((tx) => tx.getMeta(BALANCE_MATCH_META))) || null;
}

// ─── صفوف الكتالوج (صنف × وحدة) ────────────────────────────────────────────

/** صف في جدول POS-01: «سكر» بالكغ و«سكر — كرتونة» بالكرتونة = 12 كغ، كلٌّ بسعره. */
export interface CatalogRow {
  readonly key: string;
  readonly item: LocalItem;
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitName: string;
  /** «سكر» أو «سكر — كرتونة». */
  readonly label: string;
  /** «كغ» أو «كرتونة = 12 كغ». */
  readonly unitLabel: string;
  readonly factorMilli: string;
  readonly decimalPlaces: DecimalPlaces;
  /** سعر الوحدة: سعر الأساس × المعامل (لا سعر مستقل للوحدة البديلة في النموذج — 0005 §١٧). */
  readonly unitPriceMinor: string;
  readonly isBase: boolean;
  /** وحدة تُباع بالوزن/الكسر (منازل عشرية) — تفتح POS-02 قبل الإضافة. */
  readonly weighable: boolean;
}

const FACTOR_ONE = 1000n;

function factorLabel(factorMilli: string, baseUnitCode: string): string {
  const f = BigInt(factorMilli);
  const whole = f / FACTOR_ONE;
  const frac = (f % FACTOR_ONE).toString().padStart(3, "0").replace(/0+$/, "");
  return `= ${whole}${frac ? "." + frac : ""} ${baseUnitCode}`;
}

export function catalogRows(items: readonly LocalItem[]): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const item of items) {
    const baseDecimals = item.base_unit_decimal_places ?? 0;
    rows.push({
      key: `${item.id}:${item.base_unit_id}`,
      item,
      unitId: item.base_unit_id,
      unitCode: item.base_unit_code,
      unitName: item.base_unit_name,
      label: item.name,
      unitLabel: item.base_unit_code,
      factorMilli: "1000",
      decimalPlaces: baseDecimals,
      unitPriceMinor: item.sale_price_minor,
      isBase: true,
      weighable: baseDecimals > 0,
    });
    for (const u of item.units) {
      rows.push(unitRow(item, u));
    }
  }
  return rows;
}

function unitRow(item: LocalItem, u: LocalItemUnit): CatalogRow {
  const decimals = u.decimal_places ?? 0;
  return {
    key: `${item.id}:${u.unit_id}`,
    item,
    unitId: u.unit_id,
    unitCode: u.code,
    unitName: u.name,
    label: `${item.name} — ${u.name}`,
    unitLabel: `${u.code} ${factorLabel(u.factor_milli, item.base_unit_code)}`,
    factorMilli: u.factor_milli,
    decimalPlaces: decimals,
    unitPriceMinor: lineTotalMinor(
      BigInt(u.factor_milli),
      BigInt(item.sale_price_minor),
    ).toString(),
    isBase: false,
    weighable: decimals > 0,
  };
}

/** الوحدات المتاحة لصنف (للاختيار في POS-02) — الأساس أولاً. */
export function unitRowsOf(item: LocalItem): CatalogRow[] {
  return catalogRows([item]);
}

/** باركود مقروء بالكامل → الصف المرتبط (باركود الصنف = الأساس؛ باركود الوحدة = وحدتها) أو null. */
export function rowByBarcode(rows: readonly CatalogRow[], code: string): CatalogRow | null {
  const c = normalizeSearch(code);
  if (!c) return null;
  for (const r of rows) {
    if (r.isBase && r.item.barcode && r.item.barcode === c) return r;
    if (!r.isBase) {
      const u = r.item.units.find((x) => x.unit_id === r.unitId);
      if (u?.barcode && u.barcode === c) return r;
    }
  }
  return null;
}

/** «أقرب الأسماء»: اقتراح بحثي لا تصحيح تلقائي — كلمة مشتركة أو بادئة مشتركة بعد التطبيع. */
export function nearestNames(items: readonly LocalItem[], q: string, limit = 3): string[] {
  const words = normalizeSearch(q)
    .split(" ")
    .filter((w) => w.length >= 2);
  if (!words.length) return [];
  const scored = items
    .filter((i) => i.is_active)
    .map((i) => {
      const nameWords = normalizeSearch(i.name).split(" ");
      let score = 0;
      for (const w of words) {
        if (nameWords.includes(w)) score += 2;
        else if (nameWords.some((n) => n.startsWith(w) || w.startsWith(n))) score += 1;
        else if (matchesPrefix(i.name, w)) score += 1;
      }
      return { name: i.name, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ar"));
  return [...new Set(scored.map((x) => x.name))].slice(0, limit);
}

/** باركود محتمل: أرقام فقط بطول 8 فأكثر (EAN-8/EAN-13/UPC) — يميّز «باركود مجهول» عن «بحث بلا تطابق». */
export function looksLikeBarcode(q: string): boolean {
  return /^[0-9]{8,}$/.test(normalizeSearch(q));
}

// ─── السلة ─────────────────────────────────────────────────────────────────

export const CART_META = "pos.cart";
export const HELD_META = "pos.held";

/** سطر السلة: السعر والوحدة ومعاملها تُثبَّت على السطر لحظة الإضافة (ACC-19). */
export interface CartDraftLine {
  readonly id: string;
  readonly item_id: string;
  readonly item_name: string;
  readonly unit_id: string;
  readonly unit_code: string;
  readonly unit_name: string;
  readonly factor_milli: string;
  readonly decimal_places: DecimalPlaces;
  readonly qty_milli: string;
  readonly unit_price_minor: string;
  /** سعر أُدخل يدوياً لهذه العملية (صنف بلا سعر — POS-05) يُسجَّل باسم من أدخله. */
  readonly manual_price?: boolean | undefined;
}

/** خصم على الفاتورة (POS-03): «مبلغ» بالوحدة الصغرى أو «نسبة» مئوية صحيحة؛ السبب إلزامي. */
export interface CartDiscount {
  readonly mode: "amount" | "percent";
  readonly value: string;
  readonly reason: string;
}

/** العميل مطلوب للأثر الآجل فقط — لا عميل وهمي للبيع النقدي (ACC-12). */
export interface CartCustomer {
  readonly id: string;
  readonly name: string;
}

export interface CartDraft {
  readonly lines: readonly CartDraftLine[];
  readonly discount?: CartDiscount | undefined;
  readonly customer?: CartCustomer | undefined;
  readonly updated_at: string;
}

export type CartDraftInput = Omit<CartDraft, "updated_at">;

export interface CartTotals {
  readonly lineTotals: ReadonlyMap<string, bigint>;
  /** مجموع السطور قبل الخصم. */
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  /** الإجمالي بعد الخصم — ما يُطلب من الزبون. */
  readonly totalMinor: bigint;
  readonly lineCount: number;
}

/** قيمة الخصم بالوحدة الصغرى: المبلغ لا يتجاوز المجموع؛ النسبة تُقرَّب في المجال (نصف بعيداً عن الصفر). */
export function discountMinorOf(d: CartDiscount | undefined, subtotal: bigint): bigint {
  if (!d) return 0n;
  if (d.mode === "amount") {
    const v = BigInt(d.value);
    return v > subtotal ? subtotal : v;
  }
  return roundHalfAwayDiv(subtotal * BigInt(d.value), 100n);
}

/** إجمالي السطر مقرَّب في المجال ثم مجموع السطور — لا يُعاد تقريب المجموع (§٦.٢)؛ الخصم بعده. */
export function cartTotals(lines: readonly CartDraftLine[], discount?: CartDiscount): CartTotals {
  const lineTotals = new Map<string, bigint>();
  for (const l of lines) {
    lineTotals.set(l.id, lineTotalMinor(BigInt(l.qty_milli), BigInt(l.unit_price_minor)));
  }
  const subtotalMinor = invoiceTotalMinor([...lineTotals.values()]);
  const discountMinor = discountMinorOf(discount, subtotalMinor);
  return {
    lineTotals,
    subtotalMinor,
    discountMinor,
    totalMinor: subtotalMinor - discountMinor,
    lineCount: lines.length,
  };
}

// ─── الخصم وسقوف الدور (POS-03؛ §٧.٤؛ G-09 مؤقتاً) ──────────────────────────

/** سقوف الدور كما يعيدها الخادم مع `shifts/current`؛ صفر = بلا حدّ. */
export interface DiscountCaps {
  readonly per_op_minor: string;
  readonly daily_minor: string;
  readonly percent: number;
  readonly used_today_minor: string;
}

export type DiscountCheck =
  | { readonly ok: true; readonly minor: bigint }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "over_op" | "over_percent" | "over_daily";
      readonly cap: string;
      readonly minor: bigint;
    };

/** يفحص الخصم المكتوب ضد سقف العملية/النسبة/اليوم — «الرفض الصامت يدفع إلى الحيَل». */
export function checkDiscount(
  d: CartDiscount,
  caps: DiscountCaps,
  subtotal: bigint,
): DiscountCheck {
  if (!/^(0|[1-9][0-9]*)$/.test(d.value) || BigInt(d.value) === 0n)
    return { ok: false, reason: "invalid", cap: "", minor: 0n };
  const minor = discountMinorOf(d, subtotal);
  if (d.mode === "percent") {
    if (BigInt(d.value) > 100n) return { ok: false, reason: "invalid", cap: "", minor };
    if (caps.percent > 0 && Number(d.value) > caps.percent)
      return { ok: false, reason: "over_percent", cap: String(caps.percent), minor };
  } else {
    const perOp = BigInt(caps.per_op_minor);
    if (perOp > 0n && BigInt(d.value) > perOp)
      return { ok: false, reason: "over_op", cap: caps.per_op_minor, minor };
  }
  const daily = BigInt(caps.daily_minor);
  if (daily > 0n && BigInt(caps.used_today_minor) + minor > daily)
    return { ok: false, reason: "over_daily", cap: caps.daily_minor, minor };
  return { ok: true, minor };
}

export interface DiscountOverrideInput {
  readonly operationId: string;
  readonly requestId: string;
  readonly branchId: string;
  readonly discount: CartDiscount;
  readonly cap: string;
  readonly cartTotalMinor: string;
  readonly occurredAt: string;
}

export function discountOverrideDraft(i: DiscountOverrideInput): OperationDraft {
  return {
    operationId: i.operationId,
    kind: "discount_override",
    opVersion: 1,
    dependencies: [],
    members: [
      {
        entity: "sales.DiscountOverride",
        id: i.requestId,
        schemaVersion: 1,
        payload: {
          request_id: i.requestId,
          branch_id: i.branchId,
          mode: i.discount.mode,
          value: i.discount.value,
          cap: i.cap,
          reason: i.discount.reason.trim(),
          cart_total_minor: i.cartTotalMinor,
          occurred_at: i.occurredAt,
        },
      },
    ],
  };
}

/** «طلب اعتماد من مدير الفرع»: حدث تجاوز يُنسب للكاشير ويُراجع عند الاتصال (§٧.٤). */
export async function requestDiscountOverride(
  storage: StoragePort,
  input: DiscountOverrideInput,
): Promise<{ alreadySaved: boolean }> {
  const out = await saveOperation(storage, discountOverrideDraft(input), async () => {});
  return { alreadySaved: out.alreadySaved };
}

export type QtyCheck =
  | { readonly ok: true; readonly qtyMilli: string }
  | { readonly ok: false; readonly reason: "too_many_decimals" | "invalid" | "zero" };

/**
 * يفحص كمية مكتوبة لوحدة بمنازلها: ثلاث منازل كحد أقصى للوزن (0.1234 مرفوض — «لن نقرّب نيابة عنك»)،
 * والوحدة ذات المنازل الأقل ترفض ما يتجاوزها؛ الأرقام العربية تُقبل وتُحوَّل.
 */
export function checkQty(text: string, decimalPlaces: DecimalPlaces): QtyCheck {
  const latin = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace("٫", ".");
  const m = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(latin);
  if (!m) return { ok: false, reason: "invalid" };
  if ((m[2]?.length ?? 0) > 3) return { ok: false, reason: "too_many_decimals" };
  try {
    const milli = parseQtyString(latin);
    if (milli === 0n) return { ok: false, reason: "zero" };
    assertQtyPrecision(milli, decimalPlaces);
    return { ok: true, qtyMilli: milli.toString() };
  } catch (e) {
    if (e instanceof DomainError && e.code === "invalid_precision")
      return { ok: false, reason: "too_many_decimals" };
    return { ok: false, reason: "invalid" };
  }
}

const EMPTY_DRAFT: CartDraft = { lines: [], updated_at: "" };

export async function readCartDraft(storage: StoragePort): Promise<CartDraft> {
  const raw = await storage.read((tx) => tx.getMeta(CART_META));
  if (!raw) return EMPTY_DRAFT;
  try {
    const parsed = JSON.parse(raw) as Partial<CartDraft>;
    return {
      lines: parsed.lines ?? [],
      discount: parsed.discount,
      customer: parsed.customer,
      updated_at: parsed.updated_at ?? "",
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export async function writeCartDraft(
  storage: StoragePort,
  draft: CartDraftInput,
  now: string = new Date().toISOString(),
): Promise<void> {
  await storage.transaction((tx) =>
    tx.putMeta(CART_META, JSON.stringify({ ...draft, updated_at: now } satisfies CartDraft)),
  );
}

/** «تعليق الفاتورة»: السلة تُحفظ في قائمة المعلّقات ثم تُفرَّغ — لا تُمحى (R-03). */
export async function holdCart(
  storage: StoragePort,
  lines: readonly CartDraftLine[],
  now: string = new Date().toISOString(),
): Promise<number> {
  return storage.transaction(async (tx) => {
    const raw = await tx.getMeta(HELD_META);
    const held: { lines: readonly CartDraftLine[]; held_at: string }[] = raw
      ? (JSON.parse(raw) as { lines: readonly CartDraftLine[]; held_at: string }[])
      : [];
    held.push({ lines, held_at: now });
    await tx.putMeta(HELD_META, JSON.stringify(held));
    await tx.putMeta(CART_META, JSON.stringify({ ...EMPTY_DRAFT, updated_at: now }));
    return held.length;
  });
}

/** يضيف صفاً إلى السلة: السطر نفسه (صنف × وحدة × سعر) يُجمع بالكمية، وإلا سطر جديد. */
export function addToCart(
  lines: readonly CartDraftLine[],
  row: CatalogRow,
  qtyMilli: string,
  newId: () => string,
): CartDraftLine[] {
  const existing = lines.find(
    (l) =>
      l.item_id === row.item.id &&
      l.unit_id === row.unitId &&
      l.unit_price_minor === row.unitPriceMinor,
  );
  if (existing) {
    const next = (BigInt(existing.qty_milli) + BigInt(qtyMilli)).toString();
    return lines.map((l) => (l === existing ? { ...l, qty_milli: next } : l));
  }
  return [
    ...lines,
    {
      id: newId(),
      item_id: row.item.id,
      item_name: row.item.name,
      unit_id: row.unitId,
      unit_code: row.unitCode,
      unit_name: row.unitName,
      factor_milli: row.factorMilli,
      decimal_places: row.decimalPlaces,
      qty_milli: qtyMilli,
      unit_price_minor: row.unitPriceMinor,
    },
  ];
}

/** «−»/«+» بوحدة كاملة؛ الصفر يحذف السطر (كما سلة الإطار). */
export function stepCartLine(
  lines: readonly CartDraftLine[],
  lineId: string,
  dir: 1 | -1,
): CartDraftLine[] {
  return lines
    .map((l) => {
      if (l.id !== lineId) return l;
      const next = BigInt(l.qty_milli) + BigInt(dir) * FACTOR_ONE;
      return { ...l, qty_milli: next.toString() };
    })
    .filter((l) => BigInt(l.qty_milli) > 0n);
}
