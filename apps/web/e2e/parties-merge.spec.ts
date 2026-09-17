import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.26 — PTY-07 دمج أطراف (5) + PTY-09 تصحيح تاريخ الأعمال (4). الدمج خريطة هوية لا إعادة كتابة
 * (ACC-78): معاينة الأثر ثم تأكيد مزدوج بكلمة؛ للمالك؛ الدليل ضد الدمج (رقمان مختلفان) يعرض البديل؛
 * قرار دمج سابق = تعارض. التصحيح مستند مستقل بسبب: الأصل لا يتغير؛ الفترة المقفلة تُمنع بسبب؛
 * الأثر يُعلَن.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function seed(page: Page, role: "owner" | "manager" = "owner") {
  await page.goto("/welcome");
  await page.evaluate(async (role) => {
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
          userName: role === "owner" ? "سالم" : "هالة",
          roleName: role === "owner" ? "مالك" : "مدير فرع",
          roleCode: role,
        }),
      });
      tx.oncomplete = () => res();
    });
    db.close();
  }, role);
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

const side = (over: Record<string, unknown>) => ({
  id: "p1",
  name: "أحمد الطيب محمد",
  phone: "0912555447",
  balance_minor: "6000",
  movements: 4,
  merged_into: "",
  is_customer: true,
  is_supplier: false,
  is_active: true,
  updated_at: "2026-09-16T10:00:00Z",
  ...over,
});

const preview = (over: Record<string, unknown> = {}) => ({
  source: side({}),
  target: side({ id: "p2", name: "أحمد الطيب — تجريبي", balance_minor: "18000", movements: 11 }),
  movements_after: 15,
  balance_after_minor: "24000",
  phones_differ: false,
  ...over,
});

const MERGE = "/parties/p1/merge?target=p2";

/** بطاقة الهدف (PTY-03) بمكرَّر محتمل هو المصدر. */
const targetCard = () => ({
  ...side({ id: "p2", name: "أحمد الطيب — تجريبي" }),
  aliases: [],
  note: "",
  credit_limit_minor: "0",
  supplier_owed_minor: "",
  last_movement_at: "",
  can_edit: true,
  can_open_balance: true,
  has_movements: true,
  opening_balances: [],
  potential_duplicates: [
    { id: "p1", name: "أحمد الطيب محمد", phone: "0912555447", balance_minor: "6000" },
  ],
});

function targetCardRoute(page: Page) {
  return page.route("**/api/parties/p2", (route) =>
    route.request().method() === "GET" ? route.fulfill(json(200, targetCard())) : route.fallback(),
  );
}

function mergeRoute(page: Page, get: unknown, getStatus = 200) {
  return page.route("**/api/parties/p1/merge?target=p2", (route) =>
    route.fulfill(json(getStatus, get)),
  );
}

test.describe("PTY-07", () => {
  test("ready → success: معاينة الأثر ثم تأكيد مزدوج بكلمة — دُمج الطرفان والتراجع محدود", async ({
    page,
  }, info) => {
    await seed(page);
    await mergeRoute(page, preview());
    const posted: Record<string, unknown>[] = [];
    await page.route("**/api/parties/p1/merge", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posted.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      return route.fulfill(
        json(201, {
          merge: { id: "m1", occurred_at: "2026-09-17T09:00:00Z" },
          source: side({ merged_into: "p2" }),
          target: side({ id: "p2", name: "أحمد الطيب — تجريبي", balance_minor: "24000" }),
        }),
      );
    });
    await login(page, MERGE);
    await expectFrame(page, info, {
      screenId: "PTY-07",
      state: "ready",
      texts: fromFrame("PTY-07", "ready", [
        "دمج طرفين مكررين",
        "الدمج لا يُلغى بسهولة — راجع المعاينة بدقة",
        "المصدر — يُدمج ويختفي",
        "أحمد الطيب محمد",
        "0912 ••• 447",
        "4 حركات · عليه",
        "60.00",
        "الهدف — يبقى",
        "أحمد الطيب — تجريبي",
        "11 حركة · عليه",
        "180.00",
        "معاينة الأثر",
        "الحركات بعد الدمج",
        "15",
        "الرصيد المجمّع",
        "240.00",
        "المستندات القديمة",
        "تبقى بأسمائها الأصلية — لا تُعاد كتابتها",
        "الأحداث المتأخرة.",
        "إن وصل من جهاز غير متصل سدادٌ مسجَّل باسم المصدر بعد الدمج، تُوجّهه خريطة الهوية إلى الهدف تلقائياً ويظهر في كشفه موسوماً بمصدره. لا يُفقد ولا يُنشئ طرفاً جديداً.",
        "تأكيد الدمج",
        "إلغاء",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="PTY-07"]');
    await expect(root).toContainText("4 حركات · عليه 60.00");
    await expect(root).toContainText("11 حركة · عليه 180.00");
    await page.getByLabel("السبب").fill("نفس الشخص — رقمان لعميل واحد");
    await page.getByRole("button", { name: "تأكيد الدمج" }).click();
    // التأكيد الثاني: كلمة تُكتب — الزر معطّل قبلها
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "تأكيد الدمج" })).toBeDisabled();
    await dialog.getByRole("textbox").fill("دمج");
    await dialog.getByRole("button", { name: "تأكيد الدمج" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-07",
      state: "success",
      texts: fromFrame("PTY-07", "success", [
        "دُمج الطرفان",
        "رصيدٌ واحد وكشفٌ واحد، والطرف الممحوّ يبقى مرئياً في السجل بإشارةٍ إلى وارثه.",
        "التراجع محدود",
        "ممكن ما لم تُسجَّل حركة جديدة على المدموج.",
        "الهدف — يبقى",
        "الرصيد المجمّع",
        "240.00",
        "المصدر — يُدمج ويختفي",
      ]),
    });
    expect(posted).toEqual([
      { target_id: "p2", confirm: "MERGE", reason: "نفس الشخص — رقمان لعميل واحد" },
    ]);
    // المدموج يختفي من القوائم المحلية والوارث برصيده المجمّع
    const local = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const rows = await new Promise<{ key: string; value: { merged_into?: string } }[]>((res) => {
        const r = db.transaction("projections").objectStore("projections").getAll();
        r.onsuccess = () => res(r.result as { key: string; value: { merged_into?: string } }[]);
      });
      db.close();
      return rows
        .filter((r) => r.key.startsWith("entity:parties.Party:"))
        .map((r) => [r.key.slice(21), r.value.merged_into ?? ""]);
    });
    expect(local).toEqual([
      ["p1", "p2"],
      ["p2", ""],
    ]);
  });

  test("validation_error: رقمان مختلفان — الدليل ضد الدمج والبديل «مراجَعان ومنفصلان»", async ({
    page,
  }, info) => {
    await seed(page);
    await mergeRoute(
      page,
      preview({
        source: side({ phone: "0918222110" }),
        phones_differ: true,
      }),
    );
    const marked: Record<string, unknown>[] = [];
    await page.route("**/api/parties/p1/distinct", (route) => {
      marked.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      return route.fulfill(json(200, { distinct_from_id: "p2" }));
    });
    await targetCardRoute(page);
    await login(page, MERGE);
    await expectFrame(page, info, {
      screenId: "PTY-07",
      state: "validation_error",
      texts: fromFrame("PTY-07", "validation_error", [
        "دمج طرفين بأرقام وعناوين مختلفة",
        "الاسمان متقاربان والدليل ضد الدمج لا معه: رقمان مختلفان وعنوانان.",
        "نعرض الدليل",
        "لا نقترح الدمج ولا نفعله تلقائياً. لو كانا شخصين لطالبتَ أحدهما بدين غيره.",
        "البديل المعروض",
        "«وسمهما مراجَعان ومنفصلان» — يُسكت التنبيه بلا دمج، وهو الصواب في أغلب الحالات.",
        "0912 ••• 447",
        "تأكيد الدمج",
      ]),
    });
    // الدليل معروض: رقمان مختلفان
    await expect(page.locator('[data-screen="PTY-07"]')).toContainText("0918 ••• 110");
    // الدمج يبقى ممكناً بقرار صريح — لا نمنعه، نعرض الدليل
    await expect(page.getByRole("button", { name: "تأكيد الدمج" })).toBeEnabled();
    await page.getByRole("button", { name: "وسمهما «مراجَعان ومنفصلان»" }).click();
    await expect(page).toHaveURL(/\/parties\/p2$/);
    expect(marked).toEqual([{ other_id: "p2" }]);
  });

  test("permission_denied: الدمج للمالك — حتى بالتأكيد المزدوج", async ({ page }, info) => {
    await seed(page, "manager");
    await mergeRoute(page, { detail: "owner_required" }, 403);
    await login(page, MERGE);
    await expectFrame(page, info, {
      screenId: "PTY-07",
      state: "permission_denied",
      texts: fromFrame("PTY-07", "permission_denied", [
        "الدمج للمالك",
        "يوحّد دفترين ماليين. لا مدير فرع ولا محاسب.",
        "حتى بالتأكيد المزدوج",
        "الصلاحية قبل التأكيد لا بدلاً منه.",
      ]),
    });
    await expect(page.getByRole("button", { name: "تأكيد الدمج" })).toHaveCount(0);
  });

  test("conflict: قرار دمج سابق — الحركات المتأخرة تُوجَّه بخريطة الهوية لا بإعادة كتابة", async ({
    page,
  }, info) => {
    await seed(page);
    await mergeRoute(page, preview({ source: side({ merged_into: "p7" }) }));
    await login(page, MERGE);
    await expectFrame(page, info, {
      screenId: "PTY-07",
      state: "conflict",
      texts: fromFrame("PTY-07", "conflict", [
        "حركات متأخرة على الطرف الممحوّ",
        "وصلت فاتورة من جهاز غير مزامن على الطرف الذي دُمج.",
        "خريطة هوية لا إعادة كتابة",
        "الحركة المتأخرة تُوجَّه إلى الطرف الباقي بخريطةٍ تحفظ هويتها الأصلية (ACC-78) — لا نُعيد كتابة حركة مضت.",
      ]),
    });
    await expect(page.getByRole("button", { name: "تأكيد الدمج" })).toBeDisabled();
  });

  test("من PTY-03: «دمج بتأكيد مزدوج» يفتح PTY-07 بالمصدر والهدف", async ({ page }) => {
    await seed(page);
    await targetCardRoute(page);
    await mergeRoute(page, preview());
    await login(page, "/parties/p2");
    await page.getByRole("button", { name: /تكرار محتمل/ }).click();
    await page.getByRole("button", { name: "دمج بتأكيد مزدوج" }).click();
    await expect(page).toHaveURL(/\/parties\/p1\/merge\?target=p2$/);
    await expect(page.locator('[data-screen="PTY-07"]')).toHaveAttribute("data-state", "ready");
  });
});

const CORRECT = "/parties/receipts/r1/correct";

const context = (over: Record<string, unknown> = {}) => ({
  receipt: {
    id: "r1",
    receipt_number: "REC-KRT-A2-26-000004",
    party_id: "p2",
    kind: "receipt",
    method: "cash",
    amount_minor: "20000",
    reference: "",
    reason: "",
    user_name: "سميرة ع.",
    business_date: "2026-09-09",
  },
  effective: {
    method: "cash",
    reference: "",
    amount_minor: "20000",
    business_date: "2026-09-09",
    reversed: false,
    effective: true,
  },
  corrections: [],
  party: side({ id: "p2", name: "أحمد الطيب — تجريبي", balance_minor: "10000" }),
  locked_before: "2026-08-01",
  ...over,
});

function correctRoute(page: Page, get: unknown, getStatus = 200) {
  return page.route("**/api/parties/receipts/r1/correct", (route) =>
    route.request().method() === "GET" ? route.fulfill(json(getStatus, get)) : route.fallback(),
  );
}

test.describe("PTY-09", () => {
  test("ready → success: تصحيح الوسيلة نقد → تحويل بمستند مستقل — الأصل لا يتغير والأثر مُعلن", async ({
    page,
  }, info) => {
    await seed(page);
    await correctRoute(page, context());
    const posted: Record<string, unknown>[] = [];
    await page.route("**/api/parties/receipts/r1/correct", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posted.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      return route.fulfill(
        json(201, {
          correction: { id: "c1", kind: "method", occurred_at: "2026-09-17T09:00:00Z" },
          receipt: context().receipt,
          // التحويل غير المطابق لا يُسقط الذمّة: الرصيد يعود 100 → 300 حتى المطابقة
          party: side({ id: "p2", name: "أحمد الطيب — تجريبي", balance_minor: "30000" }),
        }),
      );
    });
    await login(page, CORRECT);
    await expectFrame(page, info, {
      screenId: "PTY-09",
      state: "ready",
      texts: fromFrame("PTY-09", "ready", [
        "تصحيح حركة",
        "الأصل ثابت، والتصحيح مستند مستقل بسبب واضح وهوية منفّذ.",
        "الحركة الأصلية — لن تتغير",
        "سداد",
        "200.00",
        "· 09 سبتمبر · سميرة ع.",
        "نوع التصحيح",
        "تصحيح وسيلة الدفع",
        "عكس الحركة بالكامل",
        "تصحيح المبلغ",
        "السبب — إلزامي ويظهر في سجل التدقيق",
        "سيُنشأ",
        "مستند تصحيح جديد",
        "مرتبط بالأصل. كلاهما يظهر في كشف الحساب: الأصل بوسم «مصحَّح» والتصحيح بوسم «يصحّح حركة 09 سبتمبر». الرصيد النهائي واحد.",
        "إنشاء مستند التصحيح",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator('[data-screen="PTY-09"]')).toContainText(
      "سداد 200.00 · 09 سبتمبر · سميرة ع.",
    );
    // الوسيلة الحالية نقد → الافتراضي تحويل بنكي بمرجع إلزامي
    await expect(page.getByLabel("تحويل بنكي")).toBeChecked();
    await page.getByLabel("مرجع التحويل — إلزامي").fill("TRF-88190");
    await page
      .getByLabel("السبب — إلزامي ويظهر في سجل التدقيق")
      .fill("الوسيلة سُجّلت نقداً والصحيح تحويل TRF-88190");
    await page.getByRole("button", { name: "إنشاء مستند التصحيح" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-09",
      state: "success",
      texts: fromFrame("PTY-09", "success", [
        "مستند تصحيح جديد",
        "التاريخ القديم والجديد وسبب التصحيح ومن نفّذه — الثلاثة في السجل لا التاريخ الجديد وحده.",
        "أثرٌ مُعلن",
        "نقول ما تغيّر:",
        "رصيد الطرف",
      ]),
    });
    await expect(page.locator('[data-screen="PTY-09"]')).toContainText(
      "رصيد الطرف 100.00 → 300.00",
    );
    expect(posted).toEqual([
      {
        kind: "method",
        reason: "الوسيلة سُجّلت نقداً والصحيح تحويل TRF-88190",
        new_method: "bank",
        new_reference: "TRF-88190",
        new_amount_minor: "",
        new_business_date: null,
      },
    ]);
  });

  test("validation_error: تاريخ داخل فترة مقفلة — نمنع ونقول السبب؛ والسبب إلزامي", async ({
    page,
  }, info) => {
    await seed(page);
    await correctRoute(page, context());
    await login(page, CORRECT);
    await page.getByLabel("نوع التصحيح").selectOption("date");
    await page.getByLabel("تاريخ الأعمال").fill("2026-07-20");
    await page.getByRole("button", { name: "إنشاء مستند التصحيح" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-09",
      state: "validation_error",
      texts: fromFrame("PTY-09", "validation_error", [
        "تاريخ داخل فترة مقفلة",
        "نقل حركة إلى شهر أُقفلت ورديّاته وصُدِّرت تقاريره.",
        "نمنع ونقول السبب",
        "الفترة مقفلة —",
        "الحركة تبقى بتاريخها ويُسجَّل التصحيح بحركة معلَّلة.",
        "السبب — إلزامي ويظهر في سجل التدقيق",
      ]),
    });
    // بلا طلب للخادم: التاريخ قبل حدّ الفترة المقفلة يُرفض محلياً
    await page.getByLabel("تاريخ الأعمال").fill("2026-09-11");
    await expect(page.locator('[data-screen="PTY-09"]')).toHaveAttribute(
      "data-state",
      "validation_error",
    );
    await page.getByLabel("السبب — إلزامي ويظهر في سجل التدقيق").fill("تاريخ خاطئ");
    await expect(page.locator('[data-screen="PTY-09"]')).toHaveAttribute("data-state", "ready");
  });

  test("permission_denied: التصحيح للمالك", async ({ page }, info) => {
    await seed(page, "manager");
    await correctRoute(page, { detail: "owner_required" }, 403);
    await login(page, CORRECT);
    await expectFrame(page, info, {
      screenId: "PTY-09",
      state: "permission_denied",
      texts: fromFrame("PTY-09", "permission_denied", [
        "التصحيح للمالك",
        "تغيير التاريخ يُعيد ترتيب الدفتر ويمسّ تقارير صدرت.",
      ]),
    });
    await expect(page.getByRole("button", { name: "إنشاء مستند التصحيح" })).toHaveCount(0);
  });

  test("صُحِّح التاريخ: تصحيح التاريخ يُعلن أثره — رصيد الطرف كما هو", async ({ page }, info) => {
    await seed(page);
    await correctRoute(page, context());
    await page.route("**/api/parties/receipts/r1/correct", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill(
        json(201, {
          correction: { id: "c2", kind: "date", occurred_at: "2026-09-17T09:00:00Z" },
          receipt: context().receipt,
          party: side({ id: "p2", name: "أحمد الطيب — تجريبي", balance_minor: "10000" }),
        }),
      );
    });
    await login(page, CORRECT);
    await page.getByLabel("نوع التصحيح").selectOption("date");
    await page.getByLabel("تاريخ الأعمال").fill("2026-09-11");
    await page.getByLabel("السبب — إلزامي ويظهر في سجل التدقيق").fill("سُجّل بتاريخ اليوم بالخطأ");
    await page.getByRole("button", { name: "إنشاء مستند التصحيح" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-09",
      state: "success",
      texts: fromFrame("PTY-09", "success", [
        "صُحِّح التاريخ",
        "التاريخ القديم والجديد وسبب التصحيح ومن نفّذه — الثلاثة في السجل لا التاريخ الجديد وحده.",
        "أثرٌ مُعلن",
        "نقول ما تغيّر:",
        "رصيد الطرف كما هو",
      ]),
    });
  });
});
