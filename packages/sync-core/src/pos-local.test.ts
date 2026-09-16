import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import type { LocalItem } from "./catalog-local";
import {
  addToCart,
  cartTotals,
  catalogRows,
  checkQty,
  holdCart,
  looksLikeBarcode,
  nearestNames,
  readBalanceMatchedAt,
  readCartDraft,
  readLocalBalances,
  rowByBarcode,
  stepCartLine,
  storeBalances,
  writeCartDraft,
} from "./pos-local";

const sugar: LocalItem = {
  id: "i1",
  name: "سكر",
  name_normalized: "سكر",
  group_id: "g1",
  group_name: "بقالة",
  base_unit_id: "u-kg",
  base_unit_code: "كغ",
  base_unit_name: "كيلوغرام",
  base_unit_decimal_places: 3,
  units: [
    {
      unit_id: "u-ctn",
      code: "كرتونة",
      name: "كرتونة",
      factor_milli: "12000",
      barcode: "6291000000159",
    },
  ],
  barcode: "6291000000142",
  sale_price_minor: "10000",
  price_updated_at: "",
  aliases: ["سكر أبيض"],
  is_active: true,
  deactivated_at: "",
  updated_at: "",
};
const tea: LocalItem = {
  ...sugar,
  id: "i2",
  name: "شاي بني",
  name_normalized: "شاي بني",
  base_unit_id: "u-pack",
  base_unit_code: "عبوة",
  base_unit_name: "عبوة",
  base_unit_decimal_places: 0,
  units: [],
  barcode: "",
  sale_price_minor: "24000",
  aliases: [],
};

describe("نقطة البيع محلياً (POS-01/02؛ §٦.٢)", () => {
  it("صفوف الكتالوج صنفاً × وحدة: تسمية الوحدة بمعاملها وسعرها من الأساس × المعامل بلا تقريب في الواجهة", () => {
    const rows = catalogRows([sugar, tea]);
    expect(rows.map((r) => r.label)).toEqual(["سكر", "سكر — كرتونة", "شاي بني"]);
    expect(rows[1]!.unitLabel).toBe("كرتونة = 12 كغ");
    expect(rows[1]!.unitPriceMinor).toBe("120000");
    expect(rows[0]!.weighable).toBe(true);
    expect(rows[2]!.weighable).toBe(false);
    expect(rowByBarcode(rows, "6291000000159")?.unitId).toBe("u-ctn");
    expect(rowByBarcode(rows, "6291000000142")?.isBase).toBe(true);
    expect(rowByBarcode(rows, "0000")).toBeNull();
  });

  it("الكمية: ثلاث منازل للوزن كحد أقصى (0.1234 مرفوض)، والعبوة بلا كسور، والصفر مرفوض", () => {
    expect(checkQty("0.123", 3)).toEqual({ ok: true, qtyMilli: "123" });
    expect(checkQty("0.1234", 3)).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(checkQty("٢٫٥", 3)).toEqual({ ok: true, qtyMilli: "2500" });
    expect(checkQty("0.5", 0)).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(checkQty("0", 3)).toEqual({ ok: false, reason: "zero" });
    expect(checkQty("abc", 3)).toEqual({ ok: false, reason: "invalid" });
  });

  it("السلة: 0.123 × 100.00 = 12.30 مقرَّباً في المجال، الجمع بالسطر نفسه، و«−» إلى الصفر يحذف", () => {
    const rows = catalogRows([sugar, tea]);
    let n = 0;
    const id = () => `l${++n}`;
    let lines = addToCart([], rows[0]!, "123", id);
    expect(cartTotals(lines).lineTotals.get("l1")).toBe(1230n);
    lines = addToCart(lines, rows[0]!, "1000", id);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty_milli).toBe("1123");
    lines = addToCart(lines, rows[2]!, "1000", id);
    const t = cartTotals(lines);
    expect(t.lineCount).toBe(2);
    expect(t.totalMinor).toBe(11230n + 24000n);
    lines = stepCartLine(lines, "l2", -1);
    expect(lines).toHaveLength(1);
    lines = stepCartLine(lines, "l1", 1);
    expect(lines[0]!.qty_milli).toBe("2123");
  });

  it("مسودّة السلة تبقى على الجهاز (تشغيل بارد) والتعليق يحفظها في المعلّقات ويفرّغها", async () => {
    const s = new MemoryStorage();
    const rows = catalogRows([tea]);
    const lines = addToCart([], rows[0]!, "2000", () => "l1");
    await writeCartDraft(s, lines, "2026-09-16T10:00:00Z");
    expect((await readCartDraft(s)).lines).toEqual(lines);
    expect(await holdCart(s, lines, "2026-09-16T10:05:00Z")).toBe(1);
    expect((await readCartDraft(s)).lines).toEqual([]);
    expect(await holdCart(s, lines)).toBe(2);
  });

  it("الأرصدة موسومة بآخر مطابقة؛ بلا مطابقة لا رصيد معروف", async () => {
    const s = new MemoryStorage();
    expect((await readLocalBalances(s)).size).toBe(0);
    expect(await readBalanceMatchedAt(s)).toBeNull();
    await storeBalances(s, "2026-09-16T10:30:00Z", [{ item_id: "i1", qty_milli: "10000" }]);
    const b = await readLocalBalances(s);
    expect(b.get("i1")).toEqual({
      item_id: "i1",
      qty_milli: "10000",
      as_of: "2026-09-16T10:30:00Z",
    });
    expect(await readBalanceMatchedAt(s)).toBe("2026-09-16T10:30:00Z");
  });

  it("«أقرب الأسماء» اقتراح بحثي بكلمة مشتركة، والباركود المجهول أرقام بطول 8+", () => {
    expect(nearestNames([sugar, tea], "سكر بني")).toEqual(["سكر", "شاي بني"]);
    expect(nearestNames([sugar, tea], "زيت")).toEqual([]);
    expect(looksLikeBarcode("6291041500213")).toBe(true);
    expect(looksLikeBarcode("سكر")).toBe(false);
  });
});
