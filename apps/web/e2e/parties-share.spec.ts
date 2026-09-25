import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.27 — PTY-08 (5). معاينة الحقول والجمهور قبل المشاركة؛ الطباعة للحاضر من الشاشة؛ الملف والرابط
 * المخوَّل للمالك (ACC-85)؛ «جارٍ التوليد» بعدد الصفحات المتوقَّع؛ «جاهز» بالملف بمداه ووقته و«لا وعد
 * تسليم» بحالة صادقة («لم يُفتح بعد» → «تم الاطلاع»)؛ «فشل التوليد» ببديل مدى أقصر أو طباعة مباشرة؛
 * قالب تذكير الدين يدوي بلا زرّ إرسال (N-01).
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

const row = (
  doc: string,
  kind: string,
  label: string,
  occurred: string,
  debit: string,
  credit: string,
  balance: string,
  branch = "b1",
) => ({
  doc,
  doc_id: `doc-${doc}`,
  kind,
  label,
  occurred_at: occurred,
  business_date: occurred.slice(0, 10),
  debit_minor: debit,
  credit_minor: credit,
  balance_minor: balance,
  branch_id: branch,
  info: !debit && !credit,
});

const ROWS = [
  row("OPEN-004", "opening", "رصيد افتتاحي", "2026-08-01T10:00:00.000Z", "6000", "", "6000", ""),
  row("INV-1021", "sale", "بيع آجل", "2026-09-02T10:00:00.000Z", "42000", "", "48000"),
  row("PAY-0240", "payment", "سداد نقدي", "2026-09-08T10:00:00.000Z", "", "30000", "18000"),
  row(
    "INV-1039",
    "sale",
    "بيع نقدي — لا أثر آجل",
    "2026-09-10T10:00:00.000Z",
    "",
    "",
    "18000",
    "b2",
  ),
];

const statement = (extra: Record<string, unknown> = {}) => ({
  party: { id: "p1", name: "أحمد الطيب — تجريبي", phone: "0912555447", updated_at: "" },
  rows: ROWS,
  balance_minor: "18000",
  hidden_other_branch: 0,
  last_payment_at: "2026-09-08T10:00:00.000Z",
  oldest_unpaid_at: "2026-09-02T10:00:00.000Z",
  as_of: "2026-09-11T10:30:00.000Z",
  scope: "all",
  branch_names: { b1: "الرئيسي", b2: "فرع بحري" },
  range: "30",
  tenant_name: "بقالة النيل — تجريبي",
  ...extra,
});

function statementRoute(page: Page, body: unknown, status = 200) {
  return page.route(/\/api\/parties\/p1\/statement(\?.*)?$/, (route) =>
    route.fulfill(json(status, body)),
  );
}

const exportBody = (over: Record<string, unknown> = {}) => ({
  id: "x1",
  party_id: "p1",
  kind: "link",
  range: "30",
  include_invoices: false,
  include_branch: false,
  file_name: "كشف-حساب-أحمد الطيب — تجريبي-30-يوماً-20260917-1105.pdf",
  page_count: 1,
  url: "/api/parties/exports/tok-abc",
  generated_at: "2026-09-17T11:05:00.000Z",
  generated_by_name: "سالم",
  opened_at: "",
  open_count: 0,
  ...over,
});

const SHARE = "/parties/p1/statement/share?range=30";

const READY = [
  "مشاركة كشف حساب أحمد الطيب",
  "معاينة الحقول والجمهور قبل المشاركة، بلا وعد بالتسليم",
  "ما سيراه المستلم",
  "الحركات والأرصدة",
  "أرقام الفواتير التفصيلية",
  "اسم الفرع لكل حركة",
  "معاينة المستند",
  "بقالة النيل — تجريبي",
  "كشف حساب: أحمد الطيب — تجريبي · حتى",
  "سبتمبر",
  "الرصيد المستحق",
  "180.00",
  "المشاركة تُنشئ ملفاً أو رابطاً. لا نضمن وصوله ولا قراءته، ولا نسجّل «تم الاطلاع» ما لم يفتح المستلم رابطاً مخوَّلاً.",
  "طباعة",
  "تصدير PDF",
  "مشاركة رابط",
];

test.describe("PTY-08", () => {
  test("ready → loading → success: الحقول المختارة في المعاينة، ثم الملف بمداه ووقته و«لا وعد تسليم» بحالة صادقة", async ({
    page,
  }, info) => {
    await seed(page);
    await statementRoute(page, statement());
    const posted: Record<string, unknown>[] = [];
    await page.route("**/api/parties/p1/statement/export", async (route) => {
      posted.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
      await new Promise((r) => setTimeout(r, 2000));
      return route.fulfill(json(201, { export: exportBody() }));
    });
    let opened = 0;
    await page.route("**/api/parties/statement-exports/x1", (route) => {
      opened += 1;
      return route.fulfill(
        json(200, {
          export: exportBody({ opened_at: "2026-09-17T11:20:00.000Z", open_count: opened }),
        }),
      );
    });
    await login(page, SHARE);
    await expectFrame(page, info, {
      screenId: "PTY-08",
      state: "ready",
      texts: fromFrame("PTY-08", "ready", READY),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="PTY-08"]');
    await expect(root).toContainText("كشف حساب: أحمد الطيب — تجريبي · حتى 11 سبتمبر");
    // المعاينة تعرض ما سيخرج: الأعمدة الاختيارية تظهر عند اختيارها
    await expect(root.locator(".pty-doc")).not.toContainText("INV-1021");
    await page.getByRole("switch", { name: "أرقام الفواتير التفصيلية" }).click();
    await page.getByRole("switch", { name: "اسم الفرع لكل حركة" }).click();
    await expect(root.locator(".pty-doc")).toContainText("INV-1021");
    await expect(root.locator(".pty-doc")).toContainText("فرع بحري");
    // قالب التذكير يدوي: نصّ يُراجَع ويُنسخ — لا زرّ إرسال
    await expect(page.getByLabel("تذكير الدين — يدوي، تراجعه وترسله بنفسك")).toHaveValue(
      /رصيدكم المستحق لدى بقالة النيل — تجريبي حتى 11 سبتمبر: 180\.00/,
    );
    await expect(page.getByRole("button", { name: /إرسال/ })).toHaveCount(0);

    await page.getByRole("button", { name: "مشاركة رابط" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-08",
      state: "loading",
      texts: fromFrame("PTY-08", "loading", [
        "جارٍ التوليد",
        "مع عدد الصفحات المتوقَّع ومعاينة الأولى.",
        "معاينة المستند",
        "مشاركة رابط",
      ]),
    });
    await expect(root).toContainText("الصفحات المتوقَّعة 1");
    await expectFrame(page, info, {
      screenId: "PTY-08",
      state: "success",
      texts: fromFrame("PTY-08", "success", [
        "جاهز",
        "الملف بمداه في اسمه، ومعه وقت توليده — والكشف المطبوع يحمل الوقت في ترويسته.",
        "لا وعد تسليم",
        "المشاركة تُنشئ رابطاً ولا تَعِد بأن الطرف قرأه. «أُرسل» ليست «وصل».",
        "مشاركة رابط",
      ]),
    });
    await expect(root).toContainText("كشف-حساب-أحمد الطيب — تجريبي-30-يوماً-20260917-1105.pdf");
    await expect(root).toContainText("لم يُفتح بعد");
    await page.getByRole("button", { name: "تحديث الحالة" }).click();
    await expect(root).toContainText("تم الاطلاع");
    expect(posted).toEqual([
      { kind: "link", range: "30", include_invoices: true, include_branch: true },
    ]);
  });

  test("server_error: فشل التوليد — البديل مدى أقصر أو طباعة مباشرة", async ({ page }, info) => {
    await seed(page);
    await statementRoute(page, statement({ range: "all" }));
    await page.route("**/api/parties/p1/statement/export", (route) =>
      route.fulfill(json(400, { errors: [{ field: "range", code: "too_long" }] })),
    );
    await login(page, "/parties/p1/statement/share?range=all");
    await page.getByRole("button", { name: "تصدير PDF" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-08",
      state: "server_error",
      texts: fromFrame("PTY-08", "server_error", [
        "فشل التوليد",
        "الكشف طويل أو الخادم تعثّر.",
        "البديل",
        "مدى أقصر، أو طباعة مباشرة من الشاشة بلا توليد ملف. والطرف قد يكون واقفاً ينتظر.",
        "طباعة",
        "معاينة المستند",
      ]),
    });
    await page.getByRole("button", { name: "مدى أقصر" }).click();
    await expect(page).toHaveURL(/range=all$/);
    await expect(page.locator('[data-screen="PTY-08"]')).toHaveAttribute("data-state", "ready");
  });

  test("permission_denied: المشاركة الخارجية للمالك — مدير الفرع يطبع ولا يرسل رابطاً", async ({
    page,
  }) => {
    await seed(page, "manager");
    await statementRoute(page, statement({ scope: "branch" }));
    await login(page, SHARE);
    await expect(page.locator('[data-screen="PTY-08"]')).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "طباعة" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "مشاركة رابط" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "تصدير PDF" })).toBeDisabled();
    await expect(page.getByLabel("تذكير الدين — يدوي، تراجعه وترسله بنفسك")).toHaveCount(0);
  });

  test("permission_denied: الخادم يرفض التوليد لغير المالك", async ({ page }, info) => {
    await seed(page, "manager");
    // الكشف بنطاق كل الفروع (قرار الخادم) لكن التوليد مرفوض — الشاشة تقول السبب
    await statementRoute(page, statement());
    await page.route("**/api/parties/p1/statement/export", (route) =>
      route.fulfill(json(403, { detail: "owner_required" })),
    );
    await login(page, SHARE);
    await page.getByRole("button", { name: "مشاركة رابط" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-08",
      state: "permission_denied",
      texts: fromFrame("PTY-08", "permission_denied", [
        "المشاركة الخارجية للمالك",
        "الكاشير يطبع نسخةً للطرف الحاضر، ولا يرسل الكشف برابط خارجي.",
        "الفرق",
        "الطباعة للحاضر الذي يعرف رقمه؛ والرابط قد يُعاد توجيهه. الأخير قرار مالك",
      ]),
    });
  });

  test("من PTY-05: «طباعة وتصدير» يفتح PTY-08 بالمدى نفسه", async ({ page }) => {
    await seed(page);
    await statementRoute(page, statement());
    await login(page, "/parties/p1/statement");
    await page.getByRole("button", { name: "طباعة وتصدير" }).click();
    await expect(page).toHaveURL(/\/parties\/p1\/statement\/share\?range=30$/);
    await expect(page.locator('[data-screen="PTY-08"]')).toHaveAttribute("data-state", "ready");
  });
});
