import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T2.2 — ORG-03 الفروع وتفاصيلها (4) + ORG-04 قائمة الأجهزة وتفاصيلها (5). لا حذف لفرع له دفتر؛
 * الإنشاء للمالك ومدير الفرع يرى فرعه؛ الجهاز «آخر اتصال» رقم لا حالة وهمية، وغير المتصل ليس
 * معطّلاً (§٨.٢، §٩.٣، §١٠.١).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();

const dev = (o: Partial<Device> & { id: string; name: string }): Device => ({
  prefix: "A2",
  branch_id: "b1",
  branch_name: "فرع بحري",
  status: "active",
  connectivity: "connected",
  last_seen_at: ago(40),
  pending: 0,
  pending_at: "",
  users: [],
  registered_at: ago(86400),
  sells: true,
  ...o,
});
interface Device {
  id: string;
  name: string;
  prefix: string;
  branch_id: string;
  branch_name: string;
  status: string;
  connectivity: "connected" | "offline" | "stale" | "silent" | "revoked";
  last_seen_at: string;
  pending: number;
  pending_at: string;
  users: string[];
  registered_at: string;
  sells: boolean;
}

const DEVICES: Device[] = [
  dev({ id: "d1", name: "كاشير 1 — لوحي", users: ["سميّة", "كمال"], last_seen_at: ago(40) }),
  dev({
    id: "d2",
    name: "كاشير 2 — لوحي",
    users: ["كمال"],
    connectivity: "offline",
    last_seen_at: ago(3 * 3600),
  }),
  dev({
    id: "d3",
    name: "مكتب المخزن — سطح",
    branch_id: "b2",
    branch_name: "المخزن الرئيسي",
    users: ["هبة"],
    connectivity: "stale",
    last_seen_at: ago(5 * 86400),
    pending: 312,
  }),
  dev({
    id: "d4",
    name: "هاتف المالك",
    branch_name: "كل الفروع",
    users: ["عثمان"],
    last_seen_at: ago(11 * 60),
    sells: false,
  }),
];

const devicesPayload = (devices = DEVICES) => ({
  devices,
  counts: { total: devices.length, active: devices.length, pending_total: 312 },
  device_limit: 6,
  as_of: ago(60),
});

const branch = (o: Record<string, unknown>) => ({
  id: "b1",
  name: "الرئيسي",
  code: "KRT",
  is_active: true,
  is_default: true,
  code_locked: true,
  ledger: {
    invoices: 1240,
    shifts: 96,
    open_shifts: 0,
    stock_items: 0,
    receivables_minor: "3200000",
    has_ledger: true,
  },
  devices: [] as Device[],
  staff: 3,
  ...o,
});
const BAHRI = branch({
  id: "b2",
  name: "فرع بحري",
  code: "BHR",
  is_default: false,
  ledger: {
    invoices: 410,
    shifts: 32,
    open_shifts: 0,
    stock_items: 96,
    receivables_minor: "1250000",
    has_ledger: true,
  },
  devices: [
    dev({ id: "d1", name: "حاسوب الكاشير 1 — الرئيسي", last_seen_at: ago(120) }),
    dev({
      id: "d5",
      name: "هاتف المخزن — بحري",
      pending: 9,
      connectivity: "offline",
      last_seen_at: ago(3600),
    }),
    dev({ id: "d6", name: "حاسوب الإدارة", sells: false }),
    dev({ id: "d7", name: "جهاز قديم", connectivity: "stale", last_seen_at: ago(12 * 86400) }),
  ],
});

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

test.describe("ORG-03", () => {
  test("empty → ready → validation_error: فرع واحد حالةٌ سويّة؛ لا حذف لفرع له دفتر — الإقفال بعد تحويل المخزون", async ({
    page,
  }, info) => {
    let created = false;
    await page.route("**/api/org/branches", (route) => {
      if (route.request().method() === "POST") {
        created = true;
        return route.fulfill(json(201, BAHRI));
      }
      return route.fulfill(
        json(200, { branches: created ? [branch({}), BAHRI] : [branch({})], can_create: true }),
      );
    });
    await login(page, "/org/branches");
    await expectFrame(page, info, {
      screenId: "ORG-03",
      state: "empty",
      texts: fromFrame("ORG-03", "empty", [
        "الفروع وتفاصيلها",
        "ثلاث حالات ناقصة. الفرع وحدة مخزون وصندوق لا عنوان.",
        "فرع واحد",
        "أغلب المحلات فرعٌ واحد. لا نعرض هذا فراغاً بل حالةً سويّة.",
        "متى يُقترح الثاني",
        "لا نقترحه. إضافة فرع قرار توسّع تجاري، واقتراحه من شاشة إعدادات عبثٌ.",
        "الفروع ومخازنها",
        "لا حذف",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await page.getByRole("button", { name: "فرع جديد" }).click();
    await page.getByLabel("اسم الفرع").fill("فرع بحري");
    await page.getByLabel("رمز الفرع في الترقيم").fill("bhr");
    await page.getByRole("button", { name: "إنشاء الفرع" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-03",
      state: "ready",
      texts: fromFrame("ORG-03", "ready", [
        "الفروع ومخازنها",
        "لكل فرع مخزنه وصناديقه وأجهزته وموظفوه. والحذف غير موجود: الفرع يُعطَّل ويبقى تاريخه.",
        "لا حذف",
        "فرعٌ باع سنةً لا يُحذف — حذفه يُيتّم فواتير ومخزوناً. التعطيل يمنع الجديد ويُبقي القديم مقروءاً.",
      ]),
    });
    const root = page.locator('[data-screen="ORG-03"]');
    await expect(root).toContainText("فرع بحري");
    await expect(root).toContainText("الرمز ثابت بعد أول فاتورة");
    // الحذف محجوب: ما يحمله الفرع والأجهزة المرتبطة
    await page.getByRole("button", { name: "حذف", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "ORG-03",
      state: "validation_error",
      texts: fromFrame("ORG-03", "validation_error", [
        "إجراء محجوب",
        "لا يمكن حذف «فرع بحري»",
        "الحذف يترك فواتير بلا فرع وأرصدة بلا موضع، ويكسر تقارير أشهر مضت.",
        "ما يحمله هذا الفرع",
        "البديل: إقفال الفرع.",
        "لا يختفي، والذمم تبقى منسوبة لأطرافها.",
        "إقفال الفرع بعد تحويل المخزون",
        "حذف — غير متاح",
        "الأجهزة المرتبطة",
        "الجهاز يحمل معلّقاً محلياً — فصله ليس إلغاء اشتراك",
        "قبل فصل أي جهاز",
        "فواتير صادرة",
        "ورديات مسجَّلة",
        "مخزون حالي",
        "ذمم منسوبة لمعاملاته",
        "حاسوب الكاشير 1 — الرئيسي",
        "نظيف",
        "هاتف المخزن — بحري",
        "معلّق",
        "حاسوب الإدارة",
        "متصل · قراءة تقارير فقط بحكم دور مستخدمه",
        "لا نفترض فقده ولا نفصله تلقائياً. نعرض آخر ظهوره وتقرر أنت.",
        "صامت",
      ]),
    });
    await expect(root).toContainText("96 صنفاً");
    await expect(root).toContainText("9 عمليات محفوظة محلياً لم تُرفع. فصله الآن يفقدها.");
    await expect(root).toContainText("آخر ظهور");
    // المخزون لم يُحوَّل → الإقفال معطّل بسببه؛ الحذف غير متاح دائماً
    await expect(
      page.getByRole("button", { name: "إقفال الفرع بعد تحويل المخزون" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "حذف — غير متاح" })).toBeDisabled();
  });

  test("بلوغ حدّ الفروع: الرسالة تقول الحدّ ومخرجَيه لا «اكتب اسم الفرع»", async ({ page }) => {
    await page.route("**/api/org/branches", (route) =>
      route.request().method() === "POST"
        ? route.fulfill(json(400, { detail: "branch_limit" }))
        : route.fulfill(json(200, { branches: [branch({})], can_create: true })),
    );
    await login(page, "/org/branches");
    await page.getByRole("button", { name: "فرع جديد" }).click();
    await page.getByLabel("اسم الفرع").fill("فرع بحري");
    await page.getByLabel("رمز الفرع في الترقيم").fill("bhr");
    await page.getByRole("button", { name: "إنشاء الفرع" }).click();
    await expect(page.locator('[data-screen="ORG-03"]')).toContainText(
      "بلغت حدّ الفروع في باقتك — رقِّ الباقة أو أضف فرعاً من شاشة الاشتراك",
    );
    await expect(page.locator('[data-screen="ORG-03"]')).not.toContainText("اكتب اسم الفرع");
  });

  test("permission_denied: مدير الفرع يرى فرعه ولا يُنشئ", async ({ page }, info) => {
    await page.route("**/api/org/branches", (route) =>
      route.fulfill(json(200, { branches: [BAHRI], can_create: false })),
    );
    await login(page, "/org/branches");
    await expectFrame(page, info, {
      screenId: "ORG-03",
      state: "permission_denied",
      texts: fromFrame("ORG-03", "permission_denied", [
        "مدير الفرع يرى فرعه",
        "يرى تفاصيل فرعه ويعدّل ما يخصّه، ولا يرى الفروع الأخرى ولا يُنشئ.",
        "الإنشاء للمالك",
        "الفرع يستهلك من الباقة ويُنشئ مخزناً وصندوقاً — التزامٌ مالي وتشغيلي.",
      ]),
    });
    await expect(page.getByRole("button", { name: "فرع جديد" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "حذف", exact: true })).toHaveCount(0);
  });
});

test.describe("ORG-04", () => {
  test("loading → ready: «آخر اتصال» رقم لا حالة وهمية؛ stale عند تعذّر التحديث؛ offline بالكاش", async ({
    page,
    context,
  }, info) => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    let fail = false;
    let hits = 0;
    await page.route("**/api/org/devices", async (route) => {
      await gate;
      hits += 1;
      if (fail) return route.fulfill(json(503, { detail: "down" }));
      return route.fulfill(json(200, devicesPayload()));
    });
    await login(page, "/org/devices");
    await expectFrame(page, info, {
      screenId: "ORG-04",
      state: "loading",
      texts: fromFrame("ORG-04", "loading", [
        "قائمة الأجهزة وتفاصيلها",
        "حالتان ناقصتان. الجهاز عهدةٌ عليها عمل.",
        "جلب الأجهزة",
        "مع حالة المزامنة لكل جهاز — وهي سبب فتح الشاشة غالباً.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    release!();
    await expectFrame(page, info, {
      screenId: "ORG-04",
      state: "ready",
      texts: fromFrame("ORG-04", "ready", [
        "الجهاز",
        "الفرع والمستخدمون",
        "آخر اتصال ناجح",
        "غير مرفوع",
        "الحالة",
        "سحب الجهاز فعل منفصل عن تعطيل مستخدم",
        "كاشير 1 — لوحي",
        "فرع بحري",
        "سميّة · كمال",
        "يرفع فوراً",
        "متصل",
        "كاشير 2 — لوحي",
        "يبيع محلياً الآن على الأرجح — غير متصل لا يعني متوقفاً",
        "غير متصل",
        "مكتب المخزن — سطح",
        "المخزن الرئيسي",
        "هبة",
        "متقادم",
        "هاتف المالك",
        "كل الفروع",
        "عثمان",
        "عرض ومتابعة فقط — لا بيع من هذا الجهاز",
      ]),
    });
    const root = page.locator('[data-screen="ORG-04"]');
    await expect(root).toContainText("الأجهزة — 4 من حدّ الباقة 6");
    await expect(root).toContainText(/قبل [0-9]+ ثانية/);
    await expect(root).toContainText("قبل 3 ساعات");
    await expect(root).toContainText("قبل 5 أيام");
    await expect(root).toContainText("السحب قبل الرفع يفقد 312 عملية.");
    await expect(root).toContainText("آخر تحديث قبل دقيقة");
    // الخادم يتعذّر → القائمة قديمة من الكاش
    fail = true;
    await page.route("**/api/org/branches", (route) =>
      route.fulfill(json(200, { branches: [branch({})], can_create: true })),
    );
    await navTo(page, "الفروع", { exact: true });
    await expect(page).toHaveURL(/\/org\/branches$/);
    await navTo(page, "الأجهزة", { exact: true });
    await expect(page).toHaveURL(/\/org\/devices$/);
    expect(hits).toBeGreaterThanOrEqual(2);
    await expectFrame(page, info, {
      screenId: "ORG-04",
      state: "stale",
      texts: fromFrame("ORG-04", "stale", ["الجهاز", "آخر اتصال ناجح", "غير مرفوع", "متقادم"]),
    });
    await expect(root).toContainText("القائمة قديمة");
    // بلا اتصال: القائمة كما كانت
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "ORG-04",
      state: "offline",
      texts: fromFrame("ORG-04", "offline", ["الجهاز", "الفرع والمستخدمون", "كاشير 1 — لوحي"]),
    });
    await context.setOffline(false);
  });

  test("empty: لا أجهزة مسجّلة — المسار «جهّز هذا الجهاز»", async ({ page }, info) => {
    await page.route("**/api/org/devices", (route) => route.fulfill(json(200, devicesPayload([]))));
    await login(page, "/org/devices");
    await expectFrame(page, info, {
      screenId: "ORG-04",
      state: "empty",
      texts: fromFrame("ORG-04", "empty", [
        "لا أجهزة مسجّلة",
        "منشأة أُنشئت ولم يُهيّأ عليها جهاز بعد.",
        "المسار",
        "«جهّز هذا الجهاز»",
        "والأغلب أن من يقرأ هذا يقرؤه على الجهاز الذي يريد تهيئته.",
      ]),
    });
  });
});
