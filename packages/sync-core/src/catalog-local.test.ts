import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import {
  filterLocalItems,
  itemMatches,
  type LocalItem,
  readLocalGroups,
  readLocalItems,
} from "./catalog-local";

const item = (id: string, over: Partial<LocalItem>): LocalItem => ({
  id,
  name: id,
  name_normalized: id,
  group_id: "",
  group_name: "",
  base_unit_id: "u",
  base_unit_code: "piece",
  base_unit_name: "حبة",
  units: [],
  barcode: "",
  sale_price_minor: "0",
  price_updated_at: "",
  aliases: [],
  is_active: true,
  deactivated_at: "",
  updated_at: "",
  ...over,
});

describe("الكتالوج المحلي (CAT-01 المحلي أولاً؛ §٧.٥)", () => {
  it("يقرأ الأصناف والمجموعات من الإسقاطات ويرتّب المجموعات", async () => {
    const s = new MemoryStorage();
    await s.transaction(async (tx) => {
      await tx.putProjection({
        key: "entity:catalog.Item:a",
        value: { ...item("a", { name: "سكر" }), id: undefined },
      });
      await tx.putProjection({
        key: "entity:catalog.ItemGroup:g2",
        value: { name: "مشروبات", parent_id: "", parent_name: "", sort_order: 1, note: "" },
      });
      await tx.putProjection({
        key: "entity:catalog.ItemGroup:g1",
        value: { name: "بقالة", parent_id: "", parent_name: "", sort_order: 0, note: "" },
      });
      await tx.putProjection({ key: "entity:parties.Party:p", value: { name: "ليس صنفاً" } });
    });
    expect((await readLocalItems(s)).map((i) => [i.id, i.name])).toEqual([["a", "سكر"]]);
    expect((await readLocalGroups(s)).map((g) => g.name)).toEqual(["بقالة", "مشروبات"]);
  });

  it("يطابق بالبادئة بعد التطبيع على الاسم والأسماء البديلة والباركود", () => {
    const oil = item("o", { name: "زيت 1 لتر", aliases: ["زيت طعام"], barcode: "6291000000501" });
    expect(itemMatches(oil, "زي")).toBe(true);
    expect(itemMatches(oil, "طعام")).toBe(true);
    expect(itemMatches(oil, "١ لتر")).toBe(true);
    expect(itemMatches(oil, "629100000")).toBe(true);
    expect(itemMatches(oil, "يت")).toBe(false);
  });

  it("المعطَّل محفوظ بشاهده ولا يظهر افتراضياً (ACC-45)؛ التصفية بالمجموعة", () => {
    const items = [
      item("a", { name: "سكر", name_normalized: "سكر", group_id: "g1" }),
      item("b", {
        name: "صابون قديم",
        name_normalized: "صابون قديم",
        group_id: "g3",
        is_active: false,
      }),
    ];
    expect(filterLocalItems(items, {}).map((i) => i.id)).toEqual(["a"]);
    expect(filterLocalItems(items, { includeInactive: true }).map((i) => i.id)).toEqual(["a", "b"]);
    expect(
      filterLocalItems(items, { groupId: "g3", includeInactive: true }).map((i) => i.id),
    ).toEqual(["b"]);
    expect(filterLocalItems(items, { q: "صاب" })).toEqual([]);
  });
});
