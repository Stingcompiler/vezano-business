import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/** T1.8 — CAT-01 (5) + CAT-06 (4). بيانات الإطار 05-D2 كما هي؛ الخادم يُحاكى على مستوى الشبكة. */
const json = (status: number, body: unknown) => ({ status, json: body });

const unit = (id: string, code: string, name: string) => ({
  base_unit_id: id,
  base_unit_code: code,
  base_unit_name: name,
});
const item = (
  id: string,
  name: string,
  aliases: string[],
  group: string,
  base: [string, string, string],
  extra: [string, number][],
  price: string,
  barcode: string,
  active = true,
) => ({
  id,
  name,
  name_normalized: name,
  group_id: group ? `g-${group}` : "",
  group_name: group,
  ...unit(...base),
  units: extra.map(([n, f]) => ({
    unit_id: `u-${n}`,
    code: n,
    name: n,
    factor_milli: String(f * 1000),
  })),
  barcode,
  sale_price_minor: price,
  price_updated_at: new Date().toISOString(),
  aliases,
  is_active: active,
  deactivated_at: active ? "" : new Date().toISOString(),
  updated_at: new Date().toISOString(),
});
const ITEMS = [
  item(
    "i1",
    "سكر",
    ["سكر أبيض"],
    "بقالة",
    ["u-kg", "kg", "كغ"],
    [["كرتونة", 12]],
    "10000",
    "6291000000142",
  ),
  item(
    "i2",
    "شاي أسود 250غ",
    [],
    "مشروبات",
    ["u-pack", "pack", "عبوة"],
    [],
    "24000",
    "6291000000338",
  ),
  item(
    "i3",
    "زيت 1 لتر",
    ["زيت طعام"],
    "بقالة",
    ["u-pack", "pack", "عبوة"],
    [["كرتونة", 12]],
    "78000",
    "6291000000501",
  ),
  item("i4", "دقيق 5 كغ", [], "بقالة", ["u-bag", "bag", "كيس"], [], "145000", "6291000000677"),
  item(
    "i5",
    "أرز 1 كغ",
    [],
    "بقالة",
    ["u-kg", "kg", "كغ"],
    [["كرتونة", 25]],
    "32000",
    "6291000000712",
  ),
  item(
    "i6",
    "صابون قديم",
    ["صابون أزرق"],
    "منظفات",
    ["u-piece", "piece", "قطعة"],
    [],
    "8000",
    "6291000000899",
    false,
  ),
  item(
    "i7",
    "ماء 1.5 لتر",
    [],
    "مشروبات",
    ["u-pack", "pack", "عبوة"],
    [["كرتونة", 6]],
    "7500",
    "6291000000954",
  ),
];
const GROUPS = [
  { id: "g-بقالة", name: "بقالة" },
  { id: "g-مشروبات", name: "مشروبات" },
  { id: "g-منظفات", name: "منظفات" },
];

function listResponse(query: URL) {
  const q = query.searchParams.get("q") ?? "";
  const inactive = query.searchParams.get("include_inactive") === "true";
  const gid = query.searchParams.get("group_id") ?? "";
  const rows = ITEMS.filter(
    (i) =>
      (inactive || i.is_active) &&
      (!gid || i.group_id === gid) &&
      (!q || i.name.startsWith(q) || i.aliases.some((a) => a.startsWith(q))),
  );
  return { items: rows, total: rows.length, all_total: 412, groups: GROUPS, offset: 0 };
}

async function login(page: Page, next = "/catalog") {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/catalog/items?**", (route) =>
    route.fulfill(json(200, listResponse(new URL(route.request().url())))),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace("/", "\\/")}$`));
}

test.describe("CAT-01", () => {
  test("ready: القائمة بأعمدتها والمعطَّل مستبعد افتراضياً", async ({ page }, info) => {
    await login(page);
    await expectFrame(page, info, {
      screenId: "CAT-01",
      state: "ready",
      texts: fromFrame("CAT-01", "ready", [
        "كل المجموعات",
        "بقالة",
        "مشروبات",
        "النشط فقط",
        "صنف جديد",
        "الصنف",
        "المجموعة",
        "الوحدات",
        "سعر البيع",
        "الباركود",
        "الحالة",
        "فتح",
        "سكر",
        "سكر أبيض",
        "شاي أسود 250غ",
        "زيت 1 لتر",
        "زيت طعام",
        "دقيق 5 كغ",
        "أرز 1 كغ",
        "ماء 1.5 لتر",
        "صنفاً ·",
        "معروضة · الصنف المعطَّل يبقى في الفواتير والتقارير القديمة ولا يظهر في البحث داخل نقطة البيع",
      ]),
    });
    await expect(page.locator('[data-screen="CAT-01"]')).not.toContainText("صابون قديم");
    await expect(page.locator('[data-screen="CAT-01"]')).toContainText("100.00");
    await expect(page.locator('[data-screen="CAT-01"]')).toContainText("كرتونة = 12");
    // يشمل المعطَّل
    await page.getByLabel("الحالة").selectOption("all");
    await expect(page.locator('[data-screen="CAT-01"]')).toContainText("صابون قديم");
    await expect(page.locator('[data-screen="CAT-01"]')).toContainText("معطَّل");
  });

  test("loading: جلب الأصناف — والبحث فعّال أثناء التحميل", async ({ page }, info) => {
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
      ),
    );
    await page.route("**/api/catalog/items?**", async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill(json(200, listResponse(new URL(route.request().url()))));
    });
    await page.goto("/login?next=%2Fcatalog");
    await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-01",
      state: "loading",
      texts: fromFrame("CAT-01", "loading", ["جلب الأصناف"]),
    });
    await expect(page.getByLabel("بحث")).toBeEnabled();
  });

  test("empty: كتالوج فارغ وبحث بلا تطابق — حالتان لا واحدة", async ({ page }, info) => {
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
      ),
    );
    await page.route("**/api/catalog/items?**", (route) =>
      route.fulfill(json(200, { items: [], total: 0, all_total: 0, groups: [], offset: 0 })),
    );
    await page.goto("/login?next=%2Fcatalog");
    await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-01",
      state: "empty",
      texts: fromFrame("CAT-01", "empty", ["ابدأ بأصناف قطاعك", "استورد ملفاً"]),
    });
    // بحث بلا تطابق: ما كُتب يبقى ومعه «أنشئ صنفاً بهذا الاسم»
    await page.unroute("**/api/catalog/items?**");
    await page.route("**/api/catalog/items?**", (route) =>
      route.fulfill(json(200, { items: [], total: 0, all_total: 412, groups: GROUPS, offset: 0 })),
    );
    await page.getByLabel("بحث").fill("مربى");
    await expect(page.locator('[data-screen="CAT-01"]')).toContainText("أنشئ صنفاً بهذا الاسم");
    await expect(page.getByLabel("بحث")).toHaveValue("مربى");
  });

  test("offline: كتالوج محلي — البحث والتصفّح يعملان بلا فرق", async ({ page, context }, info) => {
    await login(page);
    await expect(page.locator('[data-screen="CAT-01"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expectFrame(page, info, {
      screenId: "CAT-01",
      state: "offline",
      texts: fromFrame("CAT-01", "offline", [
        "كتالوج محلي",
        "الكتالوج مخزّن كاملاً على الجهاز، فالبحث والتصفّح يعملان بلا فرق.",
        "ما لا يعمل",
        "إنشاء صنف بصورة (الرفع يحتاج شبكة) — يُحفظ بلا صورة وتُرفع لاحقاً.",
      ]),
    });
    await context.setOffline(false);
  });

  test("stale: أسعار قد تكون قديمة — السعر بوقته لا تحذير عام", async ({ page }, info) => {
    // نسخة محلية موجودة (إسقاطات) ثم يفشل التحديث
    await page.goto("/welcome");
    await page.evaluate(async (items) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["projections", "meta"], "readwrite");
        for (const i of items)
          tx.objectStore("projections").put({ key: `entity:catalog.Item:${i.id}`, value: i });
        tx.objectStore("meta").put({
          key: "home.cache",
          value: JSON.stringify({ savedAt: new Date().toISOString(), summary: {} }),
        });
        tx.oncomplete = () => res();
      });
      db.close();
    }, ITEMS);
    await page.route("**/api/auth/account/login", (route) =>
      route.fulfill(
        json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
      ),
    );
    await page.route("**/api/catalog/items?**", (route) => route.abort("connectionfailed"));
    await page.goto("/login?next=%2Fcatalog");
    await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-01",
      state: "stale",
      texts: fromFrame("CAT-01", "stale", [
        "أسعار قد تكون قديمة",
        "الكتالوج محلي من",
        "وقد يكون سعرٌ تغيّر في فرع آخر.",
      ]),
    });
    await expect(page.locator('[data-screen="CAT-01"]')).toContainText("سكر");
    await expect(page.locator('[data-screen="CAT-01"]')).not.toContainText("صابون قديم");
  });
});

const OVERVIEW = {
  group_count: 6,
  total_items: 214,
  groups: [
    {
      id: "g1",
      name: "مشروبات غازية",
      parent_name: "مشروبات",
      items: 38,
      aliases: ["ببسي", "بيبسي", "pepsi", "كولا"],
      note: "الأسماء البديلة هنا أكثر ما تُستعمل في نقطة البيع.",
    },
    {
      id: "g2",
      name: "ألبان وأجبان",
      parent_name: "طازج",
      items: 52,
      aliases: ["لبن", "حليب"],
      note: "مجموعة لها صلاحية قصيرة — تظهر في تنبيه الانتهاء أولاً.",
    },
    {
      id: "g3",
      name: "سكر وأرز وزيت",
      parent_name: "مؤن",
      items: 41,
      aliases: ["مؤن", "تموين"],
      note: "أصناف تُباع بالكيس وبالكرتون معاً؛ الوحدتان معرّفتان في كل صنف.",
    },
    {
      id: "g4",
      name: "منظفات",
      parent_name: "منزلية",
      items: 47,
      aliases: ["صابون", "منظف"],
      note: "لا تُخلط بالمأكولات في عرض نقطة البيع ولا في الرفوف.",
    },
    {
      id: "g5",
      name: "مخبوزات",
      parent_name: "طازج",
      items: 19,
      aliases: ["خبز", "عيش"],
      note: "تُجرد يومياً؛ الفاقد فيها بند معتاد لا استثناء.",
    },
    { id: "", name: "بلا مجموعة", parent_name: "", items: 17, aliases: [], note: "" },
  ],
};

async function openGroups(page: Page, overview: unknown) {
  await page.route("**/api/catalog/groups", (route) =>
    route.request().method() === "GET" ? route.fulfill(json(200, overview)) : route.fallback(),
  );
  await login(page, "/catalog/groups");
}

test.describe("CAT-06", () => {
  test("ready: المجموعات بأصنافها وأسمائها البديلة — والترتيب للعرض فقط", async ({
    page,
  }, info) => {
    await openGroups(page, OVERVIEW);
    await expectFrame(page, info, {
      screenId: "CAT-06",
      state: "ready",
      texts: fromFrame("CAT-06", "ready", [
        "المجموعات —",
        "مجموعات ·",
        "صنفاً",
        "الترتيب يغيّر العرض في نقطة البيع فقط",
        "المجموعة",
        "أصناف",
        "أسماء بديلة مسجّلة",
        "ملاحظة",
        "مشروبات غازية",
        "ضمن: مشروبات",
        "ببسي",
        "بيبسي",
        "كولا",
        "ألبان وأجبان",
        "منظفات",
        "مخبوزات",
        "بلا مجموعة",
        "الأصناف تعمل وتُباع بلا مجموعة. المجموعة راحةٌ في العرض والتقرير، لا شرطُ صحّة.",
      ]),
    });
    await expect(page.locator('[data-screen="CAT-06"]')).toContainText("214");
  });

  test("empty: لا مجموعات بعد — ليست عطباً، ونقول ما ستكسبه", async ({ page }, info) => {
    await openGroups(page, {
      group_count: 0,
      total_items: 214,
      groups: [{ id: "", name: "بلا مجموعة", parent_name: "", items: 214, aliases: [], note: "" }],
    });
    await expectFrame(page, info, {
      screenId: "CAT-06",
      state: "empty",
      texts: fromFrame("CAT-06", "empty", [
        "لا مجموعات بعد",
        "صنفاً وصفر مجموعة. هذه ليست حالة عطب: البيع يعمل والبحث يعمل والجرد يعمل.",
        "ما الذي ستكسبه: عرضٌ أسرع للكاشير، وتقرير مبيعات بالفئة بدل قائمة أصناف طويلة.",
      ]),
    });
    await expect(page.locator('[data-screen="CAT-06"]')).not.toContainText("أنشئ مجموعة لتبدأ");
  });

  test("validation_error: الاسم البديل مأخوذ — نسمّي الصنف المالك ونضع رابطاً", async ({
    page,
  }, info) => {
    await openGroups(page, OVERVIEW);
    await page.route("**/api/catalog/items/*/aliases", (route) =>
      route.fulfill(
        json(409, {
          detail: "alias_taken",
          alias: "كولا",
          owner_item_id: "i2",
          owner_item_name: "بيبسي 330 مل",
          added: [],
        }),
      ),
    );
    await page.getByLabel("الصنف").selectOption("i1");
    await page.getByLabel("أسماء بديلة").fill("كولا");
    await page.getByRole("button", { name: "تسجيل اسم بديل" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-06",
      state: "validation_error",
      texts: fromFrame("CAT-06", "validation_error", [
        "الاسم البديل مأخوذ",
        "«كولا»",
        "«بيبسي 330 مل»",
        "انقل الاسم من الصنف الآخر، أو اكتب اسماً يميّز",
      ]),
    });
    await expect(page.getByRole("link", { name: "بيبسي 330 مل" })).toHaveAttribute(
      "href",
      "/catalog/i2",
    );
  });

  test("success: أُضيف اسمان بديلان — والأثر فوري في البحث، وجرّبه الآن", async ({
    page,
  }, info) => {
    await openGroups(page, OVERVIEW);
    await page.route("**/api/catalog/items/*/aliases", (route) =>
      route.fulfill(
        json(200, {
          id: "i4",
          added: ["عيش", "خبز أبيض"],
          ...ITEMS[3],
          aliases: ["عيش", "خبز أبيض"],
        }),
      ),
    );
    await page.getByLabel("الصنف").selectOption("i4");
    await page.getByLabel("أسماء بديلة").fill("عيش، خبز أبيض");
    await page.getByRole("button", { name: "تسجيل اسم بديل" }).click();
    await expectFrame(page, info, {
      screenId: "CAT-06",
      state: "success",
      texts: fromFrame("CAT-06", "success", [
        "أُضيف اسمان بديلان",
        "سُجّل «عيش» و«خبز أبيض» على «",
        "الأثر فوري في بحث نقطة البيع وفي",
        "اسم الصنف على الفاتورة يبقى «",
        "جرّبه الآن",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "الأثر فوري في بحث نقطة البيع وفي البحث العام معاً.",
    );
  });
});
