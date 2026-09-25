import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.31 — INV-07 هالك وحجر تالف (4). التالف لا يدخل المتاح للبيع (ACC-10): الحجر يخرج من المتاح
 * ويبقى في المخزون الفعلي موسوماً، والهالك خروج نهائي؛ الحدّ من الرصيد ولو كان خاطئاً؛ الهالك
 * بحدٍّ مالي لغير المالك؛ السبب إلزامي؛ أثر الحجر ظاهر في INV-01 وINV-02.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const ITEM = {
  id: "i3",
  name: "زيت 1 لتر",
  name_normalized: "زيت 1 لتر",
  group_id: "g-1",
  group_name: "بقالة",
  base_unit_id: "u-pack",
  base_unit_code: "pack",
  base_unit_name: "عبوة",
  base_unit_decimal_places: 0,
  units: [
    {
      id: "iu-i3-carton",
      unit_id: "u-carton",
      code: "carton",
      name: "كرتونة",
      decimal_places: 0,
      factor_milli: "12000",
      barcode: "",
    },
  ],
  barcode: "",
  sale_price_minor: "78000",
  price_updated_at: "2026-09-01T10:00:00.000Z",
  alert_threshold_milli: "",
  aliases: [] as string[],
  is_active: true,
  deactivated_at: "",
  updated_at: "2026-09-01T10:00:00.000Z",
};

async function seed(page: Page, role: "owner" | "storekeeper" = "owner", balance = "8000") {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, item, balance }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections"], "readwrite");
        const meta = tx.objectStore("meta");
        const proj = tx.objectStore("projections");
        meta.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d1",
            prefix: "A2",
            branchId: "b1",
            branchCode: "KRT",
          }),
        });
        meta.put({ key: "sync_epoch", value: "epoch-A" });
        meta.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الفرع الرئيسي",
            branchCode: "KRT",
            deviceId: "d1",
            deviceName: "مخزن",
            devicePrefix: "A2",
            userId: "u1",
            userName: role === "owner" ? "عثمان" : "هبة",
            roleName: role === "owner" ? "مالك" : "أمين مخزن",
            roleCode: role,
          }),
        });
        proj.put({ key: `entity:catalog.Item:${item.id}`, value: item });
        proj.put({
          key: `entity:inventory.Balance:${item.id}`,
          value: { item_id: item.id, qty_milli: balance, as_of: "2026-09-17T09:00:00.000Z" },
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role, item: ITEM, balance },
  );
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

const DAMAGE = "/inventory/items/i3/damage";

const damageBody = (over: Record<string, unknown> = {}) => ({
  damage: {
    id: "dmg-1",
    damage_number: "DMG-0001",
    item_id: "i3",
    item_name: "زيت 1 لتر",
    unit_name: "عبوة",
    qty_milli: "3000",
    base_qty_milli: "3000",
    destination: "quarantine",
    reason: "تسرّب في العبوات أثناء النقل",
    value_minor: "234000",
    decided_by_name: "عثمان",
    occurred_at: "2026-09-18T09:00:00.000Z",
  },
  balance_milli: "5000",
  quarantine_milli: "3000",
  ...over,
});

const READY = [
  "تسجيل تالف — زيت 1 لتر",
  "التالف لا يدخل المتاح للبيع",
  "الكمية",
  "الوحدة",
  "عبوة",
  "كرتونة",
  "الوجهة",
  "حجر — قابل للمراجعة",
  "يخرج من المتاح للبيع ويبقى في المخزون الفعلي",
  "هالك — خروج نهائي",
  "يخرج من المخزون بالكامل ولا يعود",
  "السبب — إلزامي",
  "المتاح للبيع بعد التسجيل",
  "تسجيل التالف",
];

test.describe("INV-07", () => {
  test("ready → success: حجر 3 عبوات بسبب — المتاح 5 والحجر ظاهر، ولا يدخل المتاح للبيع", async ({
    page,
  }, info) => {
    await seed(page);
    const posted: Record<string, unknown>[] = [];
    await page.route("**/api/inventory/items/i3/damage", (route) => {
      posted.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      return route.fulfill(json(201, damageBody()));
    });
    await login(page, DAMAGE);
    await page.getByLabel("الكمية", { exact: true }).fill("3");
    await page.getByLabel("السبب — إلزامي").fill("تسرّب في العبوات أثناء النقل");
    await expectFrame(page, info, {
      screenId: "INV-07",
      state: "ready",
      texts: fromFrame("INV-07", "ready", READY),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="INV-07"]');
    await expect(root.locator(".shift-facts__v")).toHaveText("5");
    await expect(page.getByLabel("حجر — قابل للمراجعة")).toBeChecked();
    // العدّاد −/+
    await page.getByRole("button", { name: "زيادة" }).click();
    await expect(root.locator(".shift-facts__v")).toHaveText("4");
    await page.getByRole("button", { name: "نقص" }).click();
    await page.getByRole("button", { name: "تسجيل التالف" }).click();
    await expectFrame(page, info, {
      screenId: "INV-07",
      state: "success",
      texts: fromFrame("INV-07", "success", [
        "سُجّل الهالك",
        "الكمية والسبب المصنَّف والوجهة: هالكٌ يُخرج، أو حجرٌ يبقى في المخزون موسوماً غير قابل للبيع.",
        "الحجر ليس هالكاً",
        "التالف المحجور قد يُرتجع للمورد",
        "إهلاكه يُفقد حقّ المطالبة",
        "حجر — قابل للمراجعة",
        "المتاح للبيع بعد التسجيل",
      ]),
    });
    await expect(root).toContainText("DMG-0001");
    expect(posted).toEqual([
      {
        branch_id: "b1",
        unit_code: "pack",
        unit_name: "عبوة",
        factor_milli: "1000",
        qty_milli: "3000",
        destination: "quarantine",
        reason: "تسرّب في العبوات أثناء النقل",
      },
    ]);
    // رصيد الجهاز يتبع الخادم: 5
    const bal = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const row = await new Promise<{ value: { qty_milli: string } }>((res) => {
        const r = db
          .transaction("projections")
          .objectStore("projections")
          .get("entity:inventory.Balance:i3");
        r.onsuccess = () => res(r.result as { value: { qty_milli: string } });
      });
      db.close();
      return row.value.qty_milli;
    });
    expect(bal).toBe("5000");
  });

  test("validation_error: هالك يتجاوز الرصيد — إهلاك 12 والرصيد 8، والحدّ من الرصيد", async ({
    page,
  }, info) => {
    await seed(page);
    await login(page, DAMAGE);
    await page.getByLabel("هالك — خروج نهائي").check();
    await page.getByLabel("الكمية", { exact: true }).fill("12");
    await expectFrame(page, info, {
      screenId: "INV-07",
      state: "validation_error",
      texts: fromFrame("INV-07", "validation_error", [
        "هالك يتجاوز الرصيد",
        "إهلاك",
        "والرصيد",
        "الحدّ من الرصيد",
        "ولو كان الرصيد خاطئاً. تصحيحه بالجرد لا بالهالك — وإلا صار الهالك باباً لتصحيح الأرصدة بلا أثر.",
        "المتاح للبيع بعد التسجيل",
      ]),
    });
    const root = page.locator('[data-screen="INV-07"]');
    await expect(root).toContainText("إهلاك 12 والرصيد 8.");
    await expect(root.locator(".shift-facts__v")).toHaveText("−4");
    await expect(page.getByRole("button", { name: "تسجيل التالف" })).toBeDisabled();
    // السبب إلزامي
    await page.getByLabel("الكمية", { exact: true }).fill("2");
    await expect(root).toHaveAttribute("data-state", "ready");
    await page.getByRole("button", { name: "تسجيل التالف" }).click();
    await expect(root).toHaveAttribute("data-state", "validation_error");
    await expect(root).toContainText("السبب — إلزامي");
  });

  test("permission_denied: الهالك بحدٍّ مالي — أمين المخزن فوق الحدّ يحتاج اعتماد المالك", async ({
    page,
  }, info) => {
    await seed(page, "storekeeper", "20000");
    await page.route("**/api/inventory/items/i3/damage", (route) =>
      route.fulfill(
        json(403, { detail: "owner_required", cap_minor: "50000", value_minor: "78000" }),
      ),
    );
    await login(page, DAMAGE);
    await page.getByLabel("هالك — خروج نهائي").check();
    await page.getByLabel("الكمية", { exact: true }).fill("10");
    await page.getByLabel("السبب — إلزامي").fill("منتهي الصلاحية");
    await page.getByRole("button", { name: "تسجيل التالف" }).click();
    await expectFrame(page, info, {
      screenId: "INV-07",
      state: "permission_denied",
      texts: fromFrame("INV-07", "permission_denied", [
        "الهالك بحدٍّ مالي",
        "أمين المخزن يُهلك حتى حدٍّ معرَّف في",
        "، وما فوقه يحتاج اعتماد المالك.",
        "لماذا حدّ",
        "الهالك خسارةٌ مباشرة وبابٌ لإخفاء نقص. الحدّ يوازن بين تسهيل العمل ومنع الإفراط.",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "أمين المخزن يُهلك حتى حدٍّ معرَّف في «الأدوار والصلاحيات»، وما فوقه يحتاج اعتماد المالك.",
    );
    await expect(page.locator('[data-screen="INV-07"]')).toContainText(
      "الحدّ 500.00 · القيمة 780.00",
    );
  });

  test("من INV-02: «تسجيل التالف» يفتح INV-07", async ({ page }) => {
    await seed(page);
    await page.route("**/api/inventory/items/i3/movements**", (route) =>
      route.fulfill(
        json(200, {
          item: {
            id: "i3",
            name: "زيت 1 لتر",
            sale_unit: { code: "pack", name: "عبوة", decimal_places: 0 },
          },
          branch_id: "b1",
          branch_name: "الفرع الرئيسي",
          range: "30",
          as_of: new Date().toISOString(),
          rows: [],
          balance_milli: "8000",
          total_count: 0,
          last_movement_at: "",
        }),
      ),
    );
    await login(page, "/inventory/items/i3?branch=b1&range=30");
    await page.getByRole("button", { name: "تسجيل التالف" }).click();
    await expect(page).toHaveURL(/\/inventory\/items\/i3\/damage$/);
    await expect(page.locator('[data-screen="INV-07"]')).toHaveAttribute("data-state", "ready");
  });
});
