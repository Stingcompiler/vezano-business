import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T2.1 — ORG-01 المستخدمون والدعوات (6) + ORG-02 مصفوفة الأدوار والصلاحيات (4). الدعوة ليست حساباً
 * والتعطيل ليس حذفاً؛ لا دعوة ثانية لرقم مدعوّ؛ الدعوة المنتهية لا تُحيا؛ المصفوفة للمالك وحده
 * تعديلاً وعمود المالك مقفل؛ الحفظ يقول الأثر بالعدد (G-09).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const ROLES = [
  { id: "r-owner", code: "owner", name: "مالك" },
  { id: "r-manager", code: "manager", name: "مدير فرع" },
  { id: "r-cashier", code: "cashier", name: "كاشير" },
  { id: "r-store", code: "storekeeper", name: "أمين مخزن" },
];
const BRANCHES = [
  { id: "b1", name: "فرع بحري" },
  { id: "b2", name: "المخزن الرئيسي" },
];

const USERS = [
  {
    id: "u1",
    display_name: "عثمان الطيب",
    is_owner: true,
    status: "active",
    roles: [{ code: "owner", name: "مالك" }],
    branches: [],
    all_branches: true,
    operations: 0,
  },
  {
    id: "u2",
    display_name: "سميّة عبد الله",
    is_owner: false,
    status: "active",
    roles: [{ code: "manager", name: "مدير فرع" }],
    branches: [{ id: "b1", name: "فرع بحري" }],
    all_branches: false,
    operations: 40,
  },
  {
    id: "u3",
    display_name: "أحمد ياسين",
    is_owner: false,
    status: "disabled",
    roles: [{ code: "cashier", name: "كاشير" }],
    branches: [{ id: "b1", name: "فرع بحري" }],
    all_branches: false,
    operations: 1240,
  },
];
const INV_SENT = {
  id: "i1",
  identifier_masked: "kamal@…",
  role_code: "cashier",
  role_name: "كاشير",
  branch_id: "b1",
  branch_name: "فرع بحري",
  status: "sent",
  sent_at: "2026-09-09T10:00:00Z",
  expires_at: "2026-09-12T10:00:00Z",
  inviter_name: "عثمان الطيب",
};
const INV_EXPIRED = {
  ...INV_SENT,
  id: "i2",
  identifier_masked: "hiba@…",
  role_code: "storekeeper",
  role_name: "أمين مخزن",
  branch_id: "b2",
  branch_name: "المخزن الرئيسي",
  status: "expired",
  sent_at: "2026-09-04T10:00:00Z",
};

function usersPayload(users = USERS, invitations = [INV_SENT, INV_EXPIRED]) {
  return {
    users,
    invitations,
    counts: {
      users: users.length,
      open_invitations: invitations.filter((i) => i.status === "sent").length,
    },
    invite_ttl_hours: 72,
    branches: BRANCHES,
    roles: ROLES.filter((r) => r.code !== "owner"),
    can_invite: true,
  };
}

const cell = (
  role_id: string,
  label: string,
  value: string,
  limit_minor: string | null = null,
) => ({
  role_id,
  label,
  value,
  limit_minor,
  period: value === "limit" ? "per_op" : "",
});
const R = (key: string, label: string, note: string, financial: boolean, cells: unknown[]) => ({
  key,
  label,
  note,
  financial,
  cells,
});
function matrixPayload(can_edit = true) {
  return {
    can_edit,
    tenant_name: "بقالة النيل — تجريبي",
    roles: [
      { id: "r-owner", code: "owner", name: "مالك", users: 1, locked: true },
      { id: "r-manager", code: "manager", name: "مدير فرع", users: 1, locked: false },
      { id: "r-cashier", code: "cashier", name: "كاشير", users: 3, locked: false },
      { id: "r-store", code: "storekeeper", name: "أمين مخزن", users: 1, locked: false },
    ],
    rows: [
      R("sell", "البيع وإصدار الفاتورة", "POS-01–08", false, [
        cell("r-owner", "نعم", "yes"),
        cell("r-manager", "نعم", "yes"),
        cell("r-cashier", "نعم", "yes"),
        cell("r-store", "لا", "no"),
      ]),
      R("discount", "خصم وتجاوز سعر", "POS-03 · حد مالي", true, [
        cell("r-owner", "بلا حد", "unlimited"),
        cell("r-manager", "200 للعملية", "limit", "20000"),
        cell("r-cashier", "10 للعملية", "limit", "1000"),
        cell("r-store", "لا", "no"),
      ]),
      R("refund", "مرتجع", "POS-10", false, [
        cell("r-owner", "نعم", "yes"),
        cell("r-manager", "نعم", "yes"),
        cell("r-cashier", "حتى 500", "limit", "50000"),
        cell("r-store", "لا", "no"),
      ]),
      R("view_receivables", "رؤية ذمم كل العملاء", "PTY-01 · REP-02", false, [
        cell("r-owner", "نعم", "yes"),
        cell("r-manager", "فرعه", "branch"),
        cell("r-cashier", "عميل البيع فقط", "own_customer"),
        cell("r-store", "لا", "no"),
      ]),
      R("record_payment", "تسجيل سداد", "PTY-06", false, [
        cell("r-owner", "نعم", "yes"),
        cell("r-manager", "نعم", "yes"),
        cell("r-cashier", "نقداً فقط", "cash_only"),
        cell("r-store", "لا", "no"),
      ]),
      R("close_short", "إغلاق وردية بعجز", "SHIFT-04 · حد مالي", true, [
        cell("r-owner", "بلا حد", "unlimited"),
        cell("r-manager", "حتى 300", "limit", "30000"),
        cell("r-cashier", "حتى 50", "limit", "5000"),
        cell("r-store", "لا", "no"),
      ]),
      R("stock_adjust", "تسوية جرد", "INV-06", false, [
        cell("r-owner", "نعم", "yes"),
        cell("r-manager", "فرعه", "branch"),
        cell("r-cashier", "لا", "no"),
        cell("r-store", "اقتراح فقط", "propose"),
      ]),
      R("campaign_create", "إنشاء حملة", "NOT-04", false, [
        cell("r-owner", "نعم", "yes"),
        cell("r-manager", "نعم", "yes"),
        cell("r-cashier", "لا", "no"),
        cell("r-store", "لا", "no"),
      ]),
      R("campaign_approve", "اعتماد ونشر حملة", "NOT-05 · منفصل عمداً", false, [
        cell("r-owner", "نعم", "yes"),
        cell("r-manager", "لا", "no"),
        cell("r-cashier", "لا", "no"),
        cell("r-store", "لا", "no"),
      ]),
      R("conflict_review", "مراجعة تعارض وحجر", "SYS-03", false, [
        cell("r-owner", "نعم", "yes"),
        cell("r-manager", "لا", "no"),
        cell("r-cashier", "لا", "no"),
        cell("r-store", "لا", "no"),
      ]),
    ],
  };
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

test.describe("ORG-01", () => {
  test("loading → ready: القائمة من الخادم بحالات الدعوة الأربع والمعطَّل باسمه؛ expired: الدعوة المنتهية لا تُحيا", async ({
    page,
  }, info) => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => (release = r));
    await page.route("**/api/org/users", async (route) => {
      await gate;
      await route.fulfill(json(200, usersPayload()));
    });
    await login(page, "/org/users");
    await expectFrame(page, info, {
      screenId: "ORG-01",
      state: "loading",
      texts: fromFrame("ORG-01", "loading", [
        "المستخدمون والدعوات",
        "من يدخل منشأتك وبأي دور. أربع حالات ناقصة.",
        "جلب المستخدمين",
        "القائمة من الخادم دائماً لا من كاش — من يفتحها يسأل «من يدخل الآن؟».",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    release!();
    await expectFrame(page, info, {
      screenId: "ORG-01",
      state: "ready",
      texts: fromFrame("ORG-01", "ready", [
        "دعوة مستخدم",
        "المستخدم",
        "الدور والفرع",
        "الحالة",
        "ما يعنيه ذلك عملياً",
        "عثمان الطيب",
        "مالك",
        "كل الفروع",
        "الحساب الوحيد الذي يرى الاشتراك والمبالغ. لا يُعطَّل إلا بنقل ملكية موثَّق.",
        "نشط",
        "سميّة عبد الله",
        "مدير فرع",
        "فرع بحري",
        "دعوة — kamal@…",
        "كاشير",
        "دعوة مُرسَلة",
        "دعوة — hiba@…",
        "أمين مخزن",
        "المخزن الرئيسي",
        "انتهت المدة. لا تُحيا: نُصدر دعوة جديدة برابط جديد ويبقى أثر الأولى.",
        "منتهية",
        "أحمد ياسين",
        "كاشير — سابقاً",
        "معطَّل",
        "الدعوة المنتهية لا تُحيا بضغطة.",
      ]),
    });
    const root = page.locator('[data-screen="ORG-01"]');
    await expect(root).toContainText("الرابط صالح 72 ساعة");
    await expect(root).toContainText("1,240");
    await expect(root).toContainText("التعطيل ليس حذفاً.");
    // الدعوة المنتهية: مخرج واحد — إصدار دعوة جديدة ويبقى أثر الأولى
    let resent = 0;
    await page.route("**/api/org/invitations/i2/resend", (route) => {
      resent += 1;
      return route.fulfill(
        json(201, {
          invitation: { ...INV_EXPIRED, id: "i3", status: "sent", sent_at: "2026-09-18T10:00:00Z" },
          link: "/invite/new-token",
          grants: ["تسوية جرد — اقتراح فقط"],
        }),
      );
    });
    await page.getByRole("button", { name: "دعوة منتهية" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-01",
      state: "expired",
      texts: fromFrame("ORG-01", "expired", [
        "دعوة منتهية",
        "الدعوة المنتهية لا تُحيا بضغطة.",
        "دعوة — hiba@…",
      ]),
    });
    await expect(root).toContainText(
      "نُصدر دعوة جديدة برابط جديد وصلاحية جديدة، ويبقى أثر الدعوة الأولى ومن أرسلها.",
    );
    await page.getByRole("button", { name: "إصدار دعوة جديدة" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    expect(resent).toBe(1);
  });

  test("empty: أنت وحدك — لا نُلحّ بالدعوة؛ validation_error: دعوة لرقم مدعوّ أصلاً؛ success: أُرسلت الدعوة بما سيملكه", async ({
    page,
  }, info) => {
    await page.route("**/api/org/users", (route) =>
      route.fulfill(json(200, usersPayload([USERS[0]!], []))),
    );
    await login(page, "/org/users");
    await expectFrame(page, info, {
      screenId: "ORG-01",
      state: "empty",
      texts: fromFrame("ORG-01", "empty", [
        "أنت وحدك",
        "منشأة بمستخدم واحد. حالةٌ شائعة لا نقص.",
        "لا نُلحّ بالدعوة",
        "«أنت المستخدم الوحيد» ومدخل الدعوة حاضر. كثير من المحلات يديرها صاحبها وحده، ودعوة موظفٍ ليست هدفاً.",
        "دعوة مستخدم",
      ]),
    });
    // رقم عليه دعوة معلّقة → 409 مع الدعوة القائمة
    let attempt = 0;
    await page.route("**/api/org/invitations", (route) => {
      attempt += 1;
      if (attempt === 1)
        return route.fulfill(json(409, { detail: "already_invited", existing: INV_SENT }));
      return route.fulfill(
        json(201, {
          invitation: { ...INV_SENT, id: "i9", identifier_masked: "0912…" },
          link: "/invite/tok-9",
          grants: ["البيع وإصدار الفاتورة", "خصم وتجاوز سعر — 10 للعملية", "مرتجع — حتى 500"],
        }),
      );
    });
    await page.getByRole("button", { name: "دعوة مستخدم" }).click();
    await page.getByLabel("رقم الهاتف أو البريد").fill("kamal@example.com");
    await page.getByRole("button", { name: "إرسال الدعوة" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-01",
      state: "validation_error",
      texts: fromFrame("ORG-01", "validation_error", [
        "دعوة لرقم مدعوّ أصلاً",
        "الرقم عليه دعوة معلّقة لم تُقبل بعد.",
        "لا دعوة ثانية",
        "نعرض الدعوة القائمة وتاريخها ومخرجَين: أعد إرسالها أو ألغِها. دعوتان لرقم واحد تُربكان من يستقبلهما.",
      ]),
    });
    await expect(page.getByRole("button", { name: "أعد إرسالها" })).toBeVisible();
    await expect(page.getByRole("button", { name: "ألغِها" })).toBeVisible();
    // دعوة لرقم جديد → أُرسلت
    await page.getByRole("button", { name: "دعوة مستخدم" }).click();
    await page.getByLabel("رقم الهاتف أو البريد").fill("0912000111");
    await page.getByRole("button", { name: "إرسال الدعوة" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-01",
      state: "success",
      texts: fromFrame("ORG-01", "success", [
        "أُرسلت الدعوة",
        "نقول ما سيملكه المدعوّ حين يقبل: الدور والفرع وما يستطيع فعله.",
        "الصلاحية تُراجَع قبل الإرسال",
        "لا بعد القبول. تصحيحُ دورٍ بعد أن دخل الموظف أصعب من ضبطه الآن.",
      ]),
    });
    const root = page.locator('[data-screen="ORG-01"]');
    await expect(root).toContainText("خصم وتجاوز سعر — 10 للعملية");
    await expect(root).toContainText("/invite/tok-9");
  });
});

test.describe("ORG-02", () => {
  test("ready → validation_error → success: المصفوفة بقيم الإطار؛ عمود المالك مقفل؛ الحفظ يقول الأثر بالعدد", async ({
    page,
  }, info) => {
    let puts = 0;
    await page.route("**/api/org/roles", (route) => {
      if (route.request().method() === "PUT") {
        puts += 1;
        const body = route.request().postDataJSON() as {
          changes: { role_id: string; key: string }[];
        };
        if (puts === 1) return route.fulfill(json(400, { detail: "owner_locked", key: "sell" }));
        expect(body.changes[0]).toMatchObject({
          role_id: "r-cashier",
          key: "discount",
          value: "limit",
          limit_minor: "2500",
          period: "per_op",
        });
        return route.fulfill(
          json(200, { ...matrixPayload(), changed_cells: 1, affected_users: 3 }),
        );
      }
      return route.fulfill(json(200, matrixPayload()));
    });
    await login(page, "/org/roles");
    await expectFrame(page, info, {
      screenId: "ORG-02",
      state: "ready",
      texts: fromFrame("ORG-02", "ready", [
        "مصفوفة الأدوار والصلاحيات",
        "الفرع والحد المالي وفصل النشر عن الاعتماد. الحدود قابلة للتحرير والقيم تجريبية — قرار G-09.",
        "الأدوار في بقالة النيل — تجريبي",
        "الصلاحية تُمنح للدور، والنطاق يُمنح للمستخدم في الفرع",
        "دور مخصَّص",
        "الصلاحية",
        "مالك",
        "مدير فرع",
        "كاشير",
        "أمين مخزن",
        "البيع وإصدار الفاتورة",
        "خصم وتجاوز سعر",
        "POS-03 · حد مالي",
        "بلا حد",
        "مرتجع",
        "رؤية ذمم كل العملاء",
        "تسجيل سداد",
        "إغلاق وردية بعجز",
        "SHIFT-04 · حد مالي",
        "تسوية جرد",
        "إنشاء حملة",
        "اعتماد ونشر حملة",
        "NOT-05 · منفصل عمداً",
        "مراجعة تعارض وحجر",
        "الحدود المالية قيم تجريبية.",
        "الإجراء وأثره",
        "لا يمكن إنشاء دور بلا مالك قادر على سحبه.",
        "بيع نقدي وإصدار فاتورة",
        "يُسجَّل باسمه وينسب لورديته",
        "نقل ملكية المنشأة",
        "ينقل الدفتر كله لشخص آخر",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="ORG-02"]');
    // القيم التجريبية بأرقامها اللاتينية في mono
    for (const t of [
      "200 للعملية",
      "10 للعملية",
      "حتى 500",
      "حتى 300",
      "حتى 50",
      "فرعه",
      "عميل البيع فقط",
      "نقداً فقط",
      "اقتراح فقط",
    ])
      await expect(root).toContainText(t);
    // عمود المالك مقفل: لا محرّر له
    await expect(page.getByLabel("البيع وإصدار الفاتورة — مالك")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "حفظ المصفوفة" })).toBeDisabled();
    // تغيير سقف الكاشير: 25 للعملية
    await page.getByLabel("حدّ خصم وتجاوز سعر — كاشير").fill("25");
    await page.getByRole("button", { name: "حفظ المصفوفة" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-02",
      state: "validation_error",
      texts: fromFrame("ORG-02", "validation_error", [
        "لا يمكن إنشاء دور بلا مالك قادر على سحبه.",
        "الإجراء وأثره",
        "اعتماد فارق الوردية",
        "شهادة بأن العجز أو الزيادة مقبولان — لا يشهد أحد لنفسه",
      ]),
    });
    await expect(root).toContainText(
      "لا يمكن للمالك أن يسحب صلاحيته الأخيرة عن نفسه: المنشأة بلا مالك تصبح دفتراً لا يملك أحد حسم تعارضاته.",
    );
    await page.getByRole("button", { name: "حفظ المصفوفة" }).click();
    await expectFrame(page, info, {
      screenId: "ORG-02",
      state: "success",
      texts: fromFrame("ORG-02", "success", [
        "حُفظت المصفوفة",
        "والحدود المالية بقيمها ونطاقها (يومي أو للعملية).",
        "يسري فوراً",
        "ومن كان في منتصف عمل يُطبَّق عليه عند فعله التالي لا في لحظته. ولا يُقطع عليه بيعٌ جارٍ.",
      ]),
    });
    await expect(root).toContainText("تغيّرت صلاحيات 3 موظفين");
    expect(puts).toBe(2);
  });

  test("permission_denied: مدير الفرع يرى المصفوفة ولا يعدّلها", async ({ page }, info) => {
    await page.route("**/api/org/roles", (route) => route.fulfill(json(200, matrixPayload(false))));
    await login(page, "/org/roles");
    await expectFrame(page, info, {
      screenId: "ORG-02",
      state: "permission_denied",
      texts: fromFrame("ORG-02", "permission_denied", [
        "المصفوفة للمالك وحده",
        "مدير الفرع يرى أدوار فريقه ولا يعدّل المصفوفة — تعديلها يُغيّر ما يستطيعه كل موظف في المنشأة.",
        "لماذا لا حتى لفرعه",
        "الأدوار معرّفة على مستوى المنشأة لا الفرع. تعديلٌ «لفرعه» يسري على الجميع، وهذا ليس ما يقصده.",
      ]),
    });
    await expect(page.getByRole("button", { name: "حفظ المصفوفة" })).toHaveCount(0);
    await expect(page.locator('[data-screen="ORG-02"]')).toContainText("200 للعملية");
  });
});
