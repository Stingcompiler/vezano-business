import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T3.22 — PLT-09 صحة المزامنة والخادم (4) + PLT-10 نسخ خادمية وتجربة استعادة (4): تشخيص لا
 * محتوى (عدّادات وأطوار وأزمنة)؛ لا كاش — القياس المتقادم يُعلَن؛ العقدة المتعثّرة تُعرض بنطاقها
 * وآخر نجاح. RPO/RTO نتيجةً لا وعداً، ولا زرّ مدمّر بلا مسار مخوَّل (ACC-75).
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const ROWS = [
  {
    key: "phases",
    label: "أطوار المزامنة (محلي · قيد الرفع · مؤكَّد)",
    value: "312 · 40 · 18940",
    value_note: "",
    status: "ok",
    status_label: "يُقرأ",
    meaning: "ثلاثة أطوار صريحة في كل مستأجر؛ الرقم أدناه يفصّل المتعثّر منها.",
  },
  {
    key: "oldest",
    label: "أقدم حدث معلّق",
    value: "5",
    value_note: "أيام",
    status: "stuck",
    status_label: "متعثّر",
    meaning: "جهاز واحد في مخزن الأمل لم يزامن 5 أيام — أُبلغ التاجر مرتين، بلا محو صامت.",
  },
  {
    key: "write_success",
    label: "نسبة نجاح الكتابة الخادمية",
    value: "99.98%",
    value_note: "",
    status: "ok",
    status_label: "سليم",
    meaning: "الفشل النادر يُمنع معه البيع بالذمة ولا تُعرض رسالة حفظ ناجح كاذبة (SYS-04).",
  },
  {
    key: "conflicts",
    label: "تعارضات بانتظار حسم مالك",
    value: "3",
    value_note: "",
    status: "waiting",
    status_label: "بانتظار",
    meaning: "النسختان محفوظتان كاملتين؛ الحسم صلاحية مالك المتجر لا المشغّل (SYS-03).",
  },
  {
    key: "node_last_ok",
    label: "آخر نجاح لكل عقدة خادمية",
    value: "node-a",
    value_note: "قبل 1 دقيقة",
    status: "ok",
    status_label: "محدَّث",
    meaning: "يُعرض زمن آخر نجاح لا «الآن» دائماً؛ التقادم يُعلَن ولا يُخفى.",
  },
];
const HEALTH = (state: "ready" | "server_error") => ({
  state,
  measured_at: new Date().toISOString(),
  cards: {
    online_devices: 412,
    late_devices: 6,
    late_tenants: 3,
    queue_pending: 312,
    queue_trend: "يتناقص بمعدل سليم",
    p95_ms: 240,
    p95_samples: 1800,
    p95_within_limit: true,
    p95_limit_ms: 800,
    generation: "g7",
    stale_replies_pending: 0,
  },
  rows:
    state === "server_error"
      ? ROWS.map((r) =>
          r.key === "node_last_ok"
            ? { ...r, value_note: "قبل 42 دقيقة", status: "stalled", status_label: "متعثّرة" }
            : r,
        )
      : ROWS,
  node: {
    name: "node-a",
    stalled: state === "server_error",
    last_ok_at: minutesAgo(state === "server_error" ? 42 : 1),
    tenants_scope: 128,
    held_queue: state === "server_error" ? 312 : 0,
  },
});

async function operatorLogin(page: Page) {
  await page.route("**/api/platform/login", (route) =>
    route.fulfill(
      json(200, { access: "op", refresh: "r", session_id: "s", display_name: "طيب — تشغيل" }),
    ),
  );
  await page.route("**/api/platform/tenants**", (route) =>
    route.fulfill(
      json(200, {
        tenants: [],
        total: 0,
        shown: 0,
        active_count: 0,
        filter: "all",
        q: "",
        access_rule: "",
        fetched_at: new Date().toISOString(),
      }),
    ),
  );
  await page.goto("/platform/login");
  await page.getByLabel("بريد المشغّل").fill("ops.tayeb@sting.internal");
  await page.getByLabel("كلمة المرور").fill("very-secret-ops");
  await page.getByLabel("2FA").fill("123456");
  await page.getByRole("button", { name: "دخول مساحة المشغّل" }).click();
  await expect(page).toHaveURL(/\/platform\/tenants$/);
}

test.describe("PLT-09", () => {
  test("loading → ready → stale: مؤشرات حيّة بلا محتوى، والقياس المتعذّر يُعلَن متقادماً لا «سليماً»", async ({
    page,
  }, info) => {
    let released = false;
    let fail = false;
    await page.route("**/api/platform/health", async (route) => {
      while (!released) await new Promise((r) => setTimeout(r, 50));
      if (fail) return route.fulfill(json(503, { detail: "unavailable" }));
      return route.fulfill(json(200, HEALTH("ready")));
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "الصحة" }).click();
    await expect(page).toHaveURL(/\/platform\/health$/);
    await expectFrame(page, info, {
      screenId: "PLT-09",
      state: "loading",
      texts: fromFrame("PLT-09", "loading", [
        "جلب المؤشرات",
        "مؤشرات حيّة لا مخزّنة، مع وقت آخر قياس.",
        "لا كاش هنا",
        "لوحةٌ تقول «كل شيء سليم» بناءً على قياس قديم هي أخطر ما في غرفة العمليات.",
      ]),
    });
    released = true;
    await expectFrame(page, info, {
      screenId: "PLT-09",
      state: "ready",
      texts: fromFrame("PLT-09", "ready", [
        "صحة المزامنة والخادم — تشخيص مخوّل لا نافذة على الدفاتر",
        "ما يحتاجه المشغّل ليعرف أن الخدمة سليمة: أطوار المزامنة، وطابور الرفع، وصحة الجيل الخادمي — بلا محتوى معاملة واحدة.",
        "صحة النظام",
        "أجهزة متزامنة الآن",
        "6 أجهزة متأخرة عبر 3 متاجر",
        "طابور الرفع",
        "أحداث معلّقة · يتناقص بمعدل سليم",
        "زمن الاستجابة p95",
        "ضمن الحدّ · قياس آخر 5 دقائق",
        "جيل الخادم",
        "موحّد · لا ردود جيل قديم معلَّقة",
        "مؤشرات التشخيص",
        "المؤشر",
        "القيمة",
        "الحالة",
        "ما يعنيه للمشغّل",
        "أطوار المزامنة (محلي · قيد الرفع · مؤكَّد)",
        "ثلاثة أطوار صريحة في كل مستأجر؛ الرقم أدناه يفصّل المتعثّر منها.",
        "يُقرأ",
        "أقدم حدث معلّق",
        "جهاز واحد في مخزن الأمل لم يزامن 5 أيام — أُبلغ التاجر مرتين، بلا محو صامت.",
        "متعثّر",
        "نسبة نجاح الكتابة الخادمية",
        "الفشل النادر يُمنع معه البيع بالذمة ولا تُعرض رسالة حفظ ناجح كاذبة (SYS-04).",
        "سليم",
        "تعارضات بانتظار حسم مالك",
        "النسختان محفوظتان كاملتين؛ الحسم صلاحية مالك المتجر لا المشغّل (SYS-03).",
        "بانتظار",
        "آخر نجاح لكل عقدة خادمية",
        "يُعرض زمن آخر نجاح لا «الآن» دائماً؛ التقادم يُعلَن ولا يُخفى.",
        "محدَّث",
        "تشخيص لا محتوى.",
        "كل ما هنا عدّادات وأطوار وأزمنة استجابة — لا معرّف معاملة ولا مبلغ ولا اسم زبون. حين يتعثّر مستأجر بعينه يظهر عدد أجهزته المتأخرة فقط، والدخول إلى دفتره يبقى محكوماً بتذكرة وإذن مؤقت (PLT-02).",
      ]),
    });
    const root = page.locator('[data-screen="PLT-09"]');
    await expect(root).toContainText(/آخر تحديث قبل \d+ ثانية/);
    // لا معرّف معاملة ولا مبلغ ولا اسم زبون
    await expect(root).not.toContainText(/INV-|ج\.س|زبون:/);
    // القياس التالي يتعذّر → متقادم لا «سليم»
    fail = true;
    await page.getByRole("button", { name: "قياس الآن" }).first().click();
    await expectFrame(page, info, {
      screenId: "PLT-09",
      state: "stale",
      texts: fromFrame("PLT-09", "stale", ["صحة النظام", "آخر نجاح لكل عقدة خادمية"]),
    });
    await expect(root).toContainText("تعذّر القياس الأخير — المعروض من آخر قياس ناجح");
    fail = false;
    await page.getByRole("button", { name: "قياس الآن" }).first().click();
    await expect(page.locator('[data-screen="PLT-09"][data-state="ready"]')).toBeVisible();
  });

  test("server_error: عقدة متعثّرة — تُعرض بنطاقها ووقت آخر نجاح والطابور المعلَّق، بلا ردّ جيل قديم", async ({
    page,
  }, info) => {
    await page.route("**/api/platform/health", (route) =>
      route.fulfill(json(200, HEALTH("server_error"))),
    );
    await operatorLogin(page);
    await page.getByRole("button", { name: "الصحة" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-09",
      state: "server_error",
      texts: fromFrame("PLT-09", "server_error", [
        "عند تعثُّر عقدة خادمية: تُعرض العقدة المتأثرة ونطاق المستأجرين عليها ووقت آخر نجاح — ولا يُطبَّق ردّ جيل قديم فوق ما نجح على أجهزة التجار. الأثر يُصف طابوراً معلَّقاً يحسمه مسار مخوَّل، تماشياً مع SYS-08.",
        "آخر نجاح لكل عقدة خادمية",
      ]),
    });
    const root = page.locator('[data-screen="PLT-09"]');
    await expect(root).toContainText("العقدة node-a · نطاقها 128 متجراً");
    await expect(root).toContainText("طابور معلَّق 312");
    await expect(root).toContainText("متعثّرة");
  });
});

const BACKUP = (o: Record<string, unknown> = {}) => ({
  id: "b1",
  kind: "nightly",
  kind_label: "ليلية",
  taken_at: "2026-09-12T02:00:00",
  size_bytes: 2_400_000_000,
  status: "ok",
  status_label: "صالحة",
  note: "",
  integrity_label: "صالحة ومختبَرة",
  last_drill: {
    at: "2026-09-12T02:10:00",
    result: "ok",
    integrity_pct: 100,
    by_name: "طيب — تشغيل",
  },
  usable: true,
  ...o,
});
const BACKUPS = [
  BACKUP(),
  BACKUP({ id: "b2", taken_at: "2026-09-11T02:00:00", integrity_label: "صالحة", last_drill: null }),
  BACKUP({
    id: "b4",
    kind: "weekly",
    kind_label: "أسبوعية",
    taken_at: "2026-09-08T02:00:00",
    size_bytes: 9_800_000_000,
    last_drill: { at: "2026-09-08T03:00:00", result: "ok", integrity_pct: 100, by_name: "سارة" },
  }),
];
const FAILED = BACKUP({
  id: "b3",
  taken_at: "2026-09-13T02:00:00",
  size_bytes: 0,
  status: "incomplete",
  status_label: "لم تكتمل",
  integrity_label: "فشلت",
  last_drill: null,
  usable: false,
});
const PAYLOAD = (rows: unknown[], nightlyFailed: boolean, achieved = true) => ({
  state: nightlyFailed ? "server_error" : "ready",
  measured_at: new Date().toISOString(),
  achieved: achieved
    ? {
        rpo_minutes: 5,
        rto_minutes: 38,
        integrity_pct: 100,
        drill_at: "2026-09-12T02:10:00",
        drill_by_name: "طيب — تشغيل",
        backup_taken_at: "2026-09-12T02:00:00",
      }
    : {
        rpo_minutes: null,
        rto_minutes: null,
        integrity_pct: null,
        drill_at: "",
        drill_by_name: "",
        backup_taken_at: "",
      },
  nightly_failed: nightlyFailed,
  last_valid_at: "2026-09-11T02:00:00",
  backups: rows,
  live_restore_requirements: [
    "تأكيد كتابيّ لاسم البيئة",
    "موافقة مشغّل ثانٍ",
    "نافذة صيانة معلَنة للتجار",
    "أثر كامل",
  ],
});

test.describe("PLT-10", () => {
  test("loading → ready → success: RPO/RTO من آخر تجربة فعلية، وتجربة معزولة تُسجَّل بمن نفّذها", async ({
    page,
  }, info) => {
    let released = false;
    await page.route("**/api/platform/backups", async (route) => {
      while (!released) await new Promise((r) => setTimeout(r, 50));
      return route.fulfill(json(200, PAYLOAD(BACKUPS, false)));
    });
    await page.route("**/api/platform/backups/b2/drill", (route) =>
      route.fulfill(
        json(200, {
          drill: {
            result: "ok",
            rpo_minutes: 4,
            rto_minutes: 1,
            integrity_pct: 100,
            detail: "تحقّق 7/7 جدولاً على بيئة معزولة",
            by_name: "طيب — تشغيل",
            finished_at: new Date().toISOString(),
          },
          ...PAYLOAD(
            [
              BACKUPS[0],
              BACKUP({
                id: "b2",
                taken_at: "2026-09-11T02:00:00",
                last_drill: {
                  at: new Date().toISOString(),
                  result: "ok",
                  integrity_pct: 100,
                  by_name: "طيب — تشغيل",
                },
              }),
              BACKUPS[2],
            ],
            false,
          ),
        }),
      ),
    );
    await operatorLogin(page);
    await page.getByRole("button", { name: "النسخ" }).click();
    await expect(page).toHaveURL(/\/platform\/backups$/);
    await expectFrame(page, info, {
      screenId: "PLT-10",
      state: "loading",
      texts: fromFrame("PLT-10", "loading", [
        "جلب سجل النسخ",
        "مع نتائج آخر تجربة استعادة — وهي المعلومة الحقيقية لا وجود النسخة.",
        "RPO وRTO قياسان",
        "يُعرضان كنتيجة مقاسة لا كوعد (ACC-75). النسخة التي لم تُستعَد تجريبياً مجهولة الصلاحية.",
      ]),
    });
    released = true;
    await expectFrame(page, info, {
      screenId: "PLT-10",
      state: "ready",
      texts: fromFrame("PLT-10", "ready", [
        "نسخ خادمية وتجربة استعادة — RPO/RTO نتيجةً لا وعداً، ولا زرّ مدمّر بلا مسار مخوَّل",
        "النسخ تُختبر باستعادة فعلية دورية. الأرقام معروضة كقياس محقَّق، والاستعادة فوق بيانات حيّة محكومة بمسار متعدّد الموافقات (ACC-75).",
        "تجربة ناجحة",
        "RPO المحقَّق — أقصى فقد محتمل",
        "≤ 5 min",
        "قياس من آخر تجربة استعادة فعلية، لا هدف نظري",
        "RTO المحقَّق — زمن العودة للخدمة",
        "38 min",
        "من تجربة 12/09 على بيئة معزولة",
        "آخر تجربة استعادة ناجحة",
        "12/09 · 02:10",
        "تحقّق سلامة تلقائي: 100% من الجداول",
        "النسخ المتاحة وتجارب الاستعادة",
        "النسخة",
        "الحجم",
        "تحقّق السلامة",
        "آخر تجربة استعادة",
        "ليلية · 12/09 02:00",
        "استُعيدت بنجاح 12/09 — سلامة 100%",
        "صالحة ومختبَرة",
        "ليلية · 11/09 02:00",
        "صالحة — لم تُختبر بعد",
        "صالحة",
        "أسبوعية · 08/09",
        "استُعيدت 08/09 — سلامة 100%",
        "استعادة فوق بيانات حيّة — إجراء مدمّر محكوم",
        "لا زرّ واحد يستبدل قاعدة الإنتاج. الاستعادة الحيّة تتطلّب: تأكيد كتابيّ لاسم البيئة، وموافقة مشغّل ثانٍ، ونافذة صيانة معلَنة للتجار، وأثراً كاملاً. الافتراضي دائماً هو الاستعادة إلى بيئة معزولة أولاً.",
        "تشغيل تجربة استعادة معزولة",
        "استعادة حيّة — تتطلّب موافقة ثانية",
      ]),
    });
    const root = page.locator('[data-screen="PLT-10"]');
    await expect(root).toContainText("2.2 GB");
    // تجربة معزولة على النسخة غير المختبَرة
    await page.getByRole("button", { name: "تشغيل تجربة استعادة معزولة" }).nth(1).click();
    await expectFrame(page, info, {
      screenId: "PLT-10",
      state: "success",
      texts: fromFrame("PLT-10", "success", ["تجربة ناجحة", "صالحة ومختبَرة"]),
    });
    await expect(root).toContainText("تحقّق 7/7 جدولاً على بيئة معزولة");
    await expect(root).toContainText("نفّذها طيب — تشغيل");
    await expect(root).not.toContainText("صالحة — لم تُختبر بعد");
  });

  test("server_error: فشلت النسخة الليلية — لا «محميّ»، والفاشلة لا تُستعاد، والاستعادة الحيّة تُمنع حتى تكتمل الشروط", async ({
    page,
  }, info) => {
    await page.route("**/api/platform/backups", (route) =>
      route.fulfill(json(200, PAYLOAD([FAILED, ...BACKUPS], true))),
    );
    let calls = 0;
    await page.route("**/api/platform/backups/b1/live", (route) => {
      calls += 1;
      const b = route.request().postDataJSON() as { environment: string; second_approver: string };
      const missing = [
        ...(b.environment === "prod-sd" ? [] : ["تأكيد كتابيّ لاسم البيئة"]),
        ...(b.second_approver === "سارة" ? [] : ["موافقة مشغّل ثانٍ"]),
        "نافذة صيانة معلَنة للتجار",
      ];
      return route.fulfill(json(400, { detail: "live_restore_requirements", extra: { missing } }));
    });
    await operatorLogin(page);
    await page.getByRole("button", { name: "النسخ" }).click();
    await expectFrame(page, info, {
      screenId: "PLT-10",
      state: "server_error",
      texts: fromFrame("PLT-10", "server_error", [
        "فشلت آخر محاولة نسخ ليلية",
        "ليلية · 13/09 02:00",
        "لم تكتمل — أُعيدت الجدولة",
        "فشلت",
      ]),
    });
    const root = page.locator('[data-screen="PLT-10"]');
    await expect(root).toContainText(
      "النسخة الأخيرة الصالحة هي 11/09. لا نعرض «محميّ» بينما الفشل قائم؛ يُرفع تنبيه للمشغّل ويُمنع أي إجراء استعادة يعتمد على النسخة الفاشلة.",
    );
    await expect(root).not.toContainText("محميّ ·");
    // الفاشلة بلا أزرار استعادة إطلاقاً (4 نسخ، 3 صالحة)
    await expect(page.getByRole("button", { name: "تشغيل تجربة استعادة معزولة" })).toHaveCount(3);
    // الاستعادة الحيّة: بلا شروط → مُنعت بتسمية الناقص؛ باسم البيئة والموافق → تبقى نافذة الصيانة
    await page.getByRole("button", { name: "استعادة حيّة — تتطلّب موافقة ثانية" }).first().click();
    await page.getByRole("button", { name: "تسجيل طلب الاستعادة الحيّة" }).click();
    await expect(root).toContainText("مُنعت — شروط ناقصة");
    await expect(root).toContainText("تأكيد كتابيّ لاسم البيئة");
    await expect(root).toContainText("موافقة مشغّل ثانٍ");
    await page.getByLabel("اكتب اسم البيئة تأكيداً").fill("prod-sd");
    await page.getByLabel("اسم المشغّل الثاني الموافق").fill("سارة");
    await page.getByRole("button", { name: "تسجيل طلب الاستعادة الحيّة" }).click();
    await expect(root.locator("li", { hasText: "نافذة صيانة معلَنة للتجار" })).toBeVisible();
    await expect(root.locator("li", { hasText: "تأكيد كتابيّ لاسم البيئة" })).toHaveCount(0);
    expect(calls).toBe(2);
  });
});
