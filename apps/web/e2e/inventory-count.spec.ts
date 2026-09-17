import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.30 — INV-05 جلسة جرد (6) + INV-06 مراجعة الفروق وتسوية (4). المتوقَّع محجوب حتى يُدخل المعدود
 * (القاعدة 9 — رصيد النظام ليس في DOM قبل الإدخال)؛ يُحفظ بعد كل صنف ويُستأنف؛ الجرد الجزئي مشروع ولا
 * نسوّي ما لم يُعدّ؛ الإغلاق يوثّق ولا يُسوّي؛ التسوية بسبب لكل فرق وصلاحية مالية — من يعدّ ليس من
 * يسوّي؛ العدّ الأصلي لا يُعاد كتابته.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const item = (id: string, name: string, unit: string, price: string) => ({
  id,
  name,
  name_normalized: name,
  group_id: "g-1",
  group_name: "بقالة",
  base_unit_id: `u-${id}`,
  base_unit_code: unit,
  base_unit_name: unit,
  base_unit_decimal_places: 0,
  units: [],
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
  item("i1", "سكر أبيض", "كيس", "10000"),
  item("i2", "شاي أسود", "علبة", "24000"),
  item("i3", "زيت طعام", "عبوة", "78000"),
];
const BALANCES: Record<string, string> = { i1: "1842000", i2: "340000", i3: "88000" };

async function seed(page: Page, role: "owner" | "storekeeper" = "owner", open?: unknown) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, items, balances, open }) => {
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
            userName: "عثمان ك.",
            roleName: role === "owner" ? "مالك" : "أمين مخزن",
            roleCode: role,
          }),
        });
        for (const i of items) proj.put({ key: `entity:catalog.Item:${i.id}`, value: i });
        for (const [id, qty] of Object.entries(balances))
          proj.put({
            key: `entity:inventory.Balance:${id}`,
            value: { item_id: id, qty_milli: qty, as_of: "2026-09-17T09:00:00.000Z" },
          });
        if (open) meta.put({ key: "inventory.count_session", value: JSON.stringify(open) });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role, items: ITEMS, balances: BALANCES, open: open ?? null },
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

const COUNT = "/inventory/count";

const countInput = (page: Page, name: string) =>
  page.getByLabel(`العدّ الفعلي — ${name}`, { exact: true });

const COUNT_HEAD = [
  "جرد الفرع الرئيسي — بدأ",
  "أمين المخزن: عثمان ك.",
  "محفوظ محلياً ·",
  "الصنف",
  "رصيد النظام",
  "العدّ الفعلي",
  "الفرق",
  "العدّ محفوظ على الجهاز ويستأنف بعد انقطاع الكهرباء.",
  "لم يتغير أي رصيد بعد",
  "— التسوية تحتاج مراجعة واعتماداً في",
  "INV-06",
  "إنهاء العدّ ومراجعة الفروق",
  "حفظ ومتابعة لاحقاً",
  "القاعدة نفسها",
  "«لا تُرِ المتوقَّع قبل العدّ» (SHIFT-04). والفرق يُعرض بعد تأكيد العدّ لا قبله.",
];

test.describe("INV-05", () => {
  test("ready → saved_local: المتوقَّع محجوب حتى يُدخل المعدود؛ يُحفظ بعد كل صنف ويُستأنف", async ({
    page,
  }, info) => {
    await seed(page);
    await login(page, COUNT);
    await expectFrame(page, info, {
      screenId: "INV-05",
      state: "ready",
      texts: fromFrame("INV-05", "ready", COUNT_HEAD),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="INV-05"]');
    // القاعدة 9: رصيد النظام ليس في DOM قبل الإدخال
    await expect(root).not.toContainText("1842");
    await expect(root).not.toContainText("340");
    await expect(root).toContainText("محفوظ محلياً · 0 من 3");
    await countInput(page, "سكر أبيض").fill("1834");
    await countInput(page, "سكر أبيض").press("Enter");
    await expectFrame(page, info, {
      screenId: "INV-05",
      state: "saved_local",
      texts: fromFrame("INV-05", "saved_local", [...COUNT_HEAD, "سكر أبيض"]),
    });
    // بعد الإدخال: رصيد النظام والفرق يظهران لهذا الصنف وحده
    const sugarRow = root.locator("tbody tr").filter({ hasText: "سكر أبيض" });
    await expect(sugarRow).toContainText("1842");
    await expect(sugarRow).toContainText("−8");
    await expect(root).not.toContainText("340");
    await expect(root).toContainText("محفوظ محلياً · 1 من 3");
    // العدّاد −/+ يحفظ أيضاً
    await page.getByRole("button", { name: "زيادة — شاي أسود" }).click();
    await expect(root).toContainText("محفوظ محلياً · 2 من 3");
    // الاستئناف: الخروج ثم العودة (الجلسة في الذاكرة فالتنقّل من داخل التطبيق) — العدّ محفوظ
    await page.route("**/api/inventory/balances**", (route) => route.fulfill(json(500, {})));
    await page.getByRole("button", { name: "حفظ ومتابعة لاحقاً" }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await page.getByRole("button", { name: "جلسة جرد" }).click();
    await expect(page).toHaveURL(/\/inventory\/count$/);
    await expect(page.locator('[data-screen="INV-05"]')).toHaveAttribute(
      "data-state",
      "saved_local",
    );
    await expect(countInput(page, "سكر أبيض")).toHaveValue("1834");
    await expect(page.locator('[data-screen="INV-05"]')).toContainText("محفوظ محلياً · 2 من 3");
  });

  test("partial → saving → success: جرد جزئي مشروع، والإغلاق يوثّق ولا يُسوّي", async ({
    page,
  }, info) => {
    await seed(page);
    const pushed: Record<string, unknown>[] = [];
    await pushRoute(page, pushed, { delayMs: 2500 });
    await login(page, COUNT);
    await countInput(page, "سكر أبيض").fill("1834");
    await countInput(page, "سكر أبيض").press("Enter");
    await page.getByRole("button", { name: "إنهاء العدّ ومراجعة الفروق" }).first().click();
    await expectFrame(page, info, {
      screenId: "INV-05",
      state: "partial",
      texts: fromFrame("INV-05", "partial", [
        "جرد جزئي",
        "صنفاً من",
        "وأُغلقت الجلسة. حالةٌ مشروعة: جردُ فئةٍ أو رفٍّ.",
        "لا نسوّي ما لم يُعدّ",
        "الأصناف غير المعدودة تبقى بأرصدتها ولا تُصفَّر. التسوية تمسّ المعدود وحده — وهذا أهم قرار في الشاشة.",
        "إنهاء العدّ ومراجعة الفروق",
        "حفظ ومتابعة لاحقاً",
      ]),
    });
    const root = page.locator('[data-screen="INV-05"]');
    await expect(root).toContainText("عُدّ 1 صنفاً من 3 وأُغلقت الجلسة");
    await root
      .locator(".c-notice")
      .getByRole("button", { name: "إنهاء العدّ ومراجعة الفروق" })
      .click();
    await expectFrame(page, info, {
      screenId: "INV-05",
      state: "saving",
      texts: fromFrame("INV-05", "saving", ["حفظ العدّ", "يُحفظ بعد كل صنف لا في النهاية."]),
    });
    await expectFrame(page, info, {
      screenId: "INV-05",
      state: "success",
      texts: fromFrame("INV-05", "success", [
        "أُغلقت الجلسة",
        "المعدود والمتوقَّع والفوارق بعددها وقيمتها. والتسوية قرارٌ تالٍ في INV-06 لا أثرٌ تلقائي.",
        "الإغلاق لا يُسوّي",
        "الجرد يوثّق ما عُدّ؛ والتسوية تُحرّك المخزون وتحتاج اعتماداً. فصلهما يمنع تسوياتٍ بالسهو.",
      ]),
    });
    await expect(root).toContainText("CNT-KRT-A2-26-000001");
    await expect(root.locator(".shift-facts")).toContainText("1 من 3");
    // الفوارق: −8 كيس × 100.00 = −800.00
    await expect(root.locator(".shift-facts")).toContainText("1 · بقيمة −800.00");
    expect(pushed).toHaveLength(1);
    const op = pushed[0] as {
      kind: string;
      members: { entity: string; payload: Record<string, unknown> }[];
    };
    expect(op.kind).toBe("count_session");
    expect(op.members.filter((m) => m.entity === "inventory.StockMovement")).toHaveLength(0);
    const line = op.members.find((m) => m.entity === "inventory.CountLine")!.payload;
    expect(line["counted_qty_milli"]).toBe("1834000");
    expect(line["system_qty_milli"]).toBe("1842000");
    // الرصيد المحلي لم يتغيّر (الإغلاق لا يُسوّي)
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
    await page.getByRole("button", { name: "مراجعة الفروق" }).click();
    await expect(page).toHaveURL(/\/inventory\/count\/[0-9a-f-]+\/review$/);
  });

  test("offline: جرد بلا اتصال — العدّ محلي كاملاً والخطر مُعلن", async ({
    page,
    context,
  }, info) => {
    await seed(page);
    await login(page, COUNT);
    await context.setOffline(true);
    await countInput(page, "زيت طعام").fill("85");
    await countInput(page, "زيت طعام").press("Enter");
    await expectFrame(page, info, {
      screenId: "INV-05",
      state: "offline",
      texts: fromFrame("INV-05", "offline", [
        "جرد بلا اتصال",
        "الحالة الطبيعية: المخازن بلا تغطية غالباً. العدّ محلي كاملاً.",
        "الخطر المُعلن",
        "بيعٌ يقع على جهاز آخر أثناء الجرد. يُكتشف عند المزامنة ويُعرض في مراجعة الفروق (ACC-07).",
      ]),
    });
    await expect(page.locator('[data-screen="INV-05"]')).toContainText("محفوظ محلياً · 1 من 3");
    await context.setOffline(false);
  });
});

const REVIEW = "/inventory/count/sess-1/review";

const reviewBody = (over: Record<string, unknown> = {}) => ({
  session: {
    id: "sess-1",
    session_number: "CNT-KRT-A2-26-000001",
    branch_id: "b1",
    branch_name: "الفرع الرئيسي",
    status: "closed",
    user_name: "عثمان ك.",
    total_items: 34,
    counted_items: 34,
    started_at: "2026-09-13T09:15:00.000Z",
    closed_at: "2026-09-13T11:40:00.000Z",
  },
  rows: [
    row("i1", "سكر أبيض", "كيس", "1842000", "1834000", "-8000", "-80000", false),
    row("i2", "شاي أسود", "علبة", "340000", "346000", "6000", "144000", false),
    row("i3", "زيت طعام", "عبوة", "88000", "85000", "-3000", "-234000", true),
    row("i4", "معلّبات", "علبة", "210000", "188000", "-22000", "-224000", false),
    row("i5", "دقيق", "كيس", "42000", "42000", "0", "0", false),
  ],
  variance_count: 4,
  effect_minor: "-394000",
  suggested_reasons: ["تالف", "سرقة", "خطأ عدّ", "خطأ استلام"],
  adjustment: null,
  can_adjust: true,
  ...over,
});

function row(
  id: string,
  name: string,
  unit: string,
  book: string,
  counted: string,
  delta: string,
  value: string,
  moved: boolean,
) {
  return {
    line_id: `ln-${id}`,
    item_id: id,
    item_name: name,
    unit_name: unit,
    book_milli: book,
    counted_milli: counted,
    system_at_count_milli: book,
    delta_milli: delta,
    value_minor: value,
    moved_since_count: moved,
  };
}

function reviewRoute(
  page: Page,
  get: unknown,
  post?: (b: Record<string, unknown>) => { status: number; body: unknown },
) {
  return page.route("**/api/inventory/count-sessions/sess-1", (route) => {
    if (route.request().method() === "GET") return route.fulfill(json(200, get));
    const r = post
      ? post(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>)
      : { status: 400, body: {} };
    return route.fulfill(json(r.status, r.body));
  });
}

const reason = (page: Page, name: string) => page.getByLabel(`السبب — ${name}`);

const REVIEW_HEAD = [
  "مراجعة فروق الجرد وتسوية — لا فرق يُمرَّر بلا سبب مكتوب",
  "الجرد يُنتج فروقاً؛ التسوية تُنشئ حركة بسبب وفاعل ومستند. ولا يوجد «قبول الكل» يمحو أثر عشرين فرقاً بضغطة واحدة.",
  "جلسة جرد",
  "فروق من",
  "صنفاً",
  "العدّ الفعلي محفوظ كما أُدخل. الرصيد لم يتغيّر بعد — يتغيّر عند التسوية فقط.",
  "أثر التسوية",
  "SDG",
  "الصنف",
  "الدفتري",
  "المعدود",
  "الفرق",
  "السبب — مطلوب لكل صف",
  "سكر أبيض — كيس",
  "شاي أسود — علبة",
  "زيت طعام — عبوة",
  "معلّبات — علبة",
];

test.describe("INV-06", () => {
  test("ready → validation_error → success: سبب لكل فرق، لا سبب عامّ، ثم سُوّيت 4 فروق — مستند TS", async ({
    page,
  }, info) => {
    await seed(page);
    const posted: Record<string, unknown>[] = [];
    await reviewRoute(page, reviewBody(), (b) => {
      posted.push(b);
      const reasons = b["reasons"] as Record<string, string>;
      if (!reasons["i4"])
        return {
          status: 400,
          body: {
            detail: "validation_error",
            errors: [{ item_id: "i4", field: "reason", code: "required" }],
          },
        };
      return {
        status: 201,
        body: reviewBody({
          session: { ...reviewBody().session, status: "adjusted" },
          adjustment: {
            id: "adj-1",
            adjustment_number: "TS-0914",
            decided_by_name: "عثمان ك.",
            line_count: 4,
          },
        }),
      };
    });
    await login(page, REVIEW);
    await expectFrame(page, info, {
      screenId: "INV-06",
      state: "ready",
      texts: fromFrame("INV-06", "ready", REVIEW_HEAD),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="INV-06"]');
    await expect(root).toContainText("جلسة جرد 13/09 — 4 فروق من 34 صنفاً");
    await expect(root).toContainText("أثر التسوية −3,940.00 SDG");
    // حركة وقعت أثناء الجرد مُعلنة على صفّها
    await expect(root.locator("tbody tr").filter({ hasText: "زيت طعام" })).toContainText(
      "بيعٌ يقع على جهاز آخر أثناء الجرد",
    );
    // صف بلا فرق لا يطلب سبباً
    await expect(root.locator("tbody tr").filter({ hasText: "دقيق" })).toContainText("—");
    await reason(page, "سكر أبيض — كيس").fill("عبوات ممزّقة في الرفّ السفلي — أُتلفت");
    await reason(page, "شاي أسود — علبة").fill("خطأ عدّ في جرد سابق — صُحّح");
    await reason(page, "زيت طعام — عبوة").fill(
      "خطأ استلام — الكرتونة كانت ناقصة عند الوصول، أُبلغ المورد",
    );
    await page.getByRole("button", { name: "تسوية الفروق" }).click();
    await expectFrame(page, info, {
      screenId: "INV-06",
      state: "validation_error",
      texts: fromFrame("INV-06", "validation_error", [
        ...REVIEW_HEAD,
        "فرق بلا سبب.",
        "لا نحفظ التسوية ولا نكتب «تسوية جرد» سبباً عامّاً — سبب الفرق هو الفرق الوحيد بين تصحيح مشروع وإخفاء نقص. نعرض قائمة أسباب مقترحة (تالف، سرقة، خطأ عدّ، خطأ استلام) مع حقل حرّ.",
        "مطلوب — أدخل سبباً لهذا الفرق",
      ]),
    });
    expect(posted).toEqual([]);
    await reason(page, "معلّبات — علبة").fill("تالف");
    await page.getByRole("button", { name: "تسوية الفروق" }).click();
    await expectFrame(page, info, {
      screenId: "INV-06",
      state: "success",
      texts: fromFrame("INV-06", "success", [
        "سُوّيت",
        "فروق — مستند",
        "الرصيد تغيّر بحركة لها مستند وفاعل وسبب، وتظهر في INV-02 كسطر «تسوية جرد» لا كرصيد تغيّر بلا تفسير. العدّ الأصلي محفوظ كما أُدخل ولا يُعاد كتابته.",
      ]),
    });
    await expect(root).toContainText("سُوّيت 4 فروق — مستند TS-0914");
    expect(posted).toEqual([
      {
        reasons: {
          i1: "عبوات ممزّقة في الرفّ السفلي — أُتلفت",
          i2: "خطأ عدّ في جرد سابق — صُحّح",
          i3: "خطأ استلام — الكرتونة كانت ناقصة عند الوصول، أُبلغ المورد",
          i4: "تالف",
        },
      },
    ]);
  });

  test("permission_denied: من يعدّ ليس من يسوّي — أُرسلت الفروق للمراجعة", async ({
    page,
  }, info) => {
    await seed(page, "storekeeper");
    await reviewRoute(page, reviewBody({ can_adjust: false }));
    await login(page, REVIEW);
    await expectFrame(page, info, {
      screenId: "INV-06",
      state: "permission_denied",
      texts: fromFrame("INV-06", "permission_denied", [
        ...REVIEW_HEAD,
        "من يعدّ ليس من يسوّي",
        "أمين المخزن أدخل العدّ، والتسوية تحتاج صلاحية مالية. الفصل مقصود: لو عدّ وسوّى الشخص نفسه صار النقص قابلاً للإخفاء بلا شاهد. يظهر له «أُرسلت الفروق للمراجعة» مع نسخة من عدّه.",
        "أُرسلت الفروق للمراجعة",
      ]),
    });
    await expect(page.getByRole("button", { name: "تسوية الفروق" })).toBeDisabled();
  });
});
