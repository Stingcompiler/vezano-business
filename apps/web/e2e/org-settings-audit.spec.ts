import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T2.6 — ORG-09 إعدادات المنشأة واللغة والقوالب (4) + ORG-10 سجل التدقيق (4). حقول مسمّاة بمعاينة
 * فورية؛ النص الأطول من عرض الورق يُمنع قبل الحفظ؛ التعديل المتزامن conflict؛ السجل يُقرأ ويُصفّى
 * ويُصدَّر ولا يُحرَّر ونطاقه بالدور (§١١.٣، §١٣.٥؛ G-01، R-04).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const settings = (o: Record<string, unknown> = {}) => ({
  version: 3,
  updated_at: "2026-09-19T08:00:00Z",
  updated_by_name: "عثمان الطيب",
  name: "بقالة النيل — تجريبي",
  currency: "SDG",
  currency_exponent: 2,
  receipt: {
    header: "فرع بحري · 0912xxxxxx",
    footer: "شكراً لزيارتكم",
    paper_width: "58",
    max_chars: 32,
  },
  locale: { language: "ar", numerals: "latin" },
  payment_methods: [
    { id: "m1", code: "cash", name: "نقداً", is_cash: true, is_active: true },
    { id: "m2", code: "bank", name: "تحويل بنكي", is_cash: false, is_active: true },
  ],
  can_edit: true,
  ...o,
});

const today = (h: number, m: number) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
const AUDIT_ROWS = [
  {
    id: "a1",
    at: today(10, 5),
    actor_name: "سميّة",
    actor_role: "مدير الفرع",
    branch_id: "b1",
    branch_name: "فرع بحري",
    kind: "shift.variance_approved",
    title: "اعتماد عجز وردية 150.00",
    detail: "الوردية SHF-2209.",
    reason: "فكّة ناقصة من تحويل أمس",
    sensitive: true,
  },
  {
    id: "a2",
    at: today(9, 40),
    actor_name: "عثمان",
    actor_role: "المالك",
    branch_id: "",
    branch_name: "",
    kind: "party.distinct",
    title: "رفض دمج طرفين متشابهي الاسم",
    detail: "وُسم الطرفان «مراجَعان ومنفصلان» — الرقمان والعنوانان مختلفان.",
    reason: "",
    sensitive: true,
  },
  {
    id: "a3",
    at: today(9, 10),
    actor_name: "عثمان",
    actor_role: "المالك",
    branch_id: "b1",
    branch_name: "فرع بحري",
    kind: "branch.delete_blocked",
    title: "محاولة حذف فرع بحري — مُنعت",
    detail: "الفرع يحمل 1,847 فاتورة. عُرض الإقفال بديلاً ولم يُنفَّذ بعد.",
    reason: "",
    sensitive: true,
  },
  {
    id: "a4",
    at: today(8, 50),
    actor_name: "هبة",
    actor_role: "أمين المخزن",
    branch_id: "b1",
    branch_name: "فرع بحري",
    kind: "price.offline_conflict",
    title: "تعديل سعر «سكر — كيس 50» بلا اتصال",
    detail: "أنتج تعارضاً مع تعديل آخر — لم يُحسم بعد (SYS-03)",
    reason: "",
    sensitive: false,
  },
  {
    id: "a5",
    at: today(8, 20),
    actor_name: "عثمان",
    actor_role: "المالك",
    branch_id: "b1",
    branch_name: "فرع بحري",
    kind: "user.disabled",
    title: "تعطيل حساب الكاشير 2",
    detail: "الوردية المفتوحة باسمه ما زالت تنتظر إقفالاً إدارياً.",
    reason: "ترك العمل",
    sensitive: true,
  },
];
const audit = (o: Record<string, unknown> = {}) => ({
  range: "today",
  since: today(0, 0),
  rows: AUDIT_ROWS,
  count: AUDIT_ROWS.length,
  last_event_at: today(10, 5),
  scope: "all",
  can_export: true,
  branches: [{ id: "b1", name: "فرع بحري" }],
  ...o,
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

const ownership = (o: Record<string, unknown> = {}) => ({
  current: null,
  blockers: { open_shifts: [], pending_devices: [] },
  candidates: [{ id: "u2", display_name: "سميّة عبد الله" }],
  can_request: true,
  can_confirm: false,
  ttl_hours: 24,
  ...o,
});

test.describe("ORG-09", () => {
  test("ready → validation_error → success → conflict: معاينة فورية، النص الأطول يُمنع قبل الحفظ، حُفظ، ثم تعديل متزامن ونقل ملكية محجوب", async ({
    page,
  }, info) => {
    let puts = 0;
    let transferPosts = 0;
    await page.route("**/api/org/ownership", (route) => {
      if (route.request().method() === "POST") {
        transferPosts += 1;
        expect(route.request().postDataJSON()).toEqual({ to_user_id: "u2" });
        // لا نقل أثناء وردية مفتوحة أو معلّق غير مرفوع — الموانع تُعرض
        return route.fulfill(
          json(409, {
            detail: "conflict",
            extra: {
              open_shifts: [{ user_name: "أحمد ياسين", branch_name: "بحري" }],
              pending_devices: [{ device_name: "جهاز الكاشير", pending: 3 }],
            },
          }),
        );
      }
      return route.fulfill(json(200, ownership()));
    });
    await page.route("**/api/org/settings", (route) => {
      if (route.request().method() === "PUT") {
        puts += 1;
        const body = route.request().postDataJSON() as { version: number; footer: string };
        if (puts === 1) {
          expect(body).toMatchObject({ version: 3, footer: "شكراً لتعاملكم" });
          return route.fulfill(
            json(200, {
              ...settings({
                version: 4,
                receipt: { ...settings().receipt, footer: "شكراً لتعاملكم" },
              }),
              changed: ["سطر الختام"],
            }),
          );
        }
        return route.fulfill(
          json(409, {
            detail: "conflict",
            field: "",
            extra: { version: 5, updated_at: today(11, 2), updated_by_name: "سميّة عبد الله" },
          }),
        );
      }
      return route.fulfill(json(200, settings()));
    });
    await login(page, "/org/settings");
    await expectFrame(page, info, {
      screenId: "ORG-09",
      state: "ready",
      texts: fromFrame("ORG-09", "ready", [
        "إعدادات المنشأة واللغة والقوالب — لا محاسبة عامة ولا محرّر برمجي",
        "القوالب تُحرَّر بحقول مسمّاة ومعاينة فورية. لا صندوق شيفرة يكتب فيه التاجر منطقاً، ولا إعدادات محاسبية عامة تتجاوز الدفتر.",
        "قالب الإيصال — حقول مسمّاة",
        "لا حقل شيفرة هنا.",
        "التخصيص عبر حقول وقوائم فقط. أي منطق يحتاجه التاجر يُصبح ميزة نبنيها، لا نصاً يكتبه ويكسر إيصاله بلا من يصلحه.",
        "معاينة فورية",
        "بقالة النيل — تجريبي",
        "شكراً لزيارتكم",
        "اسم المنشأة",
        "سطر الترويسة",
        "سطر الختام",
        "عرض الورق",
        "اللغة وأرقام الإيصال",
        "إعداد المنشأة — نمط الأرقام",
        "مبدّل واحد للنظام كله · لا إعداد لكل شاشة",
        "لاتيني بعرض ثابت — المعتمد",
        "أرقام عربية في كل شيء",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="ORG-09"]');
    await expect(root).toContainText("58mm · حرارية");
    await expect(root).toContainText("سكر 1كغ ×2");
    await expect(root).toContainText("420.00");
    // نص أطول من عرض الورق — يُمنع قبل الحفظ ويعرض كيف سيُقطع
    await page
      .getByLabel("اسم المنشأة")
      .fill("بقالة النيل الكبرى للمواد الغذائية والتموينية — الفرع الرئيسي");
    await expectFrame(page, info, {
      screenId: "ORG-09",
      state: "validation_error",
      texts: fromFrame("ORG-09", "validation_error", ["نص أطول من عرض الورق", "معاينة فورية"]),
    });
    await expect(root).toContainText(
      "اسم المنشأة يتجاوز عرض 58mm. نُعلم قبل الحفظ ونعرض كيف سيُقطع فعلياً — لا نحفظ ثم نتركه يكتشف ذلك عند أول طباعة.",
    );
    await expect(page.getByRole("button", { name: "حفظ", exact: true })).toBeDisabled();
    await page.getByLabel("اسم المنشأة").fill("بقالة النيل — تجريبي");
    await page.getByLabel("سطر الختام").fill("شكراً لتعاملكم");
    await expect(root).toContainText("شكراً لتعاملكم"); // المعاينة فورية
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expectFrame(page, info, {
      screenId: "ORG-09",
      state: "success",
      texts: fromFrame("ORG-09", "success", ["حُفظ", "قالب الإيصال — حقول مسمّاة"]),
    });
    await expect(root).toContainText("سطر الختام — يسري على الشاشات والإيصالات والتقارير معاً.");
    // تعديل متزامن: نسخة أحدث بواسطة آخر
    await page.getByLabel("سطر الختام").fill("مع الشكر");
    await page.getByRole("button", { name: "حفظ", exact: true }).click();
    await expect(root).toHaveAttribute("data-state", "conflict");
    await expect(root).toContainText("تعديل متزامن");
    await expect(root).toContainText(
      "حُفظت نسخة أحدث بواسطة سميّة عبد الله في 11:02 — لا نكتب فوق ما لم تقرأه.",
    );
    expect(puts).toBe(2);
    await page.getByRole("button", { name: "أعد التحميل ثم عدّل" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    // نقل الملكية (20-D15): الطلب يُحجب بمانع معلَن — وردية مفتوحة ومعلّق غير مرفوع
    await page.getByLabel("المالك الجديد").selectOption("u2");
    await page.getByRole("button", { name: "اطلب نقل الملكية" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-09",
      state: "conflict",
      texts: fromFrame("ORG-09", "conflict", [
        "نقل ملكية المنشأة — ORG-09",
        "أخطر إجراء في النظام: ينقل الدفتر كله ومعه الذمم والأجهزة والاشتراك.",
        "لا نقل أثناء وردية مفتوحة أو معلّق غير مرفوع.",
        "المالك الجديد يجب أن يستلم دفتراً مغلق الحساب، لا نصف وردية لا يعرف من عدّها.",
        "مانع",
        "المالك الجديد يجب أن يكون له حساب قائم ومُثبَت برقمه — لا نقل إلى بريد أو رقم غير مؤكَّد.",
        "تأكيد من الطرفين خلال 24 ساعة؛ انقضاؤها يلغي الطلب تلقائياً ويُسجَّل الإلغاء.",
        "المالك السابق يبقى في السجل بصفة «مالك سابق» بتاريخ انتهاء ولايته، ولا يُمحى من الأفعال التي فعلها.",
        "الاشتراك والأجهزة والذمم تنتقل كما هي. لا يُعاد ترقيم فاتورة ولا يُعاد حساب رصيد بسبب النقل.",
      ]),
    });
    await expect(root).toContainText("وردية مفتوحة باسم أحمد ياسين — بحري");
    await expect(root).toContainText("معلّق غير مرفوع على جهاز الكاشير: 3");
    expect(transferPosts).toBe(1);
  });

  test("نقل الملكية: المالك الجديد يؤكّد خلال 24 ساعة — الطلب القائم يظهر لطرفيه", async ({
    page,
  }) => {
    let confirmed = false;
    await page.route("**/api/org/settings", (route) =>
      route.fulfill(json(200, settings({ can_edit: false }))),
    );
    await page.route("**/api/org/ownership/t1/confirm", (route) => {
      confirmed = true;
      return route.fulfill(
        json(200, { transfer: {}, ...ownership({ can_request: true, can_confirm: false }) }),
      );
    });
    await page.route("**/api/org/ownership", (route) =>
      route.fulfill(
        json(
          200,
          ownership({
            can_request: false,
            can_confirm: true,
            candidates: [],
            current: {
              id: "t1",
              from_user_name: "عثمان الطيب",
              to_user_id: "u1",
              to_user_name: "سميّة عبد الله",
              state: "pending",
              requested_at: today(9, 0),
              expires_at: today(9, 0),
            },
          }),
        ),
      ),
    );
    await login(page, "/org/settings");
    const root = page.locator('[data-screen="ORG-09"]');
    await expect(root).toContainText("طلب نقل قائم");
    await expect(root).toContainText("من عثمان الطيب إلى سميّة عبد الله · ينقضي في 09:00");
    await page.getByRole("button", { name: "أؤكّد استلام الملكية" }).click();
    await expect.poll(() => confirmed).toBe(true);
    await expect(root).not.toContainText("طلب نقل قائم");
  });

  test("نمط الأرقام العربية يظهر في المعاينة فوراً؛ مدير الفرع يقرأ ولا يحفظ", async ({ page }) => {
    await page.route("**/api/org/ownership", (route) =>
      route.fulfill(json(200, ownership({ can_request: false, candidates: [] }))),
    );
    await page.route("**/api/org/settings", (route) =>
      route.fulfill(
        json(200, settings({ can_edit: false, locale: { language: "ar", numerals: "arabic" } })),
      ),
    );
    await login(page, "/org/settings");
    const root = page.locator('[data-screen="ORG-09"]');
    await expect(root).toContainText("٤٢٠٫٠٠");
    await expect(page.getByRole("button", { name: "حفظ", exact: true })).toHaveCount(0);
    await expect(root).toContainText("الإعدادات للمالك — القراءة متاحة لمدير الفرع.");
  });
});

test.describe("ORG-10", () => {
  test("loading → ready: أحدث الأفعال بفاعل ووقت وسبب؛ الحسّاسة فقط؛ لا تعديل ولا حذف", async ({
    page,
  }, info) => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    const calls: string[] = [];
    await page.route("**/api/org/audit**", async (route) => {
      await gate;
      const url = new URL(route.request().url());
      calls.push(url.search);
      const sensitiveOnly = url.searchParams.get("sensitive") === "1";
      const rows = sensitiveOnly ? AUDIT_ROWS.filter((r) => r.sensitive) : AUDIT_ROWS;
      await route.fulfill(json(200, audit({ rows, count: rows.length })));
    });
    await login(page, "/org/audit");
    await expectFrame(page, info, {
      screenId: "ORG-10",
      state: "loading",
      texts: fromFrame("ORG-10", "loading", [
        "جلب السجل",
        "مع المدى المختار وعدد الأحداث المتوقَّع. السجل قد يبلغ آلاف الأسطر.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    release!();
    await expectFrame(page, info, {
      screenId: "ORG-10",
      state: "ready",
      texts: fromFrame("ORG-10", "ready", [
        "سجل التدقيق — فاعل ووقت وسبب، ولا تعديل",
        "السجل الذي يمكن تعديله ليس سجلاً. يُقرأ ويُصفّى ويُصدَّر، ولا يُحرَّر ولو من المالك.",
        "لا زر تعديل ولا زر حذف في هذه الشاشة.",
        "التصحيح يُسجَّل كقيد جديد يشير إلى الأول. من يرى السجل يحدَّد بالدور: الكاشير يرى أفعاله وحدها، والمدير يرى فرعه، والمالك يرى الكل.",
        "أحدث الأفعال",
        "التصدير من الهاتف متاح للمالك فقط، ويحمل نطاق التصفية في ترويسته.",
        "اليوم",
        "كل الفروع",
        "الأفعال الحسّاسة فقط",
        "مدير الفرع",
        "رفض دمج طرفين متشابهي الاسم",
        "وُسم الطرفان «مراجَعان ومنفصلان» — الرقمان والعنوانان مختلفان.",
        "المالك",
        "محاولة حذف فرع بحري — مُنعت",
        "أمين المخزن",
        "تعطيل حساب الكاشير 2",
      ]),
    });
    const root = page.locator('[data-screen="ORG-10"]');
    await expect(root).toContainText("اعتماد عجز وردية 150.00");
    await expect(root).toContainText("السبب المكتوب: «فكّة ناقصة من تحويل أمس»");
    await expect(root).toContainText(
      "الفرع يحمل 1,847 فاتورة. عُرض الإقفال بديلاً ولم يُنفَّذ بعد.",
    );
    await expect(root).toContainText("أنتج تعارضاً مع تعديل آخر — لم يُحسم بعد (SYS-03)");
    await expect(page.getByRole("button", { name: /تعديل|حذف/ })).toHaveCount(0);
    await page.getByLabel("الأفعال الحسّاسة فقط").check();
    await expect(root).not.toContainText("تعديل سعر «سكر — كيس 50» بلا اتصال");
    expect(calls.some((c) => c.includes("sensitive=1"))).toBe(true);
    await expect(page.getByRole("button", { name: "تصدير" })).toBeVisible();
  });

  test("empty: لا أحداث في المدى — آخر حدث معلن وزرّ يوسّعه؛ permission_denied: المدير يرى فرعه", async ({
    page,
  }, info) => {
    let who: "owner" | "manager" = "owner";
    await page.route("**/api/org/audit**", (route) => {
      const url = new URL(route.request().url());
      if (who === "manager")
        return route.fulfill(
          json(
            200,
            audit({ scope: "branch", can_export: false, rows: AUDIT_ROWS.slice(0, 1), count: 1 }),
          ),
        );
      const range = url.searchParams.get("range") ?? "today";
      return route.fulfill(
        json(
          200,
          audit(
            range === "today"
              ? {
                  rows: [],
                  count: 0,
                  last_event_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
                }
              : { range },
          ),
        ),
      );
    });
    await login(page, "/org/audit");
    await expectFrame(page, info, {
      screenId: "ORG-10",
      state: "empty",
      texts: fromFrame("ORG-10", "empty", [
        "لا أحداث في المدى",
        "المدى بلا أحداث مسجّلة — والسبب المرشّح غالباً.",
        "لا نقول «لا سجل»",
      ]),
    });
    const root = page.locator('[data-screen="ORG-10"]');
    await expect(root).toContainText("لا أحداث في هذا المدى — آخر حدث قبل 3 أيام.");
    await page.getByRole("button", { name: "وسّع المدى" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    who = "manager";
    await navTo(page, "الإعدادات", { exact: true });
    await page.route("**/api/org/settings", (route) =>
      route.fulfill(json(200, settings({ can_edit: false }))),
    );
    await expect(page).toHaveURL(/\/org\/settings$/);
    await navTo(page, "سجل التدقيق", { exact: true });
    await expectFrame(page, info, {
      screenId: "ORG-10",
      state: "permission_denied",
      texts: fromFrame("ORG-10", "permission_denied", [
        "لا زر تعديل ولا زر حذف في هذه الشاشة.",
        "التصدير من الهاتف متاح للمالك فقط، ويحمل نطاق التصفية في ترويسته.",
        "اعتماد عجز وردية 150.00",
      ]),
    });
    await expect(page.getByRole("button", { name: "تصدير" })).toHaveCount(0);
    await expect(page.locator('[data-screen="ORG-10"]')).toContainText("ترى أفعال فرعك.");
  });
});
