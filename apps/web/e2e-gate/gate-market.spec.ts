import { type APIRequestContext, expect, test } from "@playwright/test";

import { OWNER, resetScenario } from "./fixtures";

/**
 * بوابة المرحلة ٣ — تجربة صاحب المشروع (§١٥.٥) على Django الحقيقي بجلسات ثلاث منشآت ومشغّل:
 * «ب» بائع تُراجَع هويته قبل أن يُسمح له بالنشر (MK-4)؛ منتج عام وآخر بسعر خاص لعضو واحد، والثالثة
 * «ج» لا ترى الخاص ولا الطلب ولا الحقول غير المنشورة (MK-1 · ACC-121 · ACC-150)؛ طلب 10 → تأكيد 8 →
 * استلام 7، قطع الردّ وإعادة الإرسال بالهوية نفسها = طلب واحد، لا دين عند الطلب، ولا تكرار استلام
 * (MK-2)؛ ولوحة M0 تقول «غير حاسم» بفرصة واحدة (ACC-146/147/149).
 */
interface MarketScenario {
  tenant_a: string;
  tenant_b: string;
  tenant_c: string;
  public_offer_id: string;
  private_offer_id: string;
  price_list_id: string;
  third_party: { identifier: string; password: string };
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

async function directToken(
  request: APIRequestContext,
  who: { identifier: string; password: string },
): Promise<string> {
  const login = await request.post("/api/auth/account/login", { data: who });
  expect(login.ok(), await login.text()).toBeTruthy();
  const body = (await login.json()) as { access?: string; select_ticket?: string };
  expect(body.access, "الثالثة بعضوية واحدة تدخل مباشرة").toBeTruthy();
  return body.access ?? "";
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const uuid = () => crypto.randomUUID();
const inDays = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

test("MK-4 → MK-1 → MK-2 — تحقق قبل النشر، عام وخاص وثالثة لا ترى، طلب 10/8/7 بلا دين عند الطلب ولا تكرار إرسال أو استلام", async ({
  request,
}) => {
  test.setTimeout(240_000);
  await resetScenario(request);
  const seed = await request.post("/api/scenario/market");
  expect(seed.ok(), await seed.text()).toBeTruthy();
  const s = (await seed.json()) as MarketScenario;
  const ta = await tokenFor(request, s.tenant_a);
  const tb = await tokenFor(request, s.tenant_b);
  const tc = await directToken(request, s.third_party);
  const op = auth(s.operator_access);

  // ---- MK-4: البائع لا ينشر قبل تحقق الهوية؛ المشغّل يراجع ويقرّر باسمه
  let r = await request.post(`/api/market/offers/${s.public_offer_id}/publish`, {
    headers: auth(tb),
  });
  expect(r.status()).toBe(400);
  expect(((await r.json()) as { detail: string }).detail).toBe("seller_not_verified");
  r = await request.get("/api/platform/verifications", { headers: op });
  expect(r.ok()).toBeTruthy();
  const q = (await r.json()) as {
    pending_count: number;
    requests: { tenant_id: string; status: string }[];
  };
  expect(q.pending_count).toBe(1);
  expect(q.requests[0]?.tenant_id).toBe(s.tenant_b);
  // «أدلة ناقصة» بلا سبب محدّد مرفوضة — لا رفض بلا سبب
  r = await request.post(`/api/platform/verifications/${s.tenant_b}/decide`, {
    headers: op,
    data: { decision: "needs_more" },
  });
  expect(r.status()).toBe(400);
  r = await request.post(`/api/platform/verifications/${s.tenant_b}/decide`, {
    headers: op,
    data: { decision: "verified" },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const decided = (await r.json()) as { request: { status: string; reviewer_name: string } };
  expect(decided.request.status).toBe("verified");
  expect(decided.request.reviewer_name).toBe("طيب — تشغيل");
  for (const id of [s.public_offer_id, s.private_offer_id]) {
    r = await request.post(`/api/market/offers/${id}/publish`, { headers: auth(tb) });
    expect(r.ok(), await r.text()).toBeTruthy();
  }

  // ---- MK-1 / ACC-121 / ACC-150: العام لأي زائر، الخاص لعضو القائمة وحده، والثالثة 404 نفسه
  r = await request.get("/api/public/market/search?q=سكر");
  expect(r.ok()).toBeTruthy();
  const found = ((await r.json()) as { groups: { offers: { id: string }[] }[] }).groups.flatMap(
    (g) => g.offers.map((o) => o.id),
  );
  expect(found).toContain(s.public_offer_id);
  expect(found).not.toContain(s.private_offer_id);
  expect((await request.get(`/api/market/offers/public/${s.private_offer_id}`)).status()).toBe(404);
  expect(
    (
      await request.get(`/api/market/offers/public/${s.private_offer_id}`, { headers: auth(tc) })
    ).status(),
  ).toBe(404);
  r = await request.get(`/api/market/offers/public/${s.private_offer_id}`, { headers: auth(ta) });
  expect(r.ok(), await r.text()).toBeTruthy();
  const priv = (await r.json()) as {
    offer: { tiers: { price_minor: string }[]; price_minor: string };
  };
  expect(priv.offer.tiers[0]?.price_minor).toBe("140000");
  // صفحة المورد العامة: الحقول المنشورة فقط — لا عنوان نشاط ولا مستند سجل
  r = await request.get(`/api/public/market/suppliers/${s.tenant_b}`);
  expect(r.ok()).toBeTruthy();
  const supplierText = await r.text();
  for (const leak of ["business_address", "registry_doc", "service_area_note", "السوق المركزي"]) {
    expect(supplierText, `تسريب ${leak}`).not.toContain(leak);
  }

  // ---- MK-2: طلب 10 بهوية عملية؛ قطع الردّ وإعادة الإرسال = طلب واحد؛ لا دين عند الطلب
  const opId = uuid();
  const orderBody = {
    op_id: opId,
    supplier_tenant_id: s.tenant_b,
    kind: "order",
    lines: [{ offer_id: s.public_offer_id, qty: 10, price_minor: "118000" }],
  };
  const first = await request.post("/api/market/orders", { headers: auth(ta), data: orderBody });
  expect(first.ok(), await first.text()).toBeTruthy();
  const orderId = ((await first.json()) as { order: { id: string } }).order.id;
  // «انقطع الردّ» — العميل لم يرَ الجواب فأعاد الإرسال بالهوية نفسها
  const again = await request.post("/api/market/orders", { headers: auth(ta), data: orderBody });
  expect(again.ok(), await again.text()).toBeTruthy();
  expect(((await again.json()) as { order: { id: string } }).order.id).toBe(orderId);
  r = await request.get("/api/market/orders", { headers: auth(ta) });
  const mine = (await r.json()) as { orders: { id: string }[] };
  expect(mine.orders.filter((o) => o.id === orderId)).toHaveLength(1);
  expect(mine.orders).toHaveLength(1);
  // الثالثة لا ترى الطلب
  expect((await request.get(`/api/market/orders/${orderId}`, { headers: auth(tc) })).status()).toBe(
    404,
  );
  // لا دين عند الطلب: المستحقّ صفر قبل أي استلام
  r = await request.get(`/api/market/orders/${orderId}/payments`, { headers: auth(ta) });
  expect(r.ok(), await r.text()).toBeTruthy();
  expect(((await r.json()) as { due_minor: string }).due_minor).toBe("0");
  // المورد يؤكّد 8 ويرسل؛ المشتري يقبل الإصدار 2
  r = await request.post(`/api/market/orders/${orderId}/quote`, {
    headers: auth(tb),
    data: {
      lines: [{ offer_id: s.public_offer_id, qty_confirmed: 8, price_minor: "118000" }],
      valid_until: inDays(3),
      send: true,
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  r = await request.post(`/api/market/orders/${orderId}/accept`, {
    headers: auth(ta),
    data: { version: 2 },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  r = await request.get(`/api/market/orders/${orderId}/payments`, { headers: auth(ta) });
  expect(((await r.json()) as { due_minor: string }).due_minor).toBe("0"); // الاتفاق ليس ديناً
  // شحن 8 ← استلام 7 بسبب
  r = await request.post(`/api/market/orders/${orderId}/shipments`, {
    headers: auth(tb),
    data: { lines: [{ offer_id: s.public_offer_id, qty: 8 }] },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const shipmentId = ((await r.json()) as { shipments: { id: string }[] }).shipments[0]!.id;
  const receiveBody = {
    shipment_id: shipmentId,
    lines: [
      { offer_id: s.public_offer_id, qty_received: 7, reason: "كرتونة تالفة أُعيدت مع السائق" },
    ],
  };
  r = await request.post(`/api/market/orders/${orderId}/receive`, {
    headers: auth(ta),
    data: receiveBody,
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  // الذمّة من المستلَم وحده: 7 × 118000
  r = await request.get(`/api/market/orders/${orderId}/payments`, { headers: auth(ta) });
  expect(((await r.json()) as { due_minor: string }).due_minor).toBe(String(7 * 118000));
  // لا تكرار استلام للشحنة نفسها
  r = await request.post(`/api/market/orders/${orderId}/receive`, {
    headers: auth(ta),
    data: receiveBody,
  });
  expect(r.status()).toBe(400);
  expect(((await r.json()) as { detail: string }).detail).toBe("already_received");
  r = await request.get(`/api/market/orders/${orderId}/payments`, { headers: auth(ta) });
  expect(((await r.json()) as { due_minor: string }).due_minor).toBe(String(7 * 118000));
  // دفتر المورد يرى الطلب نفسه بقيمة المستلَم لا المشحون
  r = await request.get(`/api/market/orders/${orderId}`, { headers: auth(tb) });
  expect(r.ok()).toBeTruthy();
  const supplierView = (await r.json()) as {
    received_value_minor: string;
    gap_value_minor: string;
  };
  expect(supplierView.received_value_minor).toBe(String(7 * 118000));
  expect(supplierView.gap_value_minor).toBe(String(1 * 118000));

  // ---- ACC-146/147/149: لوحة M0 على السجلّ الحقيقي — فرصة واحدة = «غير حاسم»، ولا بوابة تجارية على البناء
  const month = new Date().toISOString().slice(0, 7);
  r = await request.post("/api/platform/m0", { headers: op, data: { month } });
  expect(r.ok(), await r.text()).toBeTruthy();
  const m0 = (await r.json()) as {
    state: string;
    snapshot: {
      targets: {
        opportunities: number;
        conclusive: boolean;
        mediation: number;
        avg_accept_minutes: number | null;
      };
      stages: { key: string; value: number; ratio: string }[];
      trade: { executed_value_minor: string; disputed_count: number };
    };
  };
  expect(m0.state).toBe("empty");
  expect(m0.snapshot.targets.opportunities).toBe(1);
  expect(m0.snapshot.targets.conclusive).toBe(false);
  expect(m0.snapshot.targets.avg_accept_minutes).not.toBeNull();
  const paid = m0.snapshot.stages.find((x) => x.key === "paid");
  expect(paid?.ratio).not.toMatch(/الزيارات/);
  // قيمة التجارة مرة واحدة: الطلب لم يُنفَّذ بالكامل بعد (استلام جزئي لطلب في حالة «استُلم»/«سُلِّم»)
  expect(Number(m0.snapshot.trade.executed_value_minor)).toBeLessThanOrEqual(7 * 118000);
});
