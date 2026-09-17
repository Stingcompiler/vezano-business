import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.15 — POS-03 (3) + POS-04 (5). الخصم بسقوف الدور المعلنة (G-09 مؤقتاً) وتجاوزها حدثٌ يُنسب
 * للكاشير ويُراجع عند الاتصال (§٧.٤)؛ العميل شرط الأثر الآجل لا شرط البيع، يُنشأ بالاسم فقط في المكان،
 * والتشابه المضلل يُعرض ويُسأل عنه لا يُمنع (§٧.٥؛ ACC-12). السلة والأطراف على الجهاز (IndexedDB).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface PartySeed {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly balance: string;
  readonly limit?: string;
  readonly lastSale?: string;
}

interface Seed {
  readonly parties?: readonly PartySeed[];
  readonly usedToday?: string;
  readonly role?: string;
}

/** وردية مفتوحة وسلة فيها شاي × 1 (240.00) وسقوف الكاشير كما قالها الخادم آخر مرة. */
async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ parties, usedToday, role, openedAt }) => {
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
            roleName: role,
            roleCode: "cashier",
            discountCaps: {
              per_op_minor: "1000",
              daily_minor: "5000",
              percent: 10,
              used_today_minor: usedToday,
            },
          }),
        });
        tx.objectStore("meta").put({
          key: "pos.cart",
          value: JSON.stringify({
            lines: [
              {
                id: "l1",
                item_id: "i2",
                item_name: "شاي أسود 250غ",
                unit_id: "u-pack",
                unit_code: "عبوة",
                unit_name: "عبوة",
                factor_milli: "1000",
                decimal_places: 0,
                qty_milli: "1000",
                unit_price_minor: "24000",
              },
            ],
            updated_at: openedAt,
          }),
        });
        tx.objectStore("meta").put({
          key: "shift.open",
          value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
        });
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
        for (const p of parties)
          tx.objectStore("projections").put({
            key: `entity:parties.Party:${p.id}`,
            value: {
              id: p.id,
              name: p.name,
              name_normalized: p.name,
              phone: p.phone,
              credit_limit_minor: p.limit ?? "0",
              is_customer: true,
              is_supplier: false,
              distinct_from_id: "",
              balance_minor: p.balance,
              last_sale_at: p.lastSale ?? "",
              is_active: true,
              deactivated_at: "",
              updated_at: openedAt,
            },
          });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      parties: s.parties ?? [],
      usedToday: s.usedToday ?? "2200",
      role: s.role ?? "كاشير",
      openedAt: new Date().toISOString(),
    },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/catalog/balances**", (route) =>
    route.fulfill(json(200, { branch_id: "b1", as_of: new Date().toISOString(), balances: [] })),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

function acceptPush(page: Page, seen: { kind: string }[]) {
  return page.route("**/api/sync/push", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string; kind: string }[];
      request_id: string;
    };
    seen.push(...body.operations);
    return route.fulfill(
      json(200, {
        protocol_version: 1,
        sync_epoch: "epoch-A",
        request_id: body.request_id,
        results: body.operations.map((o) => ({
          operation_id: o.operation_id,
          status: "accepted",
          member_receipts: [],
        })),
        server_seq_high: "9",
      }),
    );
  });
}

async function readOps(page: Page): Promise<{ kind: string; state: string }[]> {
  return page.evaluate(async () => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    const rows = await new Promise<{ kind: string; state: string }[]>((res) => {
      const r = db.transaction("operations").objectStore("operations").getAll();
      r.onsuccess = () => res(r.result as { kind: string; state: string }[]);
    });
    db.close();
    return rows.map((o) => ({ kind: o.kind, state: o.state }));
  });
}

const AHMAD: PartySeed = {
  id: "p1",
  name: "أحمد الطيب — تجريبي",
  phone: "0912555447",
  balance: "12000",
  lastSale: "2026-09-08T10:00:00Z",
};
const AHMAD2: PartySeed = {
  id: "p2",
  name: "أحمد عبد الله — تجريبي",
  phone: "0911222203",
  balance: "0",
};

test.describe("POS-03", () => {
  test("ready: مبلغ/نسبة وسبب إلزامي وحدّ الدور معلن — الخصم يُطبَّق على السلة", async ({
    page,
  }, info) => {
    await seed(page);
    await login(page, "/pos/discount");
    await expectFrame(page, info, {
      screenId: "POS-03",
      state: "ready",
      texts: fromFrame("POS-03", "ready", [
        "خصم على الفاتورة",
        "مبلغ",
        "نسبة",
        "قيمة الخصم",
        "السبب — إلزامي",
        "حدّك كـ",
        "كاشير",
        "للعملية",
        "يومياً. المستخدَم اليوم",
        "القيم تجريبية — تُضبط في ORG-02 مصفوفة الأدوار.",
        "تطبيق الخصم",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="POS-03"]');
    for (const n of ["10.00", "50.00", "22.00"]) await expect(root).toContainText(n);
    await page.getByLabel("قيمة الخصم").fill("8.00");
    await page.getByLabel("السبب — إلزامي").fill("عميل دائم");
    await page.getByRole("button", { name: "تطبيق الخصم" }).click();
    await expect(page).toHaveURL(/\/pos$/);
    const cart = page.locator(".c-cart");
    await expect(cart).toContainText("−8.00");
    await expect(cart.locator(".c-cart__sum")).toContainText("232.00");
  });

  test("permission_denied: يتجاوز حدّك للعملية — طلب اعتماد يُسجَّل حدثاً، أو تخفيض إلى الحدّ", async ({
    page,
  }, info) => {
    await seed(page);
    const pushed: { kind: string }[] = [];
    await acceptPush(page, pushed);
    await login(page, "/pos/discount");
    await page.getByLabel("قيمة الخصم").fill("35.00");
    await page.getByLabel("السبب — إلزامي").fill("عميل دائم");
    await page.getByRole("button", { name: "تطبيق الخصم" }).click();
    await expectFrame(page, info, {
      screenId: "POS-03",
      state: "permission_denied",
      texts: fromFrame("POS-03", "permission_denied", [
        "خصم على الفاتورة",
        "يتجاوز حدّك للعملية",
        "حدّك",
        "والمطلوب",
        "يحتاج اعتماد مدير الفرع أو المالك. الفاتورة محفوظة في السلة ولن تُفقد.",
        "طلب اعتماد من مدير الفرع",
        "تخفيض الخصم إلى",
      ]),
    });
    await expect(page.locator('[data-screen="POS-03"]')).toContainText("35.00");
    await page.getByRole("button", { name: "طلب اعتماد من مدير الفرع" }).click();
    await expect(page.locator('[data-screen="POS-03"]')).toContainText(
      "طلب تفويضٍ يسجَّل باسم من وافق",
    );
    await expect
      .poll(async () => (await readOps(page)).filter((o) => o.kind === "discount_override").length)
      .toBe(1);
    expect(pushed.map((o) => o.kind)).toEqual(["discount_override"]);
    // الفاتورة محفوظة في السلة ولن تُفقد؛ التخفيض إلى الحدّ يعود بها
    await page.getByRole("button", { name: /تخفيض الخصم إلى/ }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.locator(".c-cart")).toContainText("−10.00");
  });

  test("validation_error: خصم يتجاوز سقف الدور — سقفك 10٪", async ({ page }, info) => {
    await seed(page);
    await login(page, "/pos/discount");
    await page.getByRole("button", { name: "نسبة" }).click();
    await page.getByLabel("قيمة الخصم").fill("15");
    await page.getByLabel("السبب — إلزامي").fill("عميل دائم");
    await page.getByRole("button", { name: "تطبيق الخصم" }).click();
    await expectFrame(page, info, {
      screenId: "POS-03",
      state: "validation_error",
      texts: fromFrame("POS-03", "validation_error", [
        "خصم يتجاوز سقف الدور",
        "سقفك",
        "— يحتاج هذا الخصم تفويض مدير الفرع",
        "طلب اعتماد من مدير الفرع",
      ]),
    });
  });
});

test.describe("POS-04", () => {
  test("ready: بحث بالاسم — الهاتف محجوب الوسط والرصيد بمعناه، ثم الاختيار يعود إلى السلة", async ({
    page,
  }, info) => {
    await seed(page, { parties: [AHMAD, AHMAD2] });
    await login(page, "/pos/customer");
    await page.getByLabel("اختيار العميل").fill("أحمد");
    await expectFrame(page, info, {
      screenId: "POS-04",
      state: "ready",
      texts: fromFrame("POS-04", "ready", [
        "اختيار العميل",
        "أحمد الطيب — تجريبي",
        "0912 ••• 447 · آخر بيع 08 سبتمبر",
        "عليه",
        "أحمد عبد الله — تجريبي",
        "0911 ••• 203",
        "لا رصيد",
        "إنشاء عميل جديد",
        "بيع نقدي بلا عميل",
      ]),
    });
    await expect(page.locator(".pos-parties")).toContainText("120.00");
    await page.getByRole("button", { name: /^أحمد الطيب/ }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.locator(".c-cart")).toContainText("أحمد الطيب — تجريبي");
  });

  test("validation_error: يوجد عميل بنفس الاسم — استخدام الموجود أو إنشاء منفصل مع تمييز (حدث محلي)", async ({
    page,
  }, info) => {
    await seed(page, { parties: [{ ...AHMAD, name: "أحمد الطيب" }] });
    const pushed: { kind: string }[] = [];
    await acceptPush(page, pushed);
    await login(page, "/pos/customer");
    await page.getByRole("button", { name: "إنشاء عميل جديد" }).click();
    await page.getByLabel("الاسم").fill("أحمد الطيب");
    await page.getByRole("button", { name: /^أنشئ:/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-04",
      state: "validation_error",
      texts: fromFrame("POS-04", "validation_error", [
        "عميل جديد",
        "الاسم",
        "يوجد عميل بنفس الاسم",
        "عليه",
        ". إنشاء ثانٍ بنفس الاسم يفصل الرصيدين ويصعّب التحصيل لاحقاً.",
        "استخدام العميل الموجود",
        "إنشاء منفصل مع تمييز",
      ]),
    });
    await page.getByRole("button", { name: "إنشاء منفصل مع تمييز" }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.locator(".c-cart")).toContainText("أحمد الطيب");
    await expect
      .poll(async () => (await readOps(page)).filter((o) => o.kind === "party_create").length)
      .toBe(1);
    expect(pushed.map((o) => o.kind)).toEqual(["party_create"]);
  });

  test("validation_error: هاتف مسجَّل على طرف قائم — «هذا هو» أو «طرف جديد بنفس الرقم»", async ({
    page,
  }, info) => {
    await seed(page, {
      parties: [{ id: "p3", name: "مطعم الواحة", phone: "0918000111", balance: "0" }],
    });
    await login(page, "/pos/customer");
    await page.getByRole("button", { name: "إنشاء عميل جديد" }).click();
    await page.getByLabel("الاسم").fill("مطعم الروضة");
    await page.getByLabel("الهاتف").fill("0918-000-111");
    await page.getByRole("button", { name: /^أنشئ:/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-04",
      state: "validation_error",
      texts: fromFrame("POS-04", "validation_error", [
        "هاتف مسجَّل على طرف قائم",
        "الرقم المدخل رقم «مطعم الواحة».",
        "هذا هو",
        "طرف جديد بنفس الرقم",
      ]),
    });
    await page.getByRole("button", { name: "هذا هو" }).click();
    await expect(page.locator(".c-cart")).toContainText("مطعم الواحة");
  });

  test("empty: لا نتائج بحث — «أنشئ: مطعم الروضة» في المكان", async ({ page }, info) => {
    await seed(page, { parties: [AHMAD] });
    await login(page, "/pos/customer");
    await page.getByLabel("اختيار العميل").fill("مطعم الروضة");
    await expectFrame(page, info, {
      screenId: "POS-04",
      state: "empty",
      texts: fromFrame("POS-04", "empty", [
        "لا نتائج بحث",
        "الاسم المكتوب لا يطابق أحداً.",
        "أنشئ: مطعم الروضة",
        "باسمٍ وهاتف — حقلان لحظة البيع، والبطاقة الكاملة لاحقاً (PTY-03).",
      ]),
    });
    await page.getByRole("button", { name: "أنشئ: مطعم الروضة" }).click();
    await expect(page.getByLabel("الاسم")).toHaveValue("مطعم الروضة");
  });

  test("permission_denied: آجل فوق حدّ ائتمان العميل — الكاشير لا يرفع الحدّ", async ({
    page,
  }, info) => {
    await seed(page, { parties: [{ ...AHMAD, balance: "45000", limit: "50000" }] });
    await login(page, "/pos/customer");
    await page.getByRole("button", { name: /^أحمد الطيب/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-04",
      state: "permission_denied",
      texts: fromFrame("POS-04", "permission_denied", [
        "آجل فوق حدّ ائتمان العميل",
        "البيع يرفع الرصيد فوق الحدّ المضبوط في بطاقته.",
        "الكاشير لا يرفع الحدّ",
        "يطلب تفويضاً أو يقبض نقداً. رفع الحدّ قرار على بطاقة الطرف (PTY-03) بصلاحيته لا في لحظة البيع.",
        "بيع نقدي بلا عميل",
      ]),
    });
    await expect(page).toHaveURL(/\/pos\/customer$/);
    await page.getByRole("button", { name: "بيع نقدي بلا عميل" }).first().click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.locator(".c-cart")).toContainText("بيع نقدي بلا عميل");
  });

  test("offline: اختيار عميل بلا اتصال — البحث في أطراف الجهاز والإنشاء محلي", async ({
    page,
    context,
  }, info) => {
    await seed(page, { parties: [AHMAD] });
    await login(page, "/pos/customer");
    await expect(page.locator('[data-screen="POS-04"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "POS-04",
      state: "offline",
      texts: fromFrame("POS-04", "offline", [
        "اختيار عميل بلا اتصال",
        "البحث في أطراف الجهاز، والإنشاء السريع محلي.",
        "التشابه يُفحص لاحقاً",
        "فحص «الرقم مسجَّل على طرف آخر» يكتمل عند المزامنة، وقد ينتج مراجعة دمج (PTY-07). نقولها عند الإنشاء لا نفاجئ بها بعده.",
      ]),
    });
    await page.getByLabel("اختيار العميل").fill("أحمد");
    await expect(page.locator(".pos-parties")).toContainText("أحمد الطيب — تجريبي");
    await context.setOffline(false);
  });
});
