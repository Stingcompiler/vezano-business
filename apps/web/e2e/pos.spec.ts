import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.14 — POS-01 (6) + POS-02 (3). نقطة البيع CSR من الإسقاط المحلي (IndexedDB حقيقي): الكتالوج
 * والبحث والباركود والسلة والحساب من الجهاز؛ الأرصدة وحدها تُطابَق مع الخادم (المحاكى شبكياً)
 * وتُوسم بآخر مطابقة (ACC-76). لا بيع نقدي بلا وردية مفتوحة؛ الرصيد القديم تنبيه لا منع (ACC-17).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const unit = (id: string, code: string, name: string, decimals: 0 | 3) => ({
  base_unit_id: id,
  base_unit_code: code,
  base_unit_name: name,
  base_unit_decimal_places: decimals,
});
const item = (
  id: string,
  name: string,
  group: string,
  base: [string, string, string, 0 | 3],
  extra: [string, number, string?][],
  price: string,
  barcode: string,
) => ({
  id,
  name,
  name_normalized: name,
  group_id: `g-${group}`,
  group_name: group,
  ...unit(...base),
  units: extra.map(([n, f, bc]) => ({
    unit_id: `u-${n}`,
    code: n,
    name: n,
    decimal_places: 0,
    factor_milli: String(f * 1000),
    barcode: bc ?? "",
  })),
  barcode,
  sale_price_minor: price,
  price_updated_at: new Date().toISOString(),
  aliases: [] as string[],
  is_active: true,
  deactivated_at: "",
  updated_at: new Date().toISOString(),
});

const ITEMS = [
  item(
    "i1",
    "سكر",
    "بقالة",
    ["u-kg", "كغ", "كيلوغرام", 3],
    [["كرتونة", 12, "6291000000159"]],
    "10000",
    "6291000000142",
  ),
  item(
    "i2",
    "شاي أسود 250غ",
    "مشروبات",
    ["u-pack", "عبوة", "عبوة", 0],
    [],
    "24000",
    "6291000000338",
  ),
  item("i3", "زيت 1 لتر", "بقالة", ["u-pack", "عبوة", "عبوة", 0], [], "78000", "6291000000501"),
  item("i4", "دقيق 5 كغ", "بقالة", ["u-bag", "كيس", "كيس", 0], [], "145000", ""),
  item("i5", "صابون", "منظفات", ["u-pc", "قطعة", "قطعة", 0], [], "9500", ""),
];

interface Seed {
  readonly items?: typeof ITEMS;
  readonly shift?: boolean;
  readonly balances?: Record<string, string>;
}

async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ items, shift, balances, openedAt }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections", "operations"], "readwrite");
        tx.objectStore("meta").put({
          key: "device.registration",
          value: JSON.stringify({ deviceId: "d1", prefix: "A2", branchId: "b1" }),
        });
        tx.objectStore("meta").put({ key: "sync_epoch", value: "epoch-A" });
        tx.objectStore("meta").put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الفرع الرئيسي",
            deviceId: "d1",
            deviceName: "كاشير 2",
            userId: "u1",
            userName: "سميرة ع.",
            roleName: "كاشير",
          }),
        });
        tx.objectStore("meta").put({
          key: "home.cache",
          value: JSON.stringify({
            savedAt: new Date().toISOString(),
            summary: { tenant_name: "بقالة النيل — تجريبي" },
          }),
        });
        for (const i of items)
          tx.objectStore("projections").put({ key: `entity:catalog.Item:${i.id}`, value: i });
        for (const [id, qty] of Object.entries(balances))
          tx.objectStore("projections").put({
            key: `entity:inventory.Balance:${id}`,
            value: { item_id: id, qty_milli: qty, as_of: openedAt },
          });
        if (shift) {
          tx.objectStore("projections").put({
            key: "entity:shifts.Shift:s1",
            value: {
              id: "s1",
              number: "OPEN-0091",
              branch_id: "b1",
              branch_name: "الفرع الرئيسي",
              device_id: "d1",
              device_name: "كاشير 2",
              user_id: "u1",
              user_name: "سميرة ع.",
              opening_float_minor: "184000",
              business_date: openedAt.slice(0, 10),
              opened_at: openedAt,
              state: "open",
              closed_at: "",
              operation_id: "op-open-1",
            },
          });
          tx.objectStore("meta").put({
            key: "shift.open",
            value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
          });
          tx.objectStore("operations").put({
            operationId: "op-open-1",
            kind: "shift_open",
            opVersion: 1,
            dependencies: [],
            members: [
              {
                entity: "shifts.ShiftOpened",
                id: "s1",
                schemaVersion: 1,
                payload: { shift_id: "s1", opening_float_minor: "184000" },
                serverSeq: null,
              },
            ],
            state: "synced",
            createdLocalSeq: 1,
            snapshotRelation: "none",
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      items: s.items ?? ITEMS,
      shift: s.shift ?? true,
      balances: s.balances ?? {},
      openedAt: (() => {
        const d = new Date();
        d.setHours(8, 0, 0, 0);
        return d.toISOString();
      })(),
    },
  );
}

async function login(page: Page) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto("/login?next=%2Fpos");
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

function balances(page: Page, list: { item_id: string; qty_milli: string }[], delayMs = 0) {
  return page.route("**/api/catalog/balances**", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return route.fulfill(
      json(200, { branch_id: "b1", as_of: new Date().toISOString(), balances: list }),
    );
  });
}

const BAL = [
  { item_id: "i1", qty_milli: "10000" },
  { item_id: "i2", qty_milli: "6000" },
  { item_id: "i3", qty_milli: "-2000" },
  { item_id: "i4", qty_milli: "12000" },
  { item_id: "i5", qty_milli: "0" },
];

test.describe("POS-01", () => {
  test("ready: بحث وباركود وتصنيفات وكميات وإجمالي — السلة حيّة والحساب من المجال", async ({
    page,
  }, info) => {
    await seed(page);
    await balances(page, BAL);
    await login(page);
    await expect(page.locator('[data-screen="POS-01"][data-state="ready"]')).toBeVisible();
    const wide = (page.viewportSize()?.width ?? 0) >= 1200;
    await expectFrame(page, info, {
      screenId: "POS-01",
      state: "ready",
      texts: fromFrame("POS-01", "ready", [
        "بقالة النيل — تجريبي",
        "/ الفرع الرئيسي",
        "وردية مفتوحة",
        "1,840.00",
        "نقداً",
        "سميرة ع. — كاشير",
        "وضع البيع",
        "نقطة البيع",
        "الفواتير",
        "العملاء والذمم",
        "الوردية والصندوق",
        "الإدارة",
        "الأصناف",
        "المخزون",
        "السوق",
        "التقارير",
        "— لا صلاحية",
        "الكل",
        "بقالة",
        "مشروبات",
        "منظفات",
        "وزن",
        "السلة",
        "فاتورة جديدة — لم تُحفظ",
        "عدد الأسطر",
        "خصم",
        "الإجمالي",
        "ج.س",
        "تعليق الفاتورة",
        "إلغاء السلة",
        ...(wide
          ? [
              "مسح باركود",
              "الصنف",
              "الوحدة",
              "السعر",
              "المتاح",
              "إضافة",
              "صنفاً — ضيّق البحث للوصول أسرع",
              "السعر والوحدة يُثبَّتان على سطر البيع لحظة الحفظ",
              "متابعة إلى الدفع",
            ]
          : ["ابحث أو امسح باركود…", "ماسح", "تحصيل"]),
      ]),
      styles: [[".pos-cart__title", "color", "ink.strong"]],
    });
    if (wide) {
      // الوحدة البديلة بمعاملها المُعلن، وشارات الرصيد من بيانات الإطار
      const table = page.locator(".c-table");
      for (const t of ["كرتونة = 12 كغ", "نفد", "رصيد سالب", "1,200.00"])
        await expect(table).toContainText(t);
    }
    // إضافة عبوة شاي مباشرةً (لا وزن) ثم «+» داخل السطر: 2 × 240.00 = 480.00 — من المجال
    if (wide) await page.getByRole("button", { name: "إضافة" }).nth(2).click();
    else await page.locator(".pos-tile", { hasText: "شاي أسود" }).first().click();
    const cart = page.locator(".c-cart");
    await expect(cart).toContainText("شاي أسود 250غ");
    await page.getByRole("button", { name: "زيادة شاي أسود 250غ" }).click();
    await expect(cart).toContainText("480.00");
    await expect(cart.locator(".c-cart__summary")).toContainText("1");
    // الصف موسوم «في السلة ×2» على الشاشة العريضة
    if (wide) await expect(page.locator(".c-table")).toContainText("في السلة ×2");
    // «−» حتى الصفر يحذف السطر؛ السلة تعود فارغة والدفع معطّل بسببه
    await page.getByRole("button", { name: "إنقاص شاي أسود 250غ" }).click();
    await page.getByRole("button", { name: "إنقاص شاي أسود 250غ" }).click();
    await expect(cart.locator(".c-cart__lines")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: wide ? "متابعة إلى الدفع" : "تحصيل" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  test("POS-02 ready → validation_error: الوزن بثلاث منازل، والتحويل مُعلن، والزر معطّل حتى التصحيح", async ({
    page,
  }, info) => {
    await seed(page);
    await balances(page, BAL);
    await login(page);
    await expect(page.locator('[data-screen="POS-01"][data-state="ready"]')).toBeVisible();
    const wide = (page.viewportSize()?.width ?? 0) >= 1200;
    if (wide) await page.getByRole("button", { name: "إضافة" }).first().click();
    else await page.locator(".pos-tile", { hasText: /^سكر/ }).first().click();
    await page.getByLabel("الكمية بالكيلوغرام").fill("0.123");
    await expectFrame(page, info, {
      screenId: "POS-02",
      state: "ready",
      texts: fromFrame("POS-02", "ready", [
        "سكر — اختيار الوحدة",
        "الوحدة المختارة تُثبَّت على سطر البيع ولا تتأثر بتغيير المعامل لاحقاً",
        "كغ",
        "100.00",
        "كرتونة",
        "= 12 كغ",
        "الكمية بالكيلوغرام",
        "القيمة",
        "0.123 × 100.00 = 12.30",
        "تأكيد الإضافة",
      ]),
    });
    await page.getByLabel("الكمية بالكيلوغرام").fill("0.1234");
    await expectFrame(page, info, {
      screenId: "POS-02",
      state: "validation_error",
      texts: fromFrame("POS-02", "validation_error", [
        "الوزن يقبل ثلاث منازل عشرية كحد أقصى. اكتب 0.123 أو 0.124 — لن نقرّب نيابة عنك في معاملة مالية.",
        "— لا تُحسب قبل تصحيح الكمية",
        "الزر معطّل حتى تصحيح الكمية",
      ]),
    });
    await expect(page.getByRole("button", { name: "تأكيد الإضافة" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByLabel("الكمية بالكيلوغرام").fill("0.123");
    await page.getByRole("button", { name: "تأكيد الإضافة" }).click();
    await expect(page.locator(".c-cart")).toContainText("12.30");
    // المسودّة على الجهاز (تشغيل بارد): meta `pos.cart` تحمل السطر بكميته وسعره المثبَّتين
    const draft = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      const row = await new Promise<{ value: string } | undefined>((res) => {
        const r = db.transaction("meta").objectStore("meta").get("pos.cart");
        r.onsuccess = () => res(r.result as { value: string } | undefined);
      });
      db.close();
      return row ? (JSON.parse(row.value) as { lines: { qty_milli: string }[] }) : null;
    });
    expect(draft?.lines.map((l) => l.qty_milli)).toEqual(["123"]);
  });

  test("POS-02 empty ×3: كتالوج فارغ، بحث بلا تطابق بأقرب الأسماء، وباركود مجهول", async ({
    page,
  }, info) => {
    await seed(page);
    await balances(page, BAL);
    await login(page);
    await expect(page.locator('[data-screen="POS-01"][data-state="ready"]')).toBeVisible();
    const search = page.getByLabel(/ابحث/);
    await search.fill("سكر بني");
    await expectFrame(page, info, {
      screenId: "POS-02",
      state: "empty",
      texts: fromFrame("POS-02", "empty", [
        "بحث بلا تطابق",
        "سكر بني",
        "صنفاً. الكتالوج ليس فارغاً — هذا الاسم تحديداً غير موجود.",
        "أقرب الأسماء:",
        "اقتراح بحثي لا تصحيح تلقائي — لا نستبدل ما كتبته",
        "إضافته كصنف جديد",
        "يفتح الإضافة السريعة باسم «سكر بني» جاهزاً",
        "البحث يشمل الاسم والباركود والرمز الداخلي — نقول أين بحثنا.",
      ]),
    });
    await expect(page.locator(".pos-empty__nearest")).toContainText("«سكر»");
    await search.fill("6291041500213");
    await search.press("Enter");
    await expectFrame(page, info, {
      screenId: "POS-02",
      state: "empty",
      texts: fromFrame("POS-02", "empty", [
        "باركود مجهول",
        "قُرئ الباركود بنجاح ولا صنف مربوط به. العطل ليس في الماسح ولا في الشبكة.",
        "ربطه بصنف موجود",
        "الأرجح: عبوة جديدة لصنف تبيعه — الربط يتم مرة واحدة",
        "إنشاء صنف جديد بهذا الباركود",
        "الباركود يُحفظ تلقائياً في بطاقة الصنف",
        "الرقم المقروء معروض كاملاً لتتحقق منه بعينك قبل الربط.",
      ]),
    });
    await expect(page.locator(".pos-empty__query")).toHaveText("6291041500213");
    // باركود معروف لوحدة (كرتونة السكر) يضيف الصف مباشرةً
    await search.fill("6291000000159");
    await search.press("Enter");
    await expect(page.locator(".c-cart")).toContainText("سكر");
    await expect(page.locator(".c-cart")).toContainText("1,200.00");
  });

  test("empty: كتالوج فارغ — منشأة جديدة لم تُدخل أصنافها، والبيع لا يقف على اكتمال الكتالوج", async ({
    page,
  }, info) => {
    await seed(page, { items: [] });
    await balances(page, []);
    await login(page);
    await expectFrame(page, info, {
      screenId: "POS-01",
      state: "empty",
      texts: fromFrame("POS-01", "empty", [
        "كتالوج فارغ",
        "منشأة جديدة لم تُدخل أصنافها.",
        "استورد قائمة الأصناف",
        "أنشئ صنفاً",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "POS-02",
      state: "empty",
      texts: fromFrame("POS-02", "empty", [
        "كتالوج فارغ — محل جديد",
        "لا أصناف في كتالوجك بعد. هذه بداية طبيعية لا عطل: أضف صنفاً واحداً وابدأ البيع، والباقي يُبنى أثناء العمل.",
        "إضافة صنف سريع",
        "اسم ووحدة وسعر — ثلاثة حقول تكفي للبيع اليوم",
        "استيراد من ملف",
        "متاح لاحقاً في",
        "— المرحلة غير مفعّلة",
        "لا نطلب إكمال الكتالوج قبل أول بيع. الصنف الواحد يكفي.",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "متاح لاحقاً في «ربط الأطراف» — المرحلة غير مفعّلة",
    );
  });

  test("loading: الكتالوج فوراً — ما يتأخر هو الأرصدة وتُوسم حتى تصل", async ({ page }, info) => {
    await seed(page);
    await balances(page, BAL, 6000);
    await login(page);
    await expectFrame(page, info, {
      screenId: "POS-01",
      state: "loading",
      texts: fromFrame("POS-01", "loading", [
        "الكتالوج فوراً",
        "البحث والباركود من قاعدة الجهاز بلا انتظار. ما يتأخر هو الأرصدة — وتُوسم حتى تصل.",
      ]),
    });
    // الكتالوج والسلة يعملان أثناء انتظار الأرصدة
    await expect(page.locator('[data-screen="POS-01"]')).toContainText("سكر");
    await expect(page.locator('[data-screen="POS-01"][data-state="ready"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("offline: بيع بلا اتصال — كامل الوظيفة، والأرصدة موسومة بآخر مطابقة", async ({
    page,
    context,
  }, info) => {
    await seed(page, { balances: { i1: "10000" } });
    await balances(page, BAL);
    await login(page);
    await expect(page.locator('[data-screen="POS-01"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "POS-01",
      state: "offline",
      texts: fromFrame("POS-01", "offline", [
        "بيع بلا اتصال",
        "البيع كامل الوظيفة: بحث وباركود وتسعير وحفظ محلي — الحالة الأصلية للنظام لا استثناؤه.",
        "ما يتغيّر فقط",
        "شارة «محفوظ محلياً» على كل فاتورة جديدة، وأرصدة موسومة بآخر مطابقة",
        "لا وظيفة تُحجب.",
      ]),
    });
    const wide = (page.viewportSize()?.width ?? 0) >= 1200;
    if (wide) await page.getByRole("button", { name: "إضافة" }).nth(2).click();
    else await page.locator(".pos-tile", { hasText: "شاي أسود" }).first().click();
    await expect(page.locator(".c-cart")).toContainText("240.00");
    await context.setOffline(false);
  });

  test("stale: أرصدة قديمة أثناء البيع — تنبيه لا منع، «الرصيد قد يكون أقل»", async ({
    page,
  }, info) => {
    await seed(page, { balances: { i1: "1000", i2: "6000" } });
    await page.route("**/api/catalog/balances**", (route) =>
      route.fulfill(json(500, { detail: "server_error" })),
    );
    await login(page);
    await expectFrame(page, info, {
      screenId: "POS-01",
      state: "stale",
      texts: fromFrame("POS-01", "stale", [
        "أرصدة قديمة أثناء البيع",
        "جهاز آخر يبيع من نفس المخزون.",
        "تنبيه لا منع",
        "الرصيد قد يكون أقل",
      ]),
    });
    // لا منع: الإضافة تعمل رغم قِدم الرصيد
    const wide = (page.viewportSize()?.width ?? 0) >= 1200;
    if (wide) await page.getByRole("button", { name: "إضافة" }).nth(2).click();
    else await page.locator(".pos-tile", { hasText: "شاي أسود" }).first().click();
    await expect(page.locator(".c-cart")).toContainText("240.00");
  });

  test("permission_denied: لا وردية مفتوحة — «افتح وردية» لا «ليست لديك صلاحية»", async ({
    page,
  }, info) => {
    await seed(page, { shift: false });
    await balances(page, BAL);
    await login(page);
    await expectFrame(page, info, {
      screenId: "POS-01",
      state: "permission_denied",
      texts: fromFrame("POS-01", "permission_denied", [
        "لا وردية مفتوحة",
        "البيع النقدي يحتاج صندوقاً مفتوحاً يستقبل النقد.",
        "افتح وردية",
      ]),
    });
    await expect(page.locator('[data-screen="POS-01"]')).not.toContainText("ليست لديك صلاحية");
    await page.getByRole("button", { name: "افتح وردية" }).click();
    await expect(page).toHaveURL(/\/shifts\/open$/);
  });
});
