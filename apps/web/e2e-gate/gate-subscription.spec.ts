import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  addSugar,
  newDevice,
  openShift,
  OWNER,
  pickCustomer,
  resetScenario,
  saveCash,
  saveCredit,
  setFault,
  SHOP,
  statement,
  syncNow,
} from "./fixtures";

/**
 * بوابة المرحلة ٢ — الاشتراك (§١١.٢، §١٥.٤): ACC-80 انتهاء الاشتراك → البيع المحلي والحقوق
 * الأساسية مستمرة (نقدي وآجل وكشف الحساب وتصديره)؛ ACC-81 انتهاء مع جهاز بديل → التسجيل متاح خلال
 * المهلة ولا حجب للبيانات، وبعدها يُرفض بسببه لا بصمت؛ ACC-82 تخفيض باقة ووحدة لها تاريخ ومعلّق →
 * لا محو ولا ضياع رفع، والحملة الجديدة تُمنع بسبب معلَن والسجل يبقى مقروءاً. على Django الحقيقي.
 */
async function ownerToken(request: APIRequestContext, tenantId: string): Promise<string> {
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

async function subscription(
  request: APIRequestContext,
  data: { state: string; days_since_expiry?: number; plan_code?: string },
) {
  const r = await request.post("/api/scenario/subscription", { data });
  expect(r.ok(), await r.text()).toBeTruthy();
}

test.describe("البوابة — الاشتراك", () => {
  test("ACC-80/81 — اشتراك منتهٍ منذ 20 يوماً: جهاز بديل يُسجَّل ويبيع نقداً وآجلاً ويصدّر الكشف؛ ومنذ 35 يوماً يُرفض تسجيل جهاز جديد بسببه", async ({
    browser,
    request,
  }) => {
    const s = await resetScenario(request);
    await subscription(request, { state: "expired", days_since_expiry: 20, plan_code: "dual" });
    // الجهاز البديل: التسجيل والتنزيل الأول يعملان بعد الانتهاء (المهلة ثم إيقاف الأجهزة الجديدة بعد 31 يوماً)
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await addSugar(a.page, "1");
    const number = await saveCash(a.page);
    expect(number).toMatch(/^INV-/);
    await addSugar(a.page, "1");
    await pickCustomer(a.page);
    await saveCredit(a.page);
    await syncNow(a.page);
    // الدين 100 على الكشف والتصدير متاح — «تصدير كامل في أي وقت، وحتى بعد انتهاء الاشتراك»
    const st = await statement(a.page);
    expect(st).toContain("100.00");
    const t = await ownerToken(request, s.tenant_a);
    const exp = await request.post(`/api/parties/${s.initial_state.customer.id}/statement/export`, {
      headers: auth(t),
      data: { kind: "link", range: "30" },
    });
    expect(exp.status(), await exp.text()).toBe(201);
    const link = ((await exp.json()) as { export: { url: string } }).export.url;
    const doc = await request.get(link);
    expect(doc.ok()).toBeTruthy();
    expect(await doc.text()).toContain("100.00");
    // الاشتراك يقول حالته بلا إخفاء
    const sub = await request.get("/api/org/subscription", { headers: auth(t) });
    expect(sub.ok()).toBeTruthy();
    expect(await sub.text()).toContain('"expired"');
    // منذ 35 يوماً: لا جهاز جديد — يُرفض بسبب معلَن، والجهاز القائم يواصل البيع
    await subscription(request, { state: "expired", days_since_expiry: 35, plan_code: "dual" });
    const reg = await request.post("/api/devices/register", {
      headers: auth(t),
      data: { name: "جهاز بديل ثانٍ" },
    });
    expect(reg.status()).toBe(403);
    expect(((await reg.json()) as { detail: string }).detail).toBe("subscription_expired");
    await addSugar(a.page, "1");
    const again = await saveCash(a.page);
    expect(again).toMatch(/^INV-/);
    await syncNow(a.page);
    await a.context.close();
  });

  test("ACC-82 — تخفيض «فرعان» إلى «فرع واحد» مع حملة سابقة ومعلّق: لا محو ولا ضياع رفع؛ الحملة الجديدة تُمنع بسببها والسجل يبقى", async ({
    browser,
    request,
  }) => {
    const s = await resetScenario(request);
    await subscription(request, { state: "active", plan_code: "dual" });
    const r = await request.post("/api/scenario/marketing", {
      data: { tenant: "a", name: "زبون مشترك — تجريبي", phone: "+249912000555", consent: true },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    const t = await ownerToken(request, s.tenant_a);
    // حملة مسودة تحت «فرعان»
    const save = await request.post("/api/campaigns", {
      headers: auth(t),
      data: {
        name: "عرض الأسبوع",
        message: `عرض — ${SHOP}`,
        audience: { segments: ["subscribed"] },
      },
    });
    expect(save.status(), await save.text()).toBe(201);
    const cid = ((await save.json()) as { campaign: { id: string } }).campaign.id;
    // جهاز يبيع ثم يُقطع رفعه (معلّق) قبل التخفيض
    const a = await newDevice(browser, "A");
    await openShift(a.page);
    await setFault(request, "freeze_reconciliation", true);
    await addSugar(a.page, "1");
    const number = await saveCash(a.page);
    // التخفيض
    await subscription(request, { state: "active", plan_code: "single" });
    // السجل مقروء والحملة الجديدة تُمنع بسبب معلَن
    const list = await request.get("/api/campaigns", { headers: auth(t) });
    expect(list.ok()).toBeTruthy();
    expect(await list.text()).toContain(cid);
    const pv = await request.post("/api/campaigns/preview", {
      headers: auth(t),
      data: { message: `عرض — ${SHOP}`, audience: { segments: ["subscribed"] } },
    });
    expect(pv.status()).toBe(200);
    const codes = ((await pv.json()) as { blockers: { code: string }[] }).blockers.map(
      (b) => b.code,
    );
    expect(codes).toContain("feature_unavailable");
    // المعلّق يُرفع بعد التخفيض بلا ضياع
    await setFault(request, "freeze_reconciliation", false);
    await syncNow(a.page);
    const inv = await request.get("/api/sales", { headers: auth(t) });
    expect(await inv.text()).toContain(number);
    await a.context.close();
  });
});
