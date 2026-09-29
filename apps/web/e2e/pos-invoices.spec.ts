import { expect, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import {
  json,
  listBody,
  listRoute,
  login,
  seed,
  serverRow,
  today,
  type LocalSeed,
} from "./pos-invoices-fixtures";

/**
 * T1.19 — POS-09 (7) + POS-12 (4). القائمة: المحلي فوراً وفواتير الأجهزة الأخرى تلحق موسومة؛
 * عمود وضع المزامنة لكل فاتورة؛ التاريخ المشكوك فيه معلَّم والأصل لم يُعدَّل (ACC-77)؛ الكاشير
 * يرى نطاقه والمجاميع تقارير. التكرار: المستندان جنباً إلى جنب (ACC-16)، الإجراء عكسي مستند
 * مستقل لا حذف، والقرار لمدير الفرع والكاشير يُبلغ.
 */
const FRAME_ROWS = [
  serverRow("s1040", "1040", today(9, 58), "فاطمة ح. — تجريبي", "64000", "0", "64000"),
  serverRow("s1039", "1039", today(9, 12), "أحمد الطيب — تجريبي", "174000", "174000", "0"),
  serverRow("s1038", "1038", today(3, 7), "نقدي", "31800", "31800", "0", { date_suspect: true }),
];

const LOCAL: LocalSeed[] = [
  {
    id: "l1043",
    number: "1043",
    opState: "synced",
    occurredAt: today(10, 34),
    party: "أحمد الطيب — تجريبي",
    cash: "4000",
    credit: "6000",
  },
  { id: "l1042", number: "1042", opState: "synced", occurredAt: today(10, 31) },
];

const HEAD = [
  "قائمة الفواتير وتفاصيلها",
  "اليوم",
  "هذا الأسبوع",
  "الفرع الرئيسي",
  "كل الفروع",
  "كل حالات المزامنة",
  "معلّق فقط",
  "الرقم والوقت",
  "العميل",
  "الإجمالي",
  "نقداً",
  "آجل",
  "المزامنة",
  "فتح",
];

test.describe("POS-09", () => {
  test("loading → ready: المحلي فوراً، ثم فواتير الأجهزة الأخرى موسومة والتاريخ المشكوك فيه معلَّم", async ({
    page,
  }, info) => {
    await seed(page, LOCAL);
    await listRoute(page, listBody(FRAME_ROWS), { delayMs: 4000 });
    await login(page, "/pos/invoices");
    // المحلي يظهر قبل ردّ الخادم
    await expect(page.locator('[data-screen="POS-09"]')).toContainText("أحمد الطيب — تجريبي");
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "loading",
      texts: fromFrame("POS-09", "loading", [
        "المحلي فوراً",
        "فواتير الجهاز تظهر بلا انتظار، وفواتير الأجهزة الأخرى تلحق موسومة.",
        "قائمة الفواتير وتفاصيلها",
        "أحمد الطيب — تجريبي",
        "مؤكد خادمياً",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "ready",
      texts: fromFrame("POS-09", "ready", [
        ...HEAD,
        "10:34 اليوم",
        "أحمد الطيب — تجريبي",
        "10:31 اليوم",
        "نقدي",
        "09:58 اليوم",
        "فاطمة ح. — تجريبي",
        "09:12 اليوم",
        "⚠ 03:07 — تاريخ مشكوك فيه",
        "مؤكد خادمياً",
        "فواتير · إجمالي اليوم",
        "الصف ذو التاريخ المشكوك فيه معلَّم — ساعة الجهاز كانت خاطئة، والأصل لم يُعدَّل",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="POS-09"]');
    // 5 فواتير: 2 محليتان + 3 من جهاز آخر؛ المجموع 100+100+640+1740+318
    await expect(root).toContainText("5 فواتير · إجمالي اليوم 2,898.00");
    await expect(root).toContainText("40.00");
    await expect(root).toContainText("60.00");
    // فتح الفاتورة المحلية → التفاصيل من الجهاز فوراً
    await root.getByRole("button", { name: "فتح" }).first().click();
    await expect(page).toHaveURL(/\/pos\/invoices\/l1043$/);
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "ready",
      texts: fromFrame("POS-09", "ready", [
        "الرقم والوقت",
        "10:34 اليوم",
        "العميل",
        "أحمد الطيب — تجريبي",
        "الإجمالي",
        "نقداً",
        "آجل",
        "مؤكد خادمياً",
      ]),
    });
    await expect(page.locator('[data-screen="POS-09"]')).toContainText("1043");
    await page.getByRole("button", { name: "إعادة طباعة نسخة" }).click();
    await expect(page).toHaveURL(/\/pos\/receipt\/l1043$/);
  });

  test("pending_sync: عمود وضع المزامنة — و«معلّق فقط» يحصر القائمة", async ({ page }, info) => {
    await seed(page, [
      { ...LOCAL[0]!, opState: "pending" },
      { ...LOCAL[1]!, opState: "local" },
    ]);
    await listRoute(page, listBody(FRAME_ROWS));
    await login(page, "/pos/invoices");
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "pending_sync",
      texts: fromFrame("POS-09", "pending_sync", [
        "عمود وضع المزامنة",
        "لكل فاتورة وضعها: محلي، في الطابور، مؤكَّد.",
        "قاعدة المفردات",
        "القوائم تعرض pending_sync والنماذج تعرض saved_local — خلطهما يوهم أن الفعل خرج من الجهاز وهو لم يخرج.",
        "معلّق المزامنة",
        "محفوظ محلياً",
        "مؤكد خادمياً",
      ]),
    });
    await page.getByRole("button", { name: "معلّق فقط" }).click();
    const root = page.locator('[data-screen="POS-09"]');
    await expect(root).not.toContainText("فاطمة ح. — تجريبي");
    await expect(root).toContainText("1043");
    await expect(root).toContainText("1042");
  });

  test("empty: فراغ المرشِّح ≠ فراغ المحل", async ({ page }, info) => {
    await seed(page, []);
    await listRoute(page, listBody([], { last_sale_at: today(9, 0) }));
    await login(page, "/pos/invoices");
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "empty",
      texts: fromFrame("POS-09", "empty", ["لا فواتير", "لا فواتير في هذا المدى — آخرها"]),
    });
    await page.unroute("**/api/sales?**");
    await listRoute(page, listBody([]));
    await page.getByRole("button", { name: "هذا الأسبوع" }).click();
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "empty",
      texts: fromFrame("POS-09", "empty", ["لا فواتير", "لم يُسجَّل بيع بعد"]),
    });
  });

  test("offline: فواتير الجهاز وما زامنه — والفروع الأخرى غائبة معلَنة", async ({
    page,
    context,
  }, info) => {
    await seed(page, LOCAL);
    await listRoute(page, listBody(FRAME_ROWS));
    await login(page, "/pos/invoices");
    await expect(page.locator('[data-screen="POS-09"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "offline",
      texts: fromFrame("POS-09", "offline", [
        "فواتير الجهاز وما زامنه",
        "القائمة كاملة لما يعرفه الجهاز، وفواتير الفروع الأخرى غائبة معلَنة.",
        "أحمد الطيب — تجريبي",
        "مؤكد خادمياً",
      ]),
    });
    await context.setOffline(false);
  });

  test("stale: الخادم لا يجيب والقائمة من آخر مطابقة", async ({ page }, info) => {
    await seed(page, LOCAL, listBody(FRAME_ROWS));
    await listRoute(page, { detail: "server_error" }, { status: 500 });
    await login(page, "/pos/invoices");
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "stale",
      texts: fromFrame("POS-09", "stale", [
        "فرع آخر يبيع الآن",
        "المجاميع من آخر مطابقة",
        "فاطمة ح. — تجريبي",
        "مؤكد خادمياً",
      ]),
    });
  });

  test("permission_denied: الكاشير يرى نطاقه — «كل الفروع» والمجاميع تقارير", async ({
    page,
  }, info) => {
    await seed(page, LOCAL);
    await listRoute(
      page,
      listBody([], { scope: "device", can_all_branches: false, can_totals: false }),
    );
    await login(page, "/pos/invoices");
    await expect(page.locator('[data-screen="POS-09"][data-state="ready"]')).toBeVisible();
    await page.getByRole("button", { name: "كل الفروع" }).click();
    await expectFrame(page, info, {
      screenId: "POS-09",
      state: "permission_denied",
      texts: fromFrame("POS-09", "permission_denied", [
        "الكاشير يرى نطاقه",
        "فواتير جهازه وورديته، لا كل الفرع ولا مجاميع اليوم.",
        "المجاميع تقارير",
        "مجموع مبيعات الفرع بابه",
        "بصلاحيته. قائمة المراجعة اللحظية غير تقرير الأداء.",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "مجموع مبيعات الفرع بابه «تقرير المبيعات» بصلاحيته.",
    );
    await expect(page.locator('[data-screen="POS-09"]')).not.toContainText("إجمالي اليوم");
  });
});

const doc = (
  id: string,
  number: string,
  at: string,
  device: string,
  user: string,
  sync: "synced" | "reversed" = "synced",
) => ({
  id,
  invoice_number: number,
  device_name: device,
  user_name: user,
  party_name: "",
  total_minor: "10000",
  cash_minor: "10000",
  credit_minor: "0",
  occurred_at: at,
  sync_state: sync,
  lines: [
    {
      id: `${id}-l`,
      item_name: "سكر",
      unit_code: "كغ",
      qty_milli: "1000",
      line_total_minor: "10000",
    },
  ],
});

const PAIR = {
  source: "auto",
  seconds_apart: 26,
  first: doc("s1041", "1041", today(10, 31, 22), "الكاشير 1", "سميرة ع."),
  second: doc("s1042", "1042", today(10, 31, 48), "الكاشير 2", "محمد ب."),
  note: "",
  reported_by_name: "",
};

const dupBody = (pairs: unknown[], can_decide = true) => ({
  can_decide,
  role_name: can_decide ? "مالك" : "كاشير",
  user_name: "سالم",
  window_days: 7,
  pairs,
});

test.describe("POS-12", () => {
  test("empty: لا اشتباهات — القائمة تُفتح من تنبيه لا من تصفّح", async ({ page }, info) => {
    await seed(page, []);
    await page.route("**/api/sales/duplicates", (r) => r.fulfill(json(200, dupBody([]))));
    await login(page, "/pos/duplicates");
    await expectFrame(page, info, {
      screenId: "POS-12",
      state: "empty",
      texts: fromFrame("POS-12", "empty", [
        "مراجعة تكرار تجاري أو تصحيح",
        "لا اشتباهات",
        "حالة سويّة — القائمة تُفتح من تنبيه لا من تصفّح.",
      ]),
    });
  });

  test("ready → conflict: المستندان جنباً إلى جنب، والإجراء عكسي بسبب لا حذف", async ({
    page,
  }, info) => {
    await seed(page, []);
    await page.route("**/api/sales/duplicates", (r) => r.fulfill(json(200, dupBody([PAIR]))));
    const posted: unknown[] = [];
    await page.route("**/api/sales/duplicates/decide", (r) => {
      posted.push(JSON.parse(r.request().postData() ?? "{}"));
      return r.fulfill(
        json(201, {
          decision: "reverse",
          decided_by_name: "سالم",
          second: { ...PAIR.second, sync_state: "reversed" },
        }),
      );
    });
    await login(page, "/pos/duplicates");
    await expectFrame(page, info, {
      screenId: "POS-12",
      state: "ready",
      texts: fromFrame("POS-12", "ready", [
        "مراجعة تكرار تجاري أو تصحيح",
        "المستندان جنباً إلى جنب",
        "نفس الصنف والكمية والدقائق من جهازين — بهويّتيهما وجهازيهما ومنفّذيهما",
        "الإجراء عكسي",
        "«سجّل عكساً للثانية» لا «احذف». فقد يكون زبونان اشتريا الشيء نفسه فعلاً — والحذف يمحو بيعاً صحيحاً بلا أثر.",
        "عمليتان متشابهتان ليستا بالضرورة خطأً.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await page.getByRole("button", { name: /1041/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-12",
      state: "conflict",
      texts: fromFrame("POS-12", "conflict", [
        "تعارض",
        "فاتورتان متطابقتان خلال دقيقة",
        "جهازان سجّلا نفس البيع. لم يُحذف أي منهما — اختر الإجراء.",
        "المستند الأول — الأصل",
        "1041",
        "10:31:22 · الكاشير 1 · سميرة ع.",
        "سكر 1 كغ ·",
        "100.00",
        "نقداً",
        "مؤكد خادمياً",
        "المستند الثاني — المشتبه به",
        "1042",
        "10:31:48 · الكاشير 2 · محمد ب.",
        "الإجراء العكسي يُنشئ",
        "مستند إلغاء مستقلاً",
        "مرتبطاً بالمستند المختار، ويُسجَّل بهوية المنفّذ وسببه في سجل التدقيق. الأصل يبقى مقروءاً للأبد.",
        "إلغاء المستند 1042 بسبب",
        "الاثنان بيعان حقيقيان",
      ]),
    });
    // السبب إلزامي للعكس — لا طلب بلا سبب
    await page.getByRole("button", { name: /إلغاء المستند/ }).click();
    await expect(page.locator('[data-screen="POS-12"]')).toContainText("يُطلب سبب");
    expect(posted).toHaveLength(0);
    await page.getByLabel("السبب").fill("تكرار من جهازين");
    await page.getByRole("button", { name: /إلغاء المستند/ }).click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({
      first_id: "s1041",
      second_id: "s1042",
      decision: "reverse",
      reason: "تكرار من جهازين",
    });
    // بعد القرار: القائمة بلا الزوج، والإجراء موثَّق باسم من قرّر
    await expect(page.locator('[data-screen="POS-12"]')).toContainText("إلغاء المستند 1042 بسبب");
    await expect(page.locator('[data-screen="POS-12"]')).toContainText("سالم");
    await expect(page.locator('[data-screen="POS-12"]')).toHaveAttribute("data-state", "ready");
  });

  test("permission_denied: الكاشير يرى الشاشة ويبلّغ فقط", async ({ page }, info) => {
    await seed(page, []);
    await page.route("**/api/sales/duplicates", (r) =>
      r.fulfill(json(200, dupBody([PAIR], false))),
    );
    await login(page, "/pos/duplicates");
    await page.getByRole("button", { name: /1041/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-12",
      state: "permission_denied",
      texts: fromFrame("POS-12", "permission_denied", [
        "المراجعة لمدير الفرع",
        "القرار «هذا تكرار» يُنشئ مستنداً عكسياً بأثر مالي.",
        "الكاشير يُبلغ",
        "زرّ «أبلغ عن اشتباه» متاح له — الملاحظة من الميدان والقرار ممن يملك أثره.",
        "الإلغاء يتطلب صلاحية مدير فرع أو مالك. الكاشير يرى الشاشة ويبلّغ فقط.",
        "المستند الأول — الأصل",
        "المستند الثاني — المشتبه به",
        "أبلغ عن اشتباه",
      ]),
    });
    await expect(page.getByRole("button", { name: /إلغاء المستند/ })).toBeDisabled();
    await page.getByRole("button", { name: "أبلغ عن اشتباه" }).click();
    await expect(page).toHaveURL(/\/pos\/invoices\/s1042$/);
  });
});
