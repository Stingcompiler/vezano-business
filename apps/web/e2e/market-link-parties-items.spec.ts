import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.25 — LINK-01 ربط الطرف المحلي بمنشأة (5) + LINK-02 مطابقة الأصناف والوحدات (5) — بعلم
 * `market_m3` مرفوعاً: الربط للمالك وبقبول المنشأة لا بالاسم (ACC-131)، المرشّحون المتشابهون
 * يُعرضون كلهم بلا «الأرجح»؛ المعامل صريح لا يُخمَّن، وتغيّر تعريف المورد يوقف المطابقة للمراجعة.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function login(page: Page, next: string, urlRe: RegExp, tenantRole = "owner") {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, {
        access: "a",
        refresh: "r",
        session_id: "s",
        tenant_id: "t1",
        user_id: tenantRole,
      }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(urlRe);
}

const PARTY = (o: Record<string, unknown> = {}) => ({
  party_id: "p1",
  party_name: "مخزن البركة",
  created_at: "2026-03-12T10:00:00Z",
  documents: 34,
  balance_minor: "1820000",
  link: null,
  ...o,
});
const CANDS = [
  {
    tenant_id: "b1111111-0000-4000-8000-000000000001",
    public_name: "مخزن البركة للجملة — تجريبي",
    badge: "verified",
    badge_label: "موثَّقة المستندات",
    offers: 36,
    category_line: "جملة",
  },
  {
    tenant_id: "b2222222-0000-4000-8000-000000000002",
    public_name: "مخزن البركة — أم درمان",
    badge: "none",
    badge_label: "بلا شارة",
    offers: 4,
    category_line: "",
  },
  {
    tenant_id: "b3333333-0000-4000-8000-000000000003",
    public_name: "البركة للمواد الغذائية",
    badge: "verified",
    badge_label: "موثَّقة المستندات",
    offers: 12,
    category_line: "",
  },
];
const LINK = (o: Record<string, unknown> = {}) => ({
  id: "l1",
  party_id: "p1",
  counterparty_tenant_id: CANDS[0]!.tenant_id,
  counterparty_name: CANDS[0]!.public_name,
  status: "requested",
  status_label: "بانتظار موافقة المنشأة",
  requested_at: new Date().toISOString(),
  decided_at: "",
  decided_by_name: "",
  ...o,
});

test.describe("LINK-01", () => {
  test("ready → validation_error → success: ثلاث منشآت باسم قريب تُعرض كلها بمعرّفاتها، والطلب لا يربط قبل قبول المنشأة، والرصيد كما هو", async ({
    page,
  }, info) => {
    let parties: { link: { status?: string } | null }[] = [PARTY()];
    await page.route("**/api/market/link/parties?q=*", (route) =>
      route.fulfill(json(200, { candidates: CANDS })),
    );
    await page.route("**/api/market/link/parties", (route) =>
      route.fulfill(
        json(200, {
          state: "ready",
          can_link: true,
          parties,
          linked_count: parties.filter((p) => p.link?.status === "accepted").length,
        }),
      ),
    );
    await page.route("**/api/market/link/parties/p1/request", (route) => {
      const b = route.request().postDataJSON() as { counterparty_tenant_id: string };
      if (!b.counterparty_tenant_id)
        return route.fulfill(
          json(400, {
            detail: "ambiguous_name",
            field: "counterparty_tenant_id",
            extra: { candidates: CANDS },
          }),
        );
      const link = LINK({ counterparty_tenant_id: b.counterparty_tenant_id });
      parties = [PARTY({ link })];
      return route.fulfill(json(201, { link }));
    });
    await login(page, "/market/link/parties", /\/market\/link\/parties$/);
    await page.getByRole("button", { name: "مخزن البركة" }).click();
    await expectFrame(page, info, {
      screenId: "LINK-01",
      state: "ready",
      texts: fromFrame("LINK-01", "ready", [
        "ربط الطرف المحلي بمنشأة — موافقة وهوية، لا دمج بالاسم",
        "«مخزن البركة» في دفترك اسم كتبته أنت. ربطه بمنشأة حقيقية في السوق يحتاج موافقتها — التشابه في الاسم ليس هوية.",
        "الطرف في دفترك",
        "مخزن البركة",
        "أنشأته 12/03 · 34 مستنداً · ذمّة قائمة",
        "المنشأة في السوق",
        "مخزن البركة للجملة — تجريبي",
        "موثَّقة المستندات · 36 عرضاً",
        "مطلوب",
        "موافقة المنشأة على الربط",
        "يُرسل طلب ربط تراه المنشأة وتقبله. بلا قبولها لا ربط — ولو تطابق الاسم حرفاً بحرف.",
        "يبقى",
        "دفترك كما هو",
        "الاسم الذي كتبته، و34 مستنداً، والذمّة القائمة — كلها ملكك ولا تُستبدل ببيانات المنشأة العامة.",
        "يُضاف",
        "قناة مستندات بين الطرفين",
        "هذا كل ما يفعله الربط: طلباتك معها تصبح قابلة للتحويل إلى مستندات في دفترك بموافقتك",
      ]),
    });
    const root = page.locator('[data-screen="LINK-01"]');
    // لا «الأرجح» ولا ترتيب مقترَح — الثلاث بمعرّفاتها
    await expect(root).not.toContainText("الأرجح");
    await expect(root.locator(".pos-chip")).toHaveCount(3);
    await page.getByRole("button", { name: "أرسل طلب الربط", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "LINK-01",
      state: "validation_error",
      texts: fromFrame("LINK-01", "validation_error", [
        "اسمان متشابهان ليسا طرفاً واحداً",
        "في السوق ثلاث منشآت باسم قريب. لا نختار عنك ولا نقترح «الأرجح» — نعرض الثلاث بمعرّفاتها وننتظر اختيارك، لأن ربطاً خاطئاً يُرسل ذمّتك إلى غير صاحبها.",
      ]),
    });
    await page.getByRole("button", { name: "مخزن البركة للجملة — تجريبي" }).click();
    await page
      .getByRole("button", { name: "أرسل طلب الربط إلى مخزن البركة للجملة — تجريبي" })
      .click();
    await expectFrame(page, info, {
      screenId: "LINK-01",
      state: "success",
      texts: fromFrame("LINK-01", "success", [
        "الربط مطابقة لا دمج",
        "دفتر كل طرف يبقى دفتره. الربط جسرٌ يعبر عليه المستند بموافقتك، لا دمجُ رصيدين.",
      ]),
    });
    await expect(root).toContainText("أُرسل طلب الربط — بانتظار موافقة المنشأة");
    await expect(root).toContainText("رصيد الطرف لم يتغيّر");
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(root).toContainText("بانتظار موافقة المنشأة");
  });
});

test("LINK-01 permission_denied: المدير — الربط للمالك ولا ربط بالاسم", async ({ page }, info) => {
  await page.route("**/api/market/link/parties", (route) =>
    route.fulfill(
      json(200, { state: "ready", can_link: false, parties: [PARTY()], linked_count: 0 }),
    ),
  );
  await login(page, "/market/link/parties", /\/market\/link\/parties$/, "manager");
  await expectFrame(page, info, {
    screenId: "LINK-01",
    state: "permission_denied",
    texts: fromFrame("LINK-01", "permission_denied", [
      "الربط للمالك",
      "الربط يجعل مستندات السوق تدخل دفتر طرفٍ محلي — أثرٌ مالي مباشر.",
      "لا ربط بالاسم",
      "حتى للمالك: التطابق بالاسم ليس دليل هوية",
      "الربط يحتاج تأكيداً من الطرفين.",
    ]),
  });
  await expect(page.getByRole("button", { name: "مخزن البركة" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("LINK-01 success (مقبول): بعد قبول المنشأة — رُبط الطرفان ورصيده لم يتغيّر", async ({
  page,
}, info) => {
  await page.route("**/api/market/link/parties?q=*", (route) =>
    route.fulfill(json(200, { candidates: [CANDS[0]] })),
  );
  await page.route("**/api/market/link/parties", (route) =>
    route.fulfill(
      json(200, { state: "ready", can_link: true, parties: [PARTY()], linked_count: 0 }),
    ),
  );
  await page.route("**/api/market/link/parties/p1/request", (route) =>
    route.fulfill(
      json(201, {
        link: LINK({ status: "accepted", status_label: "مربوط", decided_by_name: "عثمان" }),
      }),
    ),
  );
  await login(page, "/market/link/parties", /\/market\/link\/parties$/);
  await page.getByRole("button", { name: "مخزن البركة" }).click();
  await page.getByRole("button", { name: "مخزن البركة للجملة — تجريبي" }).click();
  await page.getByRole("button", { name: /أرسل طلب الربط/ }).click();
  await expectFrame(page, info, {
    screenId: "LINK-01",
    state: "success",
    texts: fromFrame("LINK-01", "success", [
      "رُبط الطرفان",
      "نقول ما صار ممكناً وما لم يتغيّر: مستندات السوق تقترح دخول دفتره، ورصيده لم يتغيّر بالربط.",
      "الربط مطابقة لا دمج",
      "دفتر كل طرف يبقى دفتره. الربط جسرٌ يعبر عليه المستند بموافقتك، لا دمجُ رصيدين.",
    ]),
  });
});

const MAP = (o: Record<string, unknown> = {}) => ({
  id: "m1",
  item_id: "i1",
  item_name: "سكر أبيض",
  unit_code: "kg1",
  unit_name: "كيس 1كغ",
  offer_id: "o1",
  offer_name: "سكر أبيض معبّأ",
  offer_unit_name: "كرتونة",
  offer_pack_label: "كرتونة 12×1كغ",
  factor_milli: "12000",
  status: "matched",
  status_label: "مطابَق",
  supplier_changed: false,
  ...o,
});
const ITEMS = [
  { item_id: "i1", name: "سكر أبيض", base_unit_code: "kg1", base_unit_name: "كيس 1كغ", units: [] },
  { item_id: "i3", name: "زيت طعام", base_unit_code: "l5", base_unit_name: "عبوة 5ل", units: [] },
];
const PAYLOAD = (mappings: unknown[], unmapped: unknown[]) => ({
  state: "ready",
  counterparties: [{ tenant_id: CANDS[0]!.tenant_id, name: CANDS[0]!.public_name }],
  counterparty_tenant_id: CANDS[0]!.tenant_id,
  mappings,
  matched_count: (mappings as { status: string }[]).filter((m) => m.status === "matched").length,
  review_count: (mappings as { status: string }[]).filter((m) => m.status === "needs_review")
    .length,
  unmapped_offers: unmapped,
  items: ITEMS,
});

test.describe("LINK-02", () => {
  test("conflict → validation_error → success: تغيّر تعريف المورد يوقف المطابقة، والمعامل يُطلب لا يُخمَّن، ثم طوبقت الأصناف", async ({
    page,
  }, info) => {
    let mappings = [
      MAP(),
      MAP({
        id: "m2",
        item_id: "i2",
        item_name: "شاي أسود",
        unit_name: "علبة 250غ",
        offer_id: "o2",
        offer_name: "شاي سيلاني",
        offer_pack_label: "كرتونة 24×250غ",
        factor_milli: "24000",
      }),
      MAP({
        id: "m4",
        item_id: "i4",
        item_name: "دقيق",
        unit_name: "كيس 50كغ",
        offer_id: "o4",
        offer_name: "دقيق فاخر",
        offer_pack_label: "كيس 50كغ",
        status: "needs_review",
        status_label: "يحتاج مراجعة",
        supplier_changed: true,
      }),
    ];
    let unmapped = [
      {
        offer_id: "o3",
        public_name: "زيت نباتي",
        unit_name: "كرتونة",
        pack_label: "كرتونة",
        defined: false,
      },
    ];
    await page.route("**/api/market/link/items?*", (route) =>
      route.fulfill(json(200, PAYLOAD(mappings, unmapped))),
    );
    await page.route("**/api/market/link/items", (route) => {
      if (route.request().method() === "GET")
        return route.fulfill(json(200, PAYLOAD(mappings, unmapped)));
      const b = route.request().postDataJSON() as {
        factor_milli: string;
        item_id: string;
        offer_id: string;
      };
      if (!b.factor_milli)
        return route.fulfill(
          json(400, {
            detail: "factor_required",
            field: "factor_milli",
            extra: { unit_name: "عبوة 5ل", offer_unit_name: "كرتونة" },
          }),
        );
      const m = MAP({
        id: "m3",
        item_id: "i3",
        item_name: "زيت طعام",
        unit_name: "عبوة 5ل",
        offer_id: "o3",
        offer_name: "زيت نباتي",
        offer_unit_name: "كرتونة",
        offer_pack_label: "كرتونة",
        factor_milli: b.factor_milli,
      });
      mappings = [...mappings, m];
      unmapped = [];
      return route.fulfill(json(200, { mapping: m }));
    });
    await page.route("**/api/market/link/items/m4/confirm", (route) => {
      mappings = mappings.map((m) =>
        m.id === "m4"
          ? { ...m, status: "matched", status_label: "مطابَق", supplier_changed: false }
          : m,
      );
      return route.fulfill(json(200, { mapping: mappings.find((m) => m.id === "m4") }));
    });
    await login(page, "/market/link/items", /\/market\/link\/items$/);
    await expectFrame(page, info, {
      screenId: "LINK-02",
      state: "conflict",
      texts: fromFrame("LINK-02", "conflict", [
        "مطابقة الأصناف والوحدات — التحويل مؤكَّد أو لا يكون",
        "صنفك وصنف المورد كيانان مستقلّان لكلٍّ ملكيته. المطابقة تربط بينهما بمعامل تحويل صريح، ولا نُخمّن أن «كرتونة» عنده = «كرتونة» عندك.",
        "صنفك ووحدتك",
        "صنف المورد ووحدته",
        "معامل التحويل",
        "حالة المطابقة",
        "سكر أبيض",
        "كيس 1كغ",
        "سكر أبيض معبّأ",
        "كرتونة 12×1كغ",
        "تحويل مؤكَّد: كرتونته = 12 من أكياسك. أنت أقررته.",
        "مطابَق",
        "شاي أسود",
        "علبة 250غ",
        "شاي سيلاني",
        "كرتونة 24×250غ",
        "دقيق",
        "كيس 50كغ",
        "دقيق فاخر",
        "المطابقة القديمة موقوفة حتى تراجعها — لا نُمرّرها بافتراض أنها كما كانت.",
        "يحتاج مراجعة",
        "زيت نباتي",
        "الملكية تبقى داخلية.",
        "تعديل المورد لاسم صنفه أو تغليفه لا يعيد كتابة صنفك ولا اسمه في دفترك. تظهر لك ملاحظة «تغيّر تعريف صنف المورد — راجع المطابقة» ويبقى القرار لك.",
      ]),
    });
    const root = page.locator('[data-screen="LINK-02"]');
    await expect(root).toContainText("ناقص تعريف");
    // مطابقة الزيت بلا معامل: وحدتان مختلفتان → نطلب المعامل
    await page.getByRole("button", { name: "زيت نباتي" }).click();
    await page.getByRole("button", { name: "زيت طعام" }).click();
    await page.getByRole("button", { name: "ثبّت المطابقة", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "LINK-02",
      state: "validation_error",
      texts: fromFrame("LINK-02", "validation_error", [
        "وحدتان لا تتطابقان",
        "مطابقة صنفٍ يُباع بالكرتون بصنفٍ يُخزَّن بالكيس بلا معامل بينهما.",
        "نطلب المعامل",
        "سؤالٌ واحد يمنع أن يدخل 10 كراتين مخزونك 10 أكياس.",
      ]),
    });
    await expect(root).toContainText("«كرتونة = كم عبوة 5ل؟»");
    await page.getByLabel(/كرتونة الواحدة = كم من عبوة 5ل/).fill("4");
    await page.getByRole("button", { name: "ثبّت المطابقة", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "LINK-02",
      state: "success",
      texts: fromFrame("LINK-02", "success", [
        "طوبقت الأصناف",
        "لا تمنع العمل — تُنشأ عند أول استلام.",
        "المطابقة تُراجَع",
        "قابلة للتعديل دائماً، وتغييرها لا يمسّ مستنداً مضى — كمعامل التحويل تماماً.",
      ]),
    });
    await expect(root).toContainText("3 أصناف مطابَقاً ولا شيء بلا مقابل");
    await expect(root).toContainText("كرتونته = 4 من عبواتك");
    await page.getByRole("button", { name: "التالي" }).click();
    // مراجعة الدقيق تُثبّت الإصدار الجديد → ready
    await page.getByRole("button", { name: "راجعتها — ثبّت المطابقة" }).click();
    await expectFrame(page, info, {
      screenId: "LINK-02",
      state: "ready",
      texts: fromFrame("LINK-02", "ready", ["مطابَق", "حالة المطابقة"]),
    });
    await expect(root).not.toContainText("يحتاج مراجعة");
  });
});
