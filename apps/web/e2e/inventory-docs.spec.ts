import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.29 — INV-03 افتتاحيات المخزون (4) + INV-04 استلام بضاعة (5). الافتتاحية مستند واحد يُراجَع
 * قبل الاعتماد بتحويل صريح إلى وحدة المخزون ولا تقدير؛ الاعتماد للمالك وأمين المخزن يرى «أُرسلت
 * للاعتماد»؛ الاستلام: المورد والمرجع والكمية مطلوبة والتكلفة اختيارية، الوحدة بلا معامل تُرفض،
 * يُحفظ محلياً أولاً ثم يُرفع، والمسار التالي «استلام آخر».
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const item = (
  id: string,
  name: string,
  base: [string, string, string, 0 | 3],
  extra: [string, string, number][],
  price: string,
) => ({
  id,
  name,
  name_normalized: name,
  group_id: "g-1",
  group_name: "بقالة",
  base_unit_id: base[0],
  base_unit_code: base[1],
  base_unit_name: base[2],
  base_unit_decimal_places: base[3],
  units: extra.map(([code, n, f]) => ({
    id: `iu-${id}-${code}`,
    unit_id: `u-${code}`,
    code,
    name: n,
    decimal_places: 0,
    factor_milli: String(f * 1000),
    barcode: "",
  })),
  barcode: "",
  sale_price_minor: price,
  price_updated_at: "2026-09-01T10:00:00.000Z",
  alert_threshold_milli: "",
  aliases: [] as string[],
  is_active: true,
  deactivated_at: "",
  updated_at: "2026-09-01T10:00:00.000Z",
});

const ITEMS = [
  item("i1", "سكر أبيض", ["u-bag", "bag", "كيس", 0], [["carton", "كرتونة 12×1كغ", 12]], "10000"),
  item(
    "i2",
    "شاي أسود",
    ["u-pack", "pack", "علبة", 0],
    [["carton24", "كرتونة 24×250غ", 24]],
    "24000",
  ),
  item("i3", "ملح طعام", ["u-pack", "pack", "عبوة", 0], [["carton0", "كرتونة 24 عبوة", 0]], "0"),
];

async function seed(page: Page, role: "owner" | "storekeeper" = "owner") {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, items }) => {
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
            branchName: "فرع بحري",
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
        for (const i of items) proj.put({ key: `entity:catalog.Item:${i.id}`, value: i });
        proj.put({
          key: "entity:parties.Party:sup-1",
          value: {
            id: "sup-1",
            name: "مخزن البركة للجملة",
            name_normalized: "مخزن البركة للجملة",
            phone: "",
            credit_limit_minor: "0",
            is_customer: false,
            is_supplier: true,
            distinct_from_id: "",
            balance_minor: "",
            last_sale_at: "",
            is_active: true,
            deactivated_at: "",
            updated_at: "2026-09-01T10:00:00.000Z",
          },
        });
        proj.put({
          key: "entity:inventory.Balance:i1",
          value: { item_id: "i1", qty_milli: "1362000", as_of: "2026-09-17T09:00:00.000Z" },
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role, items: ITEMS },
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

function pushRoute(page: Page, seen: Record<string, unknown>[], opts: { delayMs?: number } = {}) {
  return page.route("**/api/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: {
        operation_id: string;
        kind: string;
        members: { entity: string; payload: Record<string, unknown> }[];
      }[];
      request_id: string;
    };
    seen.push(...body.operations);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
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

const openingBody = (over: Record<string, unknown> = {}) => ({
  id: "op-1",
  branch_id: "b1",
  status: "approved",
  created_by_name: "عثمان",
  approved_by_name: "عثمان",
  approved_at: "2026-09-17T10:00:00.000Z",
  created_at: "2026-09-17T10:00:00.000Z",
  lines: [],
  line_count: 2,
  value_minor: "0",
  ...over,
});

function openingsRoute(
  page: Page,
  list: unknown,
  post: (body: Record<string, unknown>) => { status: number; body: unknown },
) {
  return page.route("**/api/inventory/openings", (route) =>
    route.request().method() === "GET"
      ? route.fulfill(json(200, list))
      : (() => {
          const r = post(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
          return route.fulfill(json(r.status, r.body));
        })(),
  );
}

const LIST = {
  branch_id: "b1",
  can_approve: true,
  openings: [],
  opened_item_ids: [],
  moved_item_ids: [],
};

test.describe("INV-03", () => {
  test("ready → success: مستند واحد بتحويل صريح إلى وحدة المخزون، ولا نقبل تقديراً، ثم سُجّلت الافتتاحيات", async ({
    page,
  }, info) => {
    await seed(page);
    const posted: Record<string, unknown>[] = [];
    await openingsRoute(page, LIST, (b) => {
      posted.push(b);
      return { status: 201, body: { opening: openingBody({ value_minor: "9000" }) } };
    });
    await login(page, "/inventory/openings");
    // السطر الأول: سكر بالكيس (وحدة الإدخال = وحدة المخزون)
    await page.getByLabel("الصنف").first().selectOption("i1");
    await page.getByLabel("الكمية").first().fill("1800");
    await page.getByRole("button", { name: "صنف آخر" }).click();
    // السطر الثاني: شاي بالكرتونة 24 — التحويل معروض صريحاً
    await page.getByLabel("الصنف").nth(1).selectOption("i2");
    await page.getByLabel("الوحدة المُدخلة").nth(1).selectOption("unit:iu-i2-carton24");
    await page.getByLabel("الكمية").nth(1).fill("15");
    await page.getByLabel("التكلفة — اختياري").nth(1).fill("6");
    await expectFrame(page, info, {
      screenId: "INV-03",
      state: "ready",
      texts: fromFrame("INV-03", "ready", [
        "افتتاحية المخزون — مراجعة قبل الاعتماد",
        "تُعتمد مرة واحدة لكل صنف. بعدها أي تغيير يكون جرداً أو تسوية بسبب، لا تعديل افتتاحية.",
        "مسودة —",
        "صنفاً",
        "الصنف",
        "الوحدة المُدخلة",
        "الكمية",
        "بوحدة المخزون",
        "المراجعة",
        "سكر أبيض",
        "كيس",
        "وحدة الإدخال = وحدة المخزون. لا تحويل.",
        "شاي أسود",
        "كرتونة 24×250غ",
        "علبة",
        "التحويل معروض صريحاً: 15 × 24 = 360. لا نخبّئ الحساب.",
        "التكلفة",
        "الافتتاحي يحمل تكلفةً تُدخَل يدوياً وتُوسم «يدوية»، وتُستبدل بأول مستند شراء حقيقي.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="INV-03"]');
    await expect(root).toContainText("مسودة — 2 صنفاً");
    await expect(root).toContainText("360 علبة");
    // تقدير بدل رقم: المراجعة ترفضه بنصّه
    await page.getByLabel("الكمية").first().fill("تقريباً نصف مخزن");
    await expect(root).toContainText(
      "أُدخل «تقريباً نصف مخزن» — لا نقبل تقديراً في افتتاحية. نطلب رقماً أو نترك الصنف بلا افتتاحية ويُبنى رصيده من أول استلام.",
    );
    await page.getByRole("button", { name: "اعتماد الافتتاحية" }).click();
    await expect(root).toHaveAttribute("data-state", "validation_error");
    expect(posted).toEqual([]);
    await page.getByLabel("الكمية").first().fill("1800");
    await page.getByRole("button", { name: "اعتماد الافتتاحية" }).click();
    await expectFrame(page, info, {
      screenId: "INV-03",
      state: "success",
      texts: fromFrame("INV-03", "success", [
        "سُجّلت الافتتاحيات",
        "عدد الأصناف والكميات وقيمتها، ومستندٌ واحد يجمعها قابل للطباعة والمراجعة.",
        "مستند لا حركات متفرّقة",
        "ليُراجَع ويُتراجع عنه كوحدة. افتتاحياتٌ مبثوثة لا يُعرف أيّها كان معاً.",
      ]),
    });
    await expect(root.locator(".shift-facts__v").first()).toHaveText("2");
    await expect(root.locator(".shift-facts__v").nth(1)).toHaveText("90.00");
    expect(posted).toEqual([
      {
        branch_id: "b1",
        lines: [
          {
            item_id: "i1",
            unit_code: "bag",
            unit_name: "كيس",
            factor_milli: "1000",
            qty_milli: "1800000",
            unit_cost_minor: "",
          },
          {
            item_id: "i2",
            unit_code: "carton24",
            unit_name: "كرتونة 24×250غ",
            factor_milli: "24000",
            qty_milli: "15000",
            unit_cost_minor: "600",
          },
        ],
      },
    ]);
  });

  test("validation_error: افتتاحي على صنف له حركات — المخرج تسوية جرد", async ({ page }, info) => {
    await seed(page);
    await openingsRoute(page, LIST, () => ({
      status: 400,
      body: {
        detail: "validation_error",
        errors: [{ line: 0, field: "item_id", code: "has_movements" }],
      },
    }));
    await login(page, "/inventory/openings");
    await page.getByLabel("الصنف").first().selectOption("i1");
    await page.getByLabel("الكمية").first().fill("1800");
    await page.getByRole("button", { name: "اعتماد الافتتاحية" }).click();
    await expectFrame(page, info, {
      screenId: "INV-03",
      state: "validation_error",
      texts: fromFrame("INV-03", "validation_error", [
        "افتتاحي على صنف له حركات",
        "الافتتاحي مرة واحدة وقبل أول حركة.",
        "المخرج",
        "تسوية جرد",
        "بسبب مكتوب — وهي الطريق الصحيح لتصحيح رصيد له تاريخ.",
        "سكر أبيض",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "كما في «الرصيد الافتتاحي للطرف»: الافتتاحي مرة واحدة وقبل أول حركة.",
    );
  });

  test("permission_denied: أمين المخزن يُدخل ولا يعتمد — «أُرسلت للاعتماد»", async ({
    page,
  }, info) => {
    await seed(page, "storekeeper");
    await openingsRoute(page, { ...LIST, can_approve: false }, () => ({
      status: 201,
      body: {
        opening: openingBody({
          status: "submitted",
          created_by_name: "هبة",
          approved_by_name: "",
          approved_at: "",
          line_count: 1,
        }),
      },
    }));
    await login(page, "/inventory/openings");
    await expect(page.getByRole("button", { name: "إرسال للاعتماد" })).toBeVisible();
    await page.getByLabel("الصنف").first().selectOption("i2");
    await page.getByLabel("الكمية").first().fill("360");
    await page.getByRole("button", { name: "إرسال للاعتماد" }).click();
    await expectFrame(page, info, {
      screenId: "INV-03",
      state: "permission_denied",
      texts: fromFrame("INV-03", "permission_denied", [
        "أُرسلت للاعتماد",
        "أمين المخزن يُدخل الافتتاحيات ولا يعتمدها. الاعتماد يُنشئ رصيداً يُحسب عليه كل شيء بعده، فهو صلاحية المالك أو من فوّضه. يظهر للأمين «أُرسلت للاعتماد» لا زرّ رمادي بلا تفسير.",
      ]),
    });
    await expect(page.locator('[data-screen="INV-03"]')).toContainText("مسودة — 1 صنفاً · هبة");
  });

  test("المالك يعتمد مستنداً مُرسلاً من الأمين", async ({ page }, info) => {
    await seed(page);
    await openingsRoute(
      page,
      {
        ...LIST,
        openings: [
          openingBody({
            id: "op-9",
            status: "submitted",
            created_by_name: "هبة",
            approved_by_name: "",
            approved_at: "",
            line_count: 3,
          }),
        ],
      },
      () => ({ status: 400, body: {} }),
    );
    await page.route("**/api/inventory/openings/op-9/approve", (route) =>
      route.fulfill(
        json(200, { opening: openingBody({ id: "op-9", line_count: 3, value_minor: "0" }) }),
      ),
    );
    await login(page, "/inventory/openings");
    const root = page.locator('[data-screen="INV-03"]');
    await expect(root).toContainText("أُرسلت للاعتماد");
    await expect(root).toContainText("3 صنفاً · هبة");
    await page.getByRole("button", { name: "اعتماد", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "INV-03",
      state: "success",
      texts: fromFrame("INV-03", "success", ["سُجّلت الافتتاحيات", "مستند لا حركات متفرّقة"]),
    });
    await expect(root.locator(".shift-facts__v").first()).toHaveText("3");
  });
});

const RECEIVE = "/inventory/receive";

test.describe("INV-04", () => {
  test("ready → saving → success: 40 كرتونة 12×1كغ = 480 كيس بلا تكلفة، ثم «استلام آخر»", async ({
    page,
  }, info) => {
    await seed(page);
    const pushed: Record<string, unknown>[] = [];
    await pushRoute(page, pushed, { delayMs: 2500 });
    await login(page, RECEIVE);
    await page.getByLabel("المورد").fill("مخزن البركة للجملة");
    await page.getByLabel("مرجع المستند").fill("فاتورة المورد 8841");
    await page.getByLabel("الصنف").first().selectOption("i1");
    await page.getByLabel("الوحدة").first().selectOption("unit:iu-i1-carton");
    await page.getByLabel("الكمية").first().fill("40");
    await expectFrame(page, info, {
      screenId: "INV-04",
      state: "ready",
      texts: fromFrame("INV-04", "ready", [
        "استلام بضاعة",
        "المورد والمرجع والكمية مطلوبة. التكلفة اختيارية.",
        "المورد",
        "مرجع المستند",
        "الكمية والوحدة",
        "التكلفة — اختياري",
        "اتركه فارغاً إن لم تعرفه الآن",
        "لا نفرض وحدة تكلفة.",
        "من يستلم كرتونة ولا يعرف سعر الحبّة يُدخل الكمية وحدها، والاستلام يكتمل. حساب تكلفة الوحدة يبقى معروضاً كأمر اختياري في",
        "— لا سدّاً يمنع دخول البضاعة.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator("body")).toContainText(
      "كأمر اختياري في «التكلفة والهامش» — لا سدّاً يمنع دخول البضاعة.",
    );
    const root = page.locator('[data-screen="INV-04"]');
    await expect(root).toContainText("40 كرتونة 12×1كغ = 480 كيس");
    await page.getByRole("button", { name: "تسجيل الاستلام" }).click();
    await expectFrame(page, info, {
      screenId: "INV-04",
      state: "saving",
      texts: fromFrame("INV-04", "saving", [
        "جارٍ الحفظ",
        "الاستلام يُحفظ محلياً أولاً ثم يُرفع — أمين المخزن قد يعمل في مخزنٍ بلا شبكة.",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "INV-04",
      state: "success",
      texts: fromFrame("INV-04", "success", [
        "استُلمت البضاعة",
        "الأصناف والكميات والموقع، وأثرها: المخزون زاد والتكلفة تحرّكت.",
        "المسار التالي",
        "واحد: «استلام آخر». من يستلم شحنةً يستلم عشراً — لا نُعيده إلى قائمة.",
        "استلام آخر",
      ]),
    });
    await expect(root).toContainText("RCV-KRT-A2-26-000001 · فاتورة المورد 8841");
    await expect(root).toContainText("40 كرتونة 12×1كغ = 480 كيس");
    expect(pushed).toHaveLength(1);
    const op = pushed[0] as {
      kind: string;
      members: { entity: string; payload: Record<string, unknown> }[];
    };
    expect(op.kind).toBe("stock_receipt");
    const head = op.members.find((m) => m.entity === "inventory.GoodsReceipt")!.payload;
    expect(head["supplier_name"]).toBe("مخزن البركة للجملة");
    expect(head["party_id"]).toBe("sup-1");
    const line = op.members.find((m) => m.entity === "inventory.GoodsReceiptLine")!.payload;
    expect(line["base_qty_milli"]).toBe("480000");
    expect(line["unit_cost_minor"]).toBe("");
    const mv = op.members.find((m) => m.entity === "inventory.StockMovement")!.payload;
    expect(mv["delta_base_qty_milli"]).toBe("480000");
    expect(mv["reason"]).toBe("receive");
    // الرصيد المحلي تحرّك فوراً: 1362 + 480 = 1842
    const bal = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const row = await new Promise<{ value: { qty_milli: string } }>((res) => {
        const r = db
          .transaction("projections")
          .objectStore("projections")
          .get("entity:inventory.Balance:i1");
        r.onsuccess = () => res(r.result as { value: { qty_milli: string } });
      });
      db.close();
      return row.value.qty_milli;
    });
    expect(bal).toBe("1842000");
    await page.getByRole("button", { name: "استلام آخر" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(page.getByLabel("المورد")).toHaveValue("");
  });

  test("validation_error: كمية بوحدة غير معرَّفة — لا تخمين؛ والمورد والمرجع مطلوبان", async ({
    page,
  }, info) => {
    await seed(page);
    await login(page, RECEIVE);
    await page.getByLabel("الصنف").first().selectOption("i3");
    await page.getByLabel("الوحدة").first().selectOption("unit:iu-i3-carton0");
    await page.getByLabel("الكمية").first().fill("5");
    await page.getByRole("button", { name: "تسجيل الاستلام" }).click();
    await expectFrame(page, info, {
      screenId: "INV-04",
      state: "validation_error",
      texts: fromFrame("INV-04", "validation_error", [
        "كمية بوحدة غير معرَّفة",
        "استلام «5 كراتين» وصنفٌ لا معامل كرتون له.",
        "لا تخمين",
        "المخزون يدخل بالوحدة الأساسية. نطلب المعامل الآن أو الاستلام بالوحدة الأساسية — والتخمين هنا يُدخل عشرة أضعاف.",
        "المورد",
        "مرجع المستند",
      ]),
    });
    await expect(page.locator('[data-screen="INV-04"]')).toContainText("المعامل غير محدَّد");
    // الاستلام بالوحدة الأساسية يحلّها
    await page.getByLabel("الوحدة").first().selectOption("base:u-pack");
    await page.getByLabel("المورد").fill("مورد");
    await page.getByLabel("مرجع المستند").fill("8842");
    await expect(page.locator('[data-screen="INV-04"]')).toHaveAttribute("data-state", "ready");
  });

  test("saved_local: بلا شبكة — حُفظ على الجهاز ولم يُرفع بعد، والرصيد المحلي تحدّث", async ({
    page,
    context,
  }, info) => {
    await seed(page, "storekeeper");
    await login(page, RECEIVE);
    await page.getByLabel("المورد").fill("مخزن البركة للجملة");
    await page.getByLabel("مرجع المستند").fill("فاتورة المورد 8841");
    await page.getByLabel("الصنف").first().selectOption("i1");
    await page.getByLabel("الوحدة").first().selectOption("unit:iu-i1-carton");
    await page.getByLabel("الكمية").first().fill("40");
    await context.setOffline(true);
    await page.getByRole("button", { name: "تسجيل الاستلام" }).click();
    await expectFrame(page, info, {
      screenId: "INV-04",
      state: "saved_local",
      texts: fromFrame("INV-04", "saved_local", ["استلام آخر", "المورد", "مرجع المستند"]),
    });
    // بطاقة saved_local في 28-D21 خارج عنصر INV-04 (تحت INV-03) — نصّها الحرفي يُفحص هنا
    await expect(page.locator('[data-screen="INV-04"]')).toContainText(
      "حُفظ على الجهاز — لم يُرفع بعد",
    );
    await expect(page.locator('[data-screen="INV-04"]')).toContainText(
      "الاستلام يعمل بلا شبكة. الرصيد المحلي يتحدّث فوراً، والحالة تقول «محفوظ على هذا الجهاز» لا «تم». لا نعرض تأكيداً خادمياً لم يحدث.",
    );
    await context.setOffline(false);
    await expect(page.locator('[data-screen="INV-04"]')).toContainText(
      "عملية واحدة معلقة من هذا الجهاز",
    );
  });
});
