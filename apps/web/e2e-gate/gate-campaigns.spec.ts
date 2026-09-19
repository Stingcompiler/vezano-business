import { type APIRequestContext, expect, test } from "@playwright/test";

import { OWNER, resetScenario } from "./fixtures";

/**
 * بوابة المرحلة ٢ — NOT (§١٥.٤ «اشتراك إشعارات»): زبون يشترك بمحلين ثم يلغي قناة أحدهما → يبقى
 * مشترِكاً بالثاني فقط دون اطلاع على بيانات المحل الآخر (ACC-105)؛ إلغاء حملة أو تفضيل بعد الجدولة
 * وقبل الإرسال → يُعاد التحقق قبل المحاولة ولا نشر لاحق يتجاهل الإلغاء (ACC-109). على Django
 * الحقيقي عبر الـAPI بجلستي حساب (المالك عضو في المنشأتين).
 */
const SHARED = { name: "زبون بمحلين — تجريبي", phone: "+249912000777" };

/** حساب بعدة عضويات (ACC-02/03): الدخول يعيد تذكرة اختيار، ثم `select` بالعضوية يعطي جلسة المنشأة. */
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

test("ACC-105/109 — زبون بمحلين يلغي قناة أحدهما؛ إلغاء الحملة والتفضيل بعد الجدولة يُحترمان قبل كل محاولة", async ({
  request,
}) => {
  const s = await resetScenario(request);
  // باقة «فرعان» للمنشأة أ (الحملات ميزتها)؛ الزبون يشترك في المحلين
  expect(
    (
      await request.post("/api/scenario/subscription", {
        data: { state: "active", plan_code: "dual" },
      })
    ).ok(),
  ).toBeTruthy();
  for (const tenant of ["a", "b"] as const) {
    const r = await request.post("/api/scenario/marketing", {
      data: { tenant, ...SHARED, consent: true },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  const ta = await tokenFor(request, s.tenant_a);
  const tb = await tokenFor(request, s.tenant_b);
  const preview = async (t: string, extra: Record<string, unknown> = {}) => {
    const r = await request.post("/api/campaigns/preview", {
      headers: auth(t),
      data: {
        message: "عرض — بقالة النيل — تجريبي",
        audience: { segments: ["subscribed"] },
        ...extra,
      },
    });
    return { status: r.status(), body: (await r.json()) as Record<string, unknown> };
  };
  // ACC-105: مشترك في المحلين
  const a1 = await preview(ta);
  expect(a1.status).toBe(200);
  expect((a1.body.audience as { eligible: number }).eligible).toBe(1);
  const b1 = await request.post("/api/campaigns/preview", {
    headers: auth(tb),
    data: { message: "عرض — مخزن البركة — تجريبي", audience: { segments: ["subscribed"] } },
  });
  expect(b1.status()).toBe(200);
  const b1body = (await b1.json()) as { audience: { eligible: number; party_ids: string[] } };
  expect(b1body.audience.eligible).toBe(1);
  // يلغي قناة المحل «ب» → يبقى في «أ» وحده، ولا تكشف «ب» شيئاً عن «أ»
  const off = await request.post("/api/scenario/marketing", {
    data: { tenant: "b", ...SHARED, consent: false },
  });
  expect(off.ok()).toBeTruthy();
  const b2 = await request.post("/api/campaigns/preview", {
    headers: auth(tb),
    data: { message: "عرض — مخزن البركة — تجريبي", audience: { segments: ["subscribed"] } },
  });
  const b2body = (await b2.json()) as {
    audience: { eligible: number; excluded_opt_out: number; party_ids: string[] };
  };
  expect(b2body.audience.eligible).toBe(0);
  expect(b2body.audience.excluded_opt_out).toBe(1);
  const a2 = await preview(ta);
  expect((a2.body.audience as { eligible: number }).eligible).toBe(1);
  // جمهور «ب» لا يظهر في «أ»: طرف «ب» بمعرّفه يُرفض في «أ» بلا تسريب عدد ولا اسم (ACC-103)
  const bParty = (
    (await (
      await request.post("/api/scenario/marketing", {
        data: { tenant: "b", ...SHARED, consent: false },
      })
    ).json()) as { id: string }
  ).id;
  const leak = await preview(ta, { audience: { segments: ["subscribed"], party_ids: [bParty] } });
  expect(leak.status).toBe(400);
  expect(leak.body.detail).toBe("audience_out_of_tenant");
  expect(JSON.stringify(leak.body)).not.toContain(SHARED.phone);

  // ACC-109 (أ): إلغاء الحملة بعد الجدولة وقبل الإرسال — العامل اللاحق لا يرسلها
  const create = await request.post("/api/campaigns", {
    headers: auth(ta),
    data: {
      name: "حملة تُلغى",
      message: "عرض — بقالة النيل — تجريبي",
      audience: { segments: ["subscribed"] },
    },
  });
  expect(create.status()).toBe(201);
  const cid = ((await create.json()) as { campaign: { id: string } }).campaign.id;
  const soon = new Date(Date.now() - 60_000).toISOString(); // حان وقتها — سيرسلها العامل عند أول جلب
  const approve = await request.post(`/api/campaigns/${cid}/approve`, {
    headers: auth(ta),
    data: { scheduled_at: soon, night_confirmed: true }, // الإرسال الليلي يحتاج تأكيداً صريحاً — CI يعمل في أي ساعة
  });
  expect(approve.status(), await approve.text()).toBe(200);
  expect(((await approve.json()) as { campaign: { status: string } }).campaign.status).toBe(
    "scheduled",
  );
  const cancel = await request.post(`/api/campaigns/${cid}/cancel`, {
    headers: auth(ta),
    data: {},
  });
  expect(cancel.status()).toBe(200);
  // العامل الكسول يعمل عند الجلب — الملغاة لا تُرسل ولا تُحتسب
  const list = await request.get("/api/campaigns", { headers: auth(ta) });
  const listBody = (await list.json()) as {
    campaigns: { id: string; status: string; results: { sent: number; cancelled: number } }[];
    quota: { used: number };
  };
  const cancelled = listBody.campaigns.find((c) => c.id === cid)!;
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.results.sent).toBe(0);
  expect(cancelled.results.cancelled).toBe(1);
  expect(listBody.quota.used).toBe(0);

  // ACC-109 (ب): تفضيل أُلغي بعد الجدولة — يُعاد التحقق قبل المحاولة فلا يُرسل للمُلغي
  const create2 = await request.post("/api/campaigns", {
    headers: auth(ta),
    data: {
      name: "حملة بعد الإلغاء",
      message: "عرض — بقالة النيل — تجريبي",
      audience: { segments: ["subscribed"] },
    },
  });
  const cid2 = ((await create2.json()) as { campaign: { id: string } }).campaign.id;
  const approve2 = await request.post(`/api/campaigns/${cid2}/approve`, {
    headers: auth(ta),
    data: { scheduled_at: soon, night_confirmed: true }, // الإرسال الليلي يحتاج تأكيداً صريحاً — CI يعمل في أي ساعة
  });
  expect(approve2.status(), await approve2.text()).toBe(200);
  expect(
    (
      await request.post("/api/scenario/marketing", {
        data: { tenant: "a", ...SHARED, consent: false },
      })
    ).ok(),
  ).toBeTruthy();
  const detail = await request.get(`/api/campaigns/${cid2}`, { headers: auth(ta) });
  const d = (await detail.json()) as {
    campaign: { status: string; results: { sent: number; opted_out: number } };
  };
  expect(d.campaign.status).toBe("done");
  expect(d.campaign.results.sent).toBe(0);
  expect(d.campaign.results.opted_out).toBe(1);
});
