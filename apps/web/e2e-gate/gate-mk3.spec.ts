import { type APIRequestContext, expect, test } from "@playwright/test";

import { OWNER, resetScenario } from "./fixtures";

/**
 * بوابة MK-3 (عدم تكرار المال والاستعادة — §١٨) على Django الحقيقي: المشغّل يرفع علم M3 من PLT-12،
 * «أ» تربط الطرف و«ب» تقبل، مطابقة بمعامل صريح، ثم شحنة 10/8/7 تُحوَّل إلى مستند شراء معتمد مرتين
 * = مستند واحد وأثر واحد (ACC-130)، مرتجع جزئي إلى مستند عكسي مرتين = عكسي واحد بالمقبول وحده
 * (ACC-132)، واستعادة بعد فقد الردّ بالهوية نفسها = الطلب نفسه (ACC-137/ORD-15).
 */
interface MarketScenario {
  tenant_a: string;
  tenant_b: string;
  public_offer_id: string;
  private_offer_id: string;
  operator_access: string;
}

async function tokenFor(request: APIRequestContext, tenantId: string): Promise<string> {
  const login = await request.post("/api/auth/account/login", {
    data: { identifier: OWNER.identifier, password: OWNER.password },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const body = (await login.json()) as { access?: string; select_ticket?: string };
  const sel = await request.post("/api/account/select", {
    data: { tenant_id: tenantId },
    headers: body.select_ticket
      ? { "X-Select-Ticket": body.select_ticket }
      : { Authorization: `Bearer ${body.access ?? ""}` },
  });
  expect(sel.ok(), await sel.text()).toBeTruthy();
  return ((await sel.json()) as { access: string }).access;
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const uuid = () => crypto.randomUUID();
const inDays = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

test("MK-3 — تحويل مكرَّر = مستند واحد، عكسي مكرَّر = عكسي واحد بالمقبول، استعادة بالهوية = الطلب نفسه", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await resetScenario(request);
  const seed = await request.post("/api/scenario/market");
  expect(seed.ok(), await seed.text()).toBeTruthy();
  const s = (await seed.json()) as MarketScenario;
  const ta = await tokenFor(request, s.tenant_a);
  const tb = await tokenFor(request, s.tenant_b);
  const op = auth(s.operator_access);

  // المشغّل: تحقق البائع ثم رفع علم M3 بنطاق البيئة من PLT-12 — التفعيل قراره لا الشيفرة
  let r = await request.post(`/api/platform/verifications/${s.tenant_b}/decide`, {
    headers: op,
    data: { decision: "verified" },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  r = await request.post(`/api/market/offers/${s.public_offer_id}/publish`, { headers: auth(tb) });
  expect(r.ok(), await r.text()).toBeTruthy();
  // قبل العلم: شاشات LINK مقفلة
  r = await request.get("/api/market/link/parties", { headers: auth(ta) });
  expect(((await r.json()) as { state: string }).state).toBe("phase_locked");
  r = await request.post("/api/platform/flags", {
    headers: op,
    data: { key: "market_m3", scope_kind: "env", scope: "ci", enabled: true },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  r = await request.post("/api/platform/flags", {
    headers: op,
    data: { key: "market_m3", scope_kind: "env", scope: "development", enabled: true },
  });
  expect(r.ok(), await r.text()).toBeTruthy();

  // «أ»: طرف محلي مورّد باسم قريب → طلب ربط باختيار صريح → «ب» تقبل
  r = await request.post("/api/parties", {
    headers: auth(ta),
    data: { name: "مخزن البركة", phone: "", is_supplier: true, is_customer: false },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const partyId = ((await r.json()) as { id: string }).id;
  r = await request.post(`/api/market/link/parties/${partyId}/request`, {
    headers: auth(ta),
    data: {},
  });
  expect(r.status()).toBe(400);
  const cands = ((await r.json()) as { extra: { candidates: { tenant_id: string }[] } }).extra
    .candidates;
  expect(cands.map((c) => c.tenant_id)).toContain(s.tenant_b);
  r = await request.post(`/api/market/link/parties/${partyId}/request`, {
    headers: auth(ta),
    data: { counterparty_tenant_id: s.tenant_b },
  });
  expect(r.status()).toBe(201);
  const linkId = ((await r.json()) as { link: { id: string } }).link.id;
  r = await request.get("/api/market/link/incoming", { headers: auth(tb) });
  expect(((await r.json()) as { pending_count: number }).pending_count).toBe(1);
  r = await request.post(`/api/market/link/incoming/${linkId}/accept`, { headers: auth(tb) });
  expect(r.ok(), await r.text()).toBeTruthy();

  // مطابقة «سكر» (كغ، كرتونة 12) بعرض «سكر أبيض» (كرتونة) بمعامل صريح 12 كغ
  r = await request.get("/api/catalog/items", { headers: auth(ta) });
  expect(r.ok()).toBeTruthy();
  const items = ((await r.json()) as { items: { id: string; name: string }[] }).items;
  const sugar = items.find((i) => i.name === "سكر");
  expect(sugar, "صنف «سكر» من السيناريو").toBeTruthy();
  r = await request.post("/api/market/link/items", {
    headers: auth(ta),
    data: {
      counterparty_tenant_id: s.tenant_b,
      item_id: sugar!.id,
      offer_id: s.public_offer_id,
      unit_code: "kg",
    },
  });
  expect(r.status()).toBe(400); // وحدتان مختلفتان بلا معامل
  r = await request.post("/api/market/link/items", {
    headers: auth(ta),
    data: {
      counterparty_tenant_id: s.tenant_b,
      item_id: sugar!.id,
      offer_id: s.public_offer_id,
      unit_code: "kg",
      factor_milli: "12000",
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();

  // طلب 10 → 8 → 7 (كما في MK-2)
  const opId = uuid();
  const orderBody = {
    op_id: opId,
    supplier_tenant_id: s.tenant_b,
    kind: "order",
    lines: [{ offer_id: s.public_offer_id, qty: 10, price_minor: "118000" }],
  };
  r = await request.post("/api/market/orders", { headers: auth(ta), data: orderBody });
  expect(r.ok(), await r.text()).toBeTruthy();
  const orderId = ((await r.json()) as { order: { id: string } }).order.id;
  r = await request.post(`/api/market/orders/${orderId}/quote`, {
    headers: auth(tb),
    data: {
      lines: [{ offer_id: s.public_offer_id, qty_confirmed: 8, price_minor: "118000" }],
      valid_until: inDays(3),
      send: true,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  expect(
    (
      await request.post(`/api/market/orders/${orderId}/accept`, {
        headers: auth(ta),
        data: { version: 2 },
      })
    ).ok(),
  ).toBeTruthy();
  r = await request.post(`/api/market/orders/${orderId}/shipments`, {
    headers: auth(tb),
    data: { lines: [{ offer_id: s.public_offer_id, qty: 8 }] },
  });
  const shipmentId = ((await r.json()) as { shipments: { id: string }[] }).shipments[0]!.id;
  r = await request.post(`/api/market/orders/${orderId}/receive`, {
    headers: auth(ta),
    data: {
      shipment_id: shipmentId,
      lines: [{ offer_id: s.public_offer_id, qty_received: 7, reason: "كرتونة تالفة" }],
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();

  // الاستعادة بالهوية نفسها = الطلب نفسه لا طلب ثانٍ (ACC-137 · ORD-15)
  r = await request.post("/api/market/orders/probe", {
    headers: auth(ta),
    data: { op_id: opId, lines: orderBody.lines },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const probe = (await r.json()) as { found: boolean; order: { id: string } | null };
  expect(probe.found).toBe(true);
  expect(probe.order?.id).toBe(orderId);
  r = await request.post("/api/market/orders", { headers: auth(ta), data: orderBody });
  expect(((await r.json()) as { order: { id: string } }).order.id).toBe(orderId);

  // التحويل: معاينة (لا أثر) → تحويل → تحويل ثانٍ = الرابط نفسه؛ مستند شراء واحد بقيمة 7×118000
  r = await request.get(`/api/market/link/receipts/${shipmentId}/preview`, { headers: auth(ta) });
  expect(r.ok(), await r.text()).toBeTruthy();
  const pv = (await r.json()) as {
    state: string;
    payable_minor: string;
    lines: { base_qty_milli: number }[];
  };
  expect(pv.state).toBe("ready");
  expect(pv.payable_minor).toBe(String(7 * 118000));
  expect(pv.lines[0]?.base_qty_milli).toBe(7 * 12000);
  r = await request.post(`/api/market/link/receipts/${shipmentId}/convert`, {
    headers: auth(ta),
    data: {},
  });
  expect(r.status(), await r.text()).toBe(201);
  const link1 = (await r.json()) as {
    link: { id: string; local_number: string; my_value_minor: string };
  };
  expect(link1.link.local_number).toMatch(/^PD-/);
  expect(link1.link.my_value_minor).toBe(String(7 * 118000));
  r = await request.post(`/api/market/link/receipts/${shipmentId}/convert`, {
    headers: auth(ta),
    data: {},
  });
  expect(r.status()).toBe(201);
  expect(((await r.json()) as { link: { id: string } }).link.id).toBe(link1.link.id);
  r = await request.get("/api/market/link/documents", { headers: auth(ta) });
  const docs = (await r.json()) as { linked_count: number; links: { diff_minor: string }[] };
  expect(docs.linked_count).toBe(1);
  expect(docs.links[0]?.diff_minor).toBe(String(118000)); // كرتونة لم تصل — بلا ترجيح

  // مرتجع 3 يوافق المورد على 2 → عكسي بـ2 مرتين = عكسي واحد؛ ذمّة المورد 5 كراتين
  r = await request.post(`/api/market/orders/${orderId}/returns`, {
    headers: auth(ta),
    data: { lines: [{ offer_id: s.public_offer_id, qty: 3, reason: "عبوات مبلَّلة" }] },
  });
  expect(r.status(), await r.text()).toBe(201);
  const rid = ((await r.json()) as { created: { id: string } }).created.id;
  r = await request.post(`/api/market/orders/${orderId}/returns/${rid}/decide`, {
    headers: auth(tb),
    data: { lines: [{ offer_id: s.public_offer_id, approved_qty: 2 }], note: "كرتونة سليمة" },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  r = await request.post(`/api/market/link/returns/${rid}/convert`, { headers: auth(ta) });
  expect(r.status(), await r.text()).toBe(201);
  const rv = (await r.json()) as {
    link: { id: string; local_number: string; my_value_minor: string };
  };
  expect(rv.link.local_number).toMatch(/^RV-/);
  expect(rv.link.my_value_minor).toBe(String(2 * 118000));
  r = await request.post(`/api/market/link/returns/${rid}/convert`, { headers: auth(ta) });
  expect(((await r.json()) as { link: { id: string } }).link.id).toBe(rv.link.id);
  r = await request.get("/api/market/link/returns", { headers: auth(ta) });
  const rets = (await r.json()) as {
    returns: { converted: boolean; reverse_partial: boolean; lines: { pending: number }[] }[];
  };
  expect(rets.returns[0]?.converted).toBe(true);
  expect(rets.returns[0]?.reverse_partial).toBe(true);
  expect(rets.returns[0]?.lines[0]?.pending).toBe(1);
  // ذمّة المورد في دفتر «أ» = 7 − 2 = 5 كراتين × 118000 (كشف الطرف)
  r = await request.get(`/api/parties/${partyId}`, { headers: auth(ta) });
  expect(r.ok(), await r.text()).toBeTruthy();
  const card = (await r.json()) as { supplier_owed_minor: string };
  expect(card.supplier_owed_minor).toBe(String(5 * 118000));
});
