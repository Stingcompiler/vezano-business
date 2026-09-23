import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { goSection } from "./platform-nav";

/**
 * PLT-14 (بأمر المالك 2026-09-21؛ 0005 §١٠١) — طلبات الجولة من الهبوط: عدّادات، مرشّحات
 * بالحالة، متابعة بانتقالات مسموحة فقط، وملاحظة إلزامية عند الإغلاق/التحوّل، والفراغ يقول ما فُحص.
 * النصوص من عند المنفّذ (لا إطار مرسوم) — لذلك بلا `fromFrame`.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type Row = {
  id: string;
  name: string;
  whatsapp: string;
  email: string;
  channel: string;
  channel_label: string;
  message: string;
  status: "new" | "contacted" | "converted" | "closed";
  status_label: string;
  note: string;
  created_at: string;
  handled_at: string;
  handled_by_name: string;
  next: string[];
};

const NEXT: Record<Row["status"], string[]> = {
  new: ["closed", "contacted"],
  contacted: ["closed", "converted"],
  converted: [],
  closed: ["contacted"],
};
const LABEL: Record<Row["status"], string> = {
  new: "جديد",
  contacted: "تواصلنا",
  converted: "تحوّل",
  closed: "أُغلق",
};

const row = (o: Partial<Row> & { id: string; name: string; status: Row["status"] }): Row => ({
  whatsapp: "0912345678",
  email: "",
  channel: "whatsapp",
  channel_label: "واتساب",
  message: "",
  note: "",
  created_at: minutesAgo(30),
  handled_at: "",
  handled_by_name: "",
  ...o,
  status_label: LABEL[o.status],
  next: NEXT[o.status],
});

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "هدى — تشغيل" }),
    ),
  );
  await page.route(/\/api\/platform\/tenants(\?.*)?$/, (route) =>
    route.fulfill(
      json(200, {
        tenants: [],
        total: 0,
        shown: 0,
        active_count: 0,
        filter: "all",
        q: "",
        access_rule: "قراءة بيانات مستأجر تحتاج تذكرة دعم مفتوحة منه.",
        fetched_at: new Date().toISOString(),
      }),
    ),
  );
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.huda@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-14", () => {
  test("ready: العدّادات والطلبات؛ تواصلنا ← تحوّل يحتاج ملاحظة ← مرشّح «تحوّل»؛ ثم الفراغ يقول ما فُحص", async ({
    page,
  }, info) => {
    let rows: Row[] = [
      row({
        id: "r1",
        name: "أحمد الطيب",
        status: "new",
        message: "متجر مواد غذائية بفرعين في أم درمان",
        email: "ahmed@example.com",
      }),
      row({
        id: "r2",
        name: "سلمى عثمان",
        status: "contacted",
        channel: "call",
        channel_label: "مكالمة",
        note: "اتصلنا — موعد الجولة الخميس",
        handled_at: minutesAgo(10),
        handled_by_name: "طيب — تشغيل",
      }),
    ];
    const posted: Record<string, unknown>[] = [];
    const counts = () => ({
      new: rows.filter((r) => r.status === "new").length,
      contacted: rows.filter((r) => r.status === "contacted").length,
      converted: rows.filter((r) => r.status === "converted").length,
      closed: rows.filter((r) => r.status === "closed").length,
      open: rows.filter((r) => r.status === "new" || r.status === "contacted").length,
    });
    await page.route(/\/api\/platform\/demo-requests(\?.*)?$/, (route) => {
      const f = new URL(route.request().url()).searchParams.get("status") ?? "open";
      const list =
        f === "all"
          ? rows
          : f === "open"
            ? rows.filter((r) => r.status === "new" || r.status === "contacted")
            : rows.filter((r) => r.status === f);
      return route.fulfill(
        json(200, {
          requests: list,
          filter: f,
          counts: counts(),
          fetched_at: new Date().toISOString(),
          rule: "لا إرسال آلي للطالب — التواصل بشري على القناة التي اختارها، ويُسجَّل هنا باسمك.",
        }),
      );
    });
    await page.route("**/api/platform/demo-requests/*", (route) => {
      const id = route.request().url().split("/").pop() ?? "";
      const b = route.request().postDataJSON() as { status: string; note: string };
      posted.push({ id, ...b });
      const r = rows.find((x) => x.id === id)!;
      if (b.status && !r.next.includes(b.status))
        return route.fulfill(json(409, { detail: "bad_transition" }));
      if ((b.status === "converted" || b.status === "closed") && !b.note.trim())
        return route.fulfill(json(400, { detail: "note_required" }));
      const status = (b.status || r.status) as Row["status"];
      rows = rows.map((x) =>
        x.id === id
          ? row({
              ...x,
              status,
              note: b.note || x.note,
              handled_at: new Date().toISOString(),
              handled_by_name: "هدى — تشغيل",
            })
          : x,
      );
      return route.fulfill(json(200, { request: rows.find((x) => x.id === id) }));
    });
    await operatorLogin(page);
    await goSection(page, "طلبات الجولة");
    await expect(page).toHaveURL(/\/platform\/demo-requests$/);
    await expectFrame(page, info, {
      screenId: "PLT-14",
      state: "ready",
      texts: [
        "طلبات الجولة — من صفحة الهبوط",
        "كل طلب بقناته وحالته. لا إرسال آلي للطالب — التواصل بشري ويُسجَّل هنا باسمك ووقته.",
        "ينتظر",
        "جديد",
        "تحوّل",
        "أُغلق",
        "أحمد الطيب",
        "واتساب",
        "متجر مواد غذائية بفرعين في أم درمان",
        "سلمى عثمان",
        "مكالمة",
        "تواصلنا",
        "اتصلنا — موعد الجولة الخميس",
        "طيب — تشغيل",
        "لا إرسال آلي للطالب — التواصل بشري على القناة التي اختارها، ويُسجَّل هنا باسمك.",
      ],
    });
    const root = page.locator('[data-screen="PLT-14"]');
    await expect(root.locator(".home-kpi", { hasText: "ينتظر" })).toContainText("2");
    // أحمد: جديد → الأزرار المتاحة تواصلنا/أغلق فقط (لا «تحوّل» من جديد)
    const ahmed = root.locator(".plt-demo__item", { hasText: "أحمد الطيب" });
    await ahmed.getByRole("button", { name: "تابِع" }).click();
    await expect(ahmed.getByRole("button", { name: "تواصلنا" })).toBeVisible();
    await expect(ahmed.getByRole("button", { name: "تحوّل إلى منشأة" })).toHaveCount(0);
    await ahmed.getByRole("button", { name: "تواصلنا" }).click();
    await expect(ahmed.locator(".c-status")).toContainText("تواصلنا");
    // تحوّل بلا ملاحظة: مرفوض بنصّ؛ ثم بملاحظة → يختفي من «ينتظر» ويظهر تحت «تحوّل»
    await ahmed.getByRole("button", { name: "تابِع" }).click();
    await ahmed.getByRole("button", { name: "تحوّل إلى منشأة" }).click();
    await expect(ahmed).toContainText("الإغلاق والتحوّل يحتاجان ملاحظة: ماذا حدث؟");
    await ahmed.getByLabel("ملاحظة").fill("سجّل منشأة «بقالة أحمد» على باقة فرعين");
    await ahmed.getByRole("button", { name: "تحوّل إلى منشأة" }).click();
    await expect(root.locator(".plt-demo__item", { hasText: "أحمد الطيب" })).toHaveCount(0);
    await expect(root.locator(".home-kpi", { hasText: "ينتظر" })).toContainText("1");
    await page.getByRole("button", { name: "تحوّل", exact: true }).click();
    const converted = root.locator(".plt-demo__item", { hasText: "أحمد الطيب" });
    await expect(converted).toContainText("سجّل منشأة «بقالة أحمد» على باقة فرعين");
    await expect(converted).toContainText("هدى — تشغيل");
    await expect(converted.getByRole("button", { name: "تابِع" })).toBeVisible();
    expect(posted.map((p) => p.status)).toEqual(["contacted", "converted", "converted"]);
    // الفراغ: مرشّح «أُغلق» بلا طلبات يقول ذلك
    await page.getByRole("button", { name: "أُغلق", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "PLT-14",
      state: "empty",
      texts: ["لا طلبات في هذا المرشّح", "لا طلبات بهذه الحالة."],
    });
  });

  test("permission_denied: جلسة بلا صفة مشغّل", async ({ page }, info) => {
    await page.route(/\/api\/platform\/demo-requests(\?.*)?$/, (route) =>
      route.fulfill(json(403, { detail: "operator_required" })),
    );
    await operatorLogin(page);
    await goSection(page, "طلبات الجولة");
    await expectFrame(page, info, {
      screenId: "PLT-14",
      state: "permission_denied",
      texts: ["مساحة المشغّل فقط", "طلبات الجولة بيانات أشخاص — لا تُفتح بغير صفة مشغّل."],
    });
  });
});
