import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.23 — PTY-03 (6) + PTY-04 (4). البطاقة: الشخص عميل ومورد معاً برصيدين منفصلين بلا مقاصة
 * تلقائية (ACC-28)؛ الاسم فقط إلزامي؛ الكاشير يُنشئ ولا يعدّل؛ التقارب يُعرض ولا يُدمج بالاسم
 * (ACC-131). الافتتاحي: للمالك وحده، بسبب، مرة واحدة وقبل أول حركة، بلا «عمر دين» (ACC-79).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
};

const card = (over: Record<string, unknown> = {}) => ({
  id: "p3",
  name: "خالد إبراهيم — تجريبي",
  name_normalized: "خالد ابراهيم — تجريبي",
  phone: "0918333902",
  aliases: [] as string[],
  note: "يشتري بالتجزئة، ويورّدنا بيضاً أسبوعياً",
  credit_limit_minor: "60000",
  is_customer: true,
  is_supplier: true,
  distinct_from_id: "",
  balance_minor: "34000",
  balance_as_of: daysAgo(0),
  last_sale_at: daysAgo(8),
  last_movement_at: daysAgo(8),
  supplier_owed_minor: "115000",
  market_linked: false,
  is_active: true,
  deactivated_at: "",
  updated_at: daysAgo(8),
  can_edit: true,
  can_open_balance: true,
  has_movements: false,
  opening_balances: [] as unknown[],
  potential_duplicates: [] as unknown[],
  ...over,
});

async function seed(page: Page) {
  await page.goto("/welcome");
  await page.evaluate(async () => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    await new Promise<void>((res) => {
      const tx = db.transaction(["meta"], "readwrite");
      const meta = tx.objectStore("meta");
      meta.put({
        key: "device.registration",
        value: JSON.stringify({ deviceId: "d1", prefix: "A2", branchId: "b1", branchCode: "KRT" }),
      });
      meta.put({ key: "sync_epoch", value: "epoch-A" });
      meta.put({
        key: "shift.context",
        value: JSON.stringify({
          branchId: "b1",
          branchName: "الفرع الرئيسي",
          branchCode: "KRT",
          deviceId: "d1",
          deviceName: "مكتب",
          devicePrefix: "A2",
          userId: "u1",
          userName: "سالم",
          roleName: "مالك",
          roleCode: "owner",
        }),
      });
      tx.oncomplete = () => res();
    });
    db.close();
  });
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

function cardRoute(page: Page, body: unknown) {
  return page.route("**/api/parties/p3", (route) =>
    route.request().method() === "GET" ? route.fulfill(json(200, body)) : route.fallback(),
  );
}

test.describe("PTY-03", () => {
  test("ready → saving → success: عميل ومورد معاً برصيدين منفصلين، والتعديل يُحفظ", async ({
    page,
  }, info) => {
    await seed(page);
    await cardRoute(page, card());
    const patched: unknown[] = [];
    await page.route("**/api/parties/p3", async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      patched.push(JSON.parse(route.request().postData() ?? "{}"));
      await new Promise((r) => setTimeout(r, 2500));
      return route.fulfill(json(200, card({ aliases: ["أبو أحمد"] })));
    });
    await login(page, "/parties/p3");
    await expectFrame(page, info, {
      screenId: "PTY-03",
      state: "ready",
      texts: fromFrame("PTY-03", "ready", [
        "بطاقة طرف — الشخص عميل ومورد معاً",
        "رصيدان منفصلان بلا مقاصة تلقائية. ACC-28.",
        "خالد إبراهيم — تجريبي",
        "يشتري بالتجزئة، ويورّدنا بيضاً أسبوعياً",
        "عميل",
        "مورد",
        "بصفته عميلاً — عليه لنا",
        "340.00",
        "آخر بيع",
        "حد ائتمان مرن",
        "600.00",
        "— ينبّه عند التجاوز ولا يمنع البيع",
        "كشف حساب العميل",
        "بصفته مورداً — له علينا",
        "1,150.00",
        "كشف حساب المورد",
        "لا مقاصة تلقائية.",
        "الرصيدان مستقلان في دفترين. إن اتفقتَ معه على خصم دينه من مستحقاته، سجّل ذلك بمستندَي سداد متقابلين بسبب واضح — لا يجري النظام المقاصة نيابة عنك.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await page.getByRole("button", { name: "تعديل البطاقة" }).click();
    // الاسم فقط إلزامي
    await page.getByLabel("الاسم").fill("");
    await page.getByRole("button", { name: "حفظ البطاقة" }).click();
    await expect(page.locator('[data-screen="PTY-03"]')).toHaveAttribute(
      "data-state",
      "validation_error",
    );
    expect(patched).toHaveLength(0);
    await page.getByLabel("الاسم").fill("خالد إبراهيم — تجريبي");
    await page.getByLabel("أسماء بديلة").fill("أبو أحمد");
    await page.getByRole("button", { name: "حفظ البطاقة" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-03",
      state: "saving",
      texts: fromFrame("PTY-03", "saving", [
        "جارٍ الحفظ",
        "حفظٌ قصير. الأزرار معطّلة ولا تُغلق البطاقة.",
      ]),
    });
    await expect(page.getByRole("button", { name: "إلغاء" })).toBeDisabled();
    await expectFrame(page, info, {
      screenId: "PTY-03",
      state: "success",
      texts: fromFrame("PTY-03", "success", [
        "حُفظت البطاقة",
        "نقول ما صار ممكناً: البيع الآجل له، والكشف، والسداد. أما رصيده الافتتاحي فبابه PTY-04.",
        "لا رصيد ضمنياً",
        "إنشاء الطرف لا يُنشئ رصيداً. الرصيد الافتتاحي مستندٌ له شاشته وصلاحيته.",
      ]),
    });
    expect(patched[0]).toMatchObject({
      name: "خالد إبراهيم — تجريبي",
      aliases: ["أبو أحمد"],
      credit_limit_minor: "60000",
      is_customer: true,
      is_supplier: true,
    });
    await expect(page.locator('[data-screen="PTY-03"]')).toContainText("أبو أحمد");
  });

  test("permission_denied: الكاشير يُنشئ ولا يعدّل", async ({ page }, info) => {
    await seed(page);
    await cardRoute(page, card({ can_edit: false, can_open_balance: false }));
    await login(page, "/parties/p3");
    await page.getByRole("button", { name: "تعديل البطاقة" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-03",
      state: "permission_denied",
      texts: fromFrame("PTY-03", "permission_denied", [
        "الكاشير يُنشئ ولا يعدّل",
        "يُنشئ طرفاً سريعاً وقت البيع، ولا يعدّل بطاقة قائمة ولا حدّه الآجل.",
        "لماذا",
        "تعديل البطاقة يمسّ طرفاً له دفتر. والإنشاء السريع حاجةُ لحظة البيع.",
      ]),
    });
    await expect(page.getByRole("button", { name: "رصيد افتتاحي" })).toBeDisabled();
  });

  test("conflict: طرفان باسم متقارب — لا دمج بالاسم، و«منفصلان» قرار صريح", async ({
    page,
  }, info) => {
    await seed(page);
    await cardRoute(
      page,
      card({
        name: "مطعم الواحة — تجريبي",
        potential_duplicates: [
          { id: "p9", name: "مطعم الواحه — تجريبي", phone: "0923555771", balance_minor: "120000" },
        ],
      }),
    );
    const marked: string[] = [];
    await page.route("**/api/parties/p9/distinct", (route) => {
      marked.push(
        String((JSON.parse(route.request().postData() ?? "{}") as { other_id: string }).other_id),
      );
      return route.fulfill(json(200, { distinct_from_id: "p3" }));
    });
    await login(page, "/parties/p3");
    await page.getByRole("button", { name: /تكرار محتمل/ }).click();
    await expectFrame(page, info, {
      screenId: "PTY-03",
      state: "conflict",
      texts: fromFrame("PTY-03", "conflict", [
        "طرفان باسم متقارب",
        "لا نقترح الدمج ولا نفعله تلقائياً.",
        "مطعم الواحه — تجريبي",
        "وسمهما «مراجَعان ومنفصلان»",
        "دمج بتأكيد مزدوج",
        "لا دمج بالاسم",
        "التقارب ليس دليل هوية (ACC-131). القرار للمستخدم والدمج له شاشته (PTY-07).",
      ]),
    });
    await expect(page.getByRole("button", { name: "دمج بتأكيد مزدوج" })).toBeDisabled();
    await page.getByRole("button", { name: "وسمهما «مراجَعان ومنفصلان»" }).click();
    await expect(page.locator('[data-screen="PTY-03"]')).toHaveAttribute("data-state", "ready");
    expect(marked).toEqual(["p3"]);
  });
});

test.describe("PTY-04", () => {
  test("ready → success: جهة الدين والمبلغ والسبب ومعاينة الأثر، ثم سُجّل الافتتاحي", async ({
    page,
  }, info) => {
    await seed(page);
    await cardRoute(
      page,
      card({
        id: "p3",
        name: "فاطمة حسن — تجريبي",
        balance_minor: "64000",
        supplier_owed_minor: "0",
      }),
    );
    const posted: unknown[] = [];
    await page.route("**/api/parties/p3/opening-balance", (route) => {
      posted.push(JSON.parse(route.request().postData() ?? "{}"));
      return route.fulfill(
        json(201, {
          opening: { side: "customer_due", amount_minor: "85000", business_date: "" },
          party: card({ name: "فاطمة حسن — تجريبي", balance_minor: "149000" }),
        }),
      );
    });
    await login(page, "/parties/p3/opening");
    await expectFrame(page, info, {
      screenId: "PTY-04",
      state: "ready",
      texts: fromFrame("PTY-04", "ready", [
        "رصيد افتتاحي — فاطمة حسن — تجريبي",
        "لتسجيل دين قائم قبل استخدام النظام",
        "جهة الدين",
        "عليها لنا",
        "لها علينا",
        "المبلغ",
        "العملة",
        "الجنيه السوداني — عملة المنشأة، غير قابلة للتبديل",
        "السبب — إلزامي",
        "معاينة الأثر قبل الحفظ",
        "رصيدها الآن",
        "640.00",
        "يضاف افتتاحياً",
        "بعد الحفظ",
        "الرصيد الافتتاحي بند واحد بلا فواتير خلفه. لن يظهر له «عمر دين» في التقارير، لأن النظام لا يخترع تواريخ فواتير غير موجودة.",
        "حفظ الرصيد الافتتاحي",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    // السبب إلزامي — لا طلب
    await page.getByLabel("المبلغ").fill("850");
    await page.getByRole("button", { name: "حفظ الرصيد الافتتاحي" }).click();
    await expect(page.locator('[data-screen="PTY-04"]')).toHaveAttribute(
      "data-state",
      "validation_error",
    );
    expect(posted).toHaveLength(0);
    const root = page.locator('[data-screen="PTY-04"]');
    await expect(root).toContainText("850.00");
    await expect(root).toContainText("1,490.00");
    await page.getByLabel("السبب — إلزامي").fill("دين قائم قبل استخدام النظام — دفتر 2024");
    await page.getByRole("button", { name: "حفظ الرصيد الافتتاحي" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-04",
      state: "success",
      texts: fromFrame("PTY-04", "success", [
        "سُجّل الافتتاحي",
        "المبلغ وجهته (عليه أو له) وتاريخه ومستنده المرجعي إن كُتب.",
        "يظهر أول الكشف",
        "سطراً مسمّى «رصيد افتتاحي» لا مندساً بين الفواتير. من يقرأ الكشف يحتاج أن يعرف من أين بدأ.",
        "لا أعمار منه",
        "الافتتاحي بلا فواتير يُسنَد إليها، فلا يُحتسب في أعمار الدين (ACC-79).",
        "عليها لنا",
      ]),
    });
    expect(posted[0]).toMatchObject({
      side: "customer_due",
      amount_minor: "85000",
      reason: "دين قائم قبل استخدام النظام — دفتر 2024",
      business_date: null,
    });
    await expect(root).toContainText("قبل النظام");
  });

  test("validation_error: رصيد على طرف له حركات — الافتتاحي مرة واحدة وقبل أول حركة", async ({
    page,
  }, info) => {
    await seed(page);
    await cardRoute(page, card({ has_movements: true }));
    await login(page, "/parties/p3/opening");
    await expectFrame(page, info, {
      screenId: "PTY-04",
      state: "validation_error",
      texts: fromFrame("PTY-04", "validation_error", [
        "رصيد على طرف له حركات",
        "الطرف عليه فواتير مسجّلة، وإدخال رصيد افتتاحي الآن يُحرّف تاريخه.",
        "الافتتاحي مرة واحدة",
        "وقبل أول حركة. بعدها التصحيح بحركة معلَّلة لا برصيد افتتاحي ثانٍ — وإلا ضاع الفرق بين ما كان وما صار.",
        "المخرج",
        "حركة تسوية بسبب مكتوب، أو تصحيح تاريخ الأعمال (PTY-09) إن كان الخطأ في التاريخ لا المبلغ.",
      ]),
    });
    await expect(page.getByRole("button", { name: "حفظ الرصيد الافتتاحي" })).toBeDisabled();
  });

  test("permission_denied: الافتتاحي للمالك — لا استثناء", async ({ page }, info) => {
    await seed(page);
    await cardRoute(page, card({ can_open_balance: false }));
    await login(page, "/parties/p3/opening");
    await expectFrame(page, info, {
      screenId: "PTY-04",
      state: "permission_denied",
      texts: fromFrame("PTY-04", "permission_denied", [
        "الافتتاحي للمالك",
        "يُنشئ ذمّةً بلا فاتورة — إقرارٌ مالي محض.",
        "لا استثناء",
        "ولا للمحاسب في الإصدار الأول. الرقم بلا مستند يُراجَع من مالكه.",
      ]),
    });
    await expect(page.getByRole("button", { name: "حفظ الرصيد الافتتاحي" })).toBeDisabled();
  });
});
