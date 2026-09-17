import { MemoryStorage } from "@sting/platform/memory";
import { describe, expect, it } from "vitest";

import {
  createPartyLocally,
  findSimilarLocal,
  type LocalParty,
  maskPhone,
  readLocalParties,
  searchLocalParties,
} from "./parties-local";

const ahmad: LocalParty = {
  id: "p1",
  name: "أحمد الطيب — تجريبي",
  name_normalized: "احمد الطيب — تجريبي",
  phone: "0912555447",
  credit_limit_minor: "50000",
  is_customer: true,
  is_supplier: false,
  distinct_from_id: "",
  balance_minor: "12000",
  last_sale_at: "2026-09-08T10:00:00Z",
  is_active: true,
  deactivated_at: "",
  updated_at: "",
};

describe("الأطراف محلياً (POS-04؛ §٧.٥)", () => {
  it("البحث بالبادئة بعد التطبيع وبالهاتف؛ الهاتف يُحجب وسطه على الشاشة", () => {
    expect(searchLocalParties([ahmad], "احمد").map((p) => p.id)).toEqual(["p1"]);
    expect(searchLocalParties([ahmad], "٠٩١٢").map((p) => p.id)).toEqual(["p1"]);
    expect(searchLocalParties([ahmad], "زيد")).toEqual([]);
    expect(maskPhone("0912-555-447")).toBe("0912 ••• 447");
  });

  it("التشابه المضلل: الاسم نفسه أو الهاتف نفسه — يُعرض لا يُمنع", () => {
    expect(findSimilarLocal([ahmad], "احمد الطيّب — تجريبي", "").byName).toHaveLength(1);
    expect(findSimilarLocal([ahmad], "مطعم الواحة", "0912 555 447").byPhone).toHaveLength(1);
    expect(findSimilarLocal([ahmad], "مطعم الواحة", "").byName).toHaveLength(0);
  });

  it("الإنشاء السريع محلياً: عملية + إسقاط في معاملة واحدة؛ إعادة الضغط لا تنشئ ثانياً", async () => {
    const s = new MemoryStorage();
    const input = {
      operationId: "op1",
      partyId: "p9",
      name: "مطعم الروضة ",
      phone: "0911222203",
      distinctFromPartyId: "p1",
      occurredAt: "2026-09-16T10:00:00Z",
    };
    const a = await createPartyLocally(s, input);
    expect(a.alreadySaved).toBe(false);
    expect(a.party.name).toBe("مطعم الروضة");
    expect(a.party.distinct_from_id).toBe("p1");
    expect((await createPartyLocally(s, input)).alreadySaved).toBe(true);
    expect((await readLocalParties(s)).map((p) => p.id)).toEqual(["p9"]);
    const ops = await s.read((tx) => tx.listOperationsByState("local"));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.members[0]!.payload).toMatchObject({
      party_id: "p9",
      name: "مطعم الروضة",
      distinct_from_party_id: "p1",
    });
  });
});
