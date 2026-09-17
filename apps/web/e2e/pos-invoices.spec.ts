import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.19 — POS-09 (7) + POS-12 (4). القائمة: المحلي فوراً وفواتير الأجهزة الأخرى تلحق موسومة؛
 * عمود وضع المزامنة لكل فاتورة؛ التاريخ المشكوك فيه معلَّم والأصل لم يُعدَّل (ACC-77)؛ الكاشير
 * يرى نطاقه والمجاميع تقارير. التكرار: المستندان جنباً إلى جنب (ACC-16)، الإجراء عكسي مستند
 * مستقل لا حذف، والقرار لمدير الفرع والكاشير يُبلغ.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const today = (h: number, m: number, s = 0) => {
  const d = new Date();
  d.setHours(h, m, s, 0);
  return d.toISOString();
};

interface LocalSeed {
  readonly id: string;
  readonly number: string;
  readonly opState: "local" | "pending" | "synced";
  readonly occurredAt: string;
  readonly party?: string;
  readonly cash?: string;
  readonly credit?: string;
}

async function seed(page: Page, sales: readonly LocalSeed[], cache?: unknown) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ sales, cache, openedAt }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections", "operations"], "readwrite");
        const meta = tx.objectStore("meta");
        const proj = tx.objectStore("projections");
        const ops = tx.objectStore("operations");
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
            deviceName: "كاشير 2",
            devicePrefix: "A2",
            userId: "u1",
            userName: "سميرة ع.",
            roleName: "كاشير",
          }),
        });
        if (cache) meta.put({ key: "sales.list_cache", value: JSON.stringify(cache) });
        else meta.delete("sales.list_cache");
        let seq = 2;
        for (const s of sales) {
          proj.put({
            key: `entity:sales.Sale:${s.id}`,
            value: {
              id: s.id,
              invoice_number: s.number,
              shift_id: "s1",
              branch_id: "b1",
              device_id: "d1",
              user_id: "u1",
              user_name: "سميرة ع.",
              party_id: s.party ? "p1" : "",
              party_name: s.party ?? "",
              subtotal_minor: "10000",
              discount_minor: "0",
              total_minor: "10000",
              cash_minor: s.cash ?? "10000",
              bank_minor: "0",
              credit_minor: s.credit ?? "0",
              received_minor: "",
              change_minor: "",
              lines: [
                {
                  id: `${s.id}-l1`,
                  item_id: "i1",
                  item_name: "سكر",
                  unit_code: "كغ",
                  qty_milli: "1000",
                  decimal_places: 3,
                  unit_price_minor: "10000",
                  line_total_minor: "10000",
                  manual_price: false,
                },
              ],
              business_date: openedAt.slice(0, 10),
              occurred_at: s.occurredAt,
              operation_id: `op-${s.id}`,
            },
          });
          ops.put({
            operationId: `op-${s.id}`,
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [],
            state: s.opState,
            createdLocalSeq: seq++,
            snapshotRelation: "none",
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { sales, cache: cache ?? null, openedAt: new Date().toISOString() },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

/** صف خادمي كما يعيده `GET /api/sales` — فواتير الأجهزة الأخرى. */
const serverRow = (
  id: string,
  number: string,
  at: string,
  party: string,
  total: string,
  cash: string,
  credit: string,
  extra: Partial<{ date_suspect: boolean; sync_state: "synced" | "reversed" }> = {},
) => ({
  id,
  invoice_number: number,
  branch_id: "b1",
  device_id: "d2",
  device_name: "الكاشير 1",
  user_name: "محمد ب.",
  party_id: party === "نقدي" ? "" : "p2",
  party_name: party === "نقدي" ? "" : party,
  total_minor: total,
  cash_minor: cash,
  credit_minor: credit,
  bank_minor: "0",
  business_date: new Date().toISOString().slice(0, 10),
  occurred_at: at,
  received_at: at,
  date_suspect: false,
  sync_state: "synced",
  ...extra,
});

const listBody = (
  rows: unknown[],
  extra: Partial<{
    scope: string;
    can_all_branches: boolean;
    can_totals: boolean;
    last_sale_at: string;
  }> = {},
) => ({
  scope: "branch",
  can_all_branches: true,
  can_totals: true,
  can_decide: true,
  role_name: "مالك",
  branch_name: "الفرع الرئيسي",
  as_of: new Date().toISOString(),
  range: "today",
  rows,
  totals: { count: rows.length, total_minor: "0" },
  last_sale_at: "",
  ...extra,
});

const FRAME_ROWS = [
  serverRow("s1040", "1040", today(9, 58), "فاطمة ح. — تجريبي", "64000", "0", "64000"),
  serverRow("s1039", "1039", today(9, 12), "أحمد الطيب — تجريبي", "174000", "174000", "0"),
  serverRow("s1038", "1038", today(3, 7), "نقدي", "31800", "31800", "0", { date_suspect: true }),
];

function listRoute(page: Page, body: unknown, opts: { delayMs?: number; status?: number } = {}) {
  return page.route("**/api/sales?**", async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    return route.fulfill(json(opts.status ?? 200, body));
  });
}

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
        "مجموع مبيعات الفرع بابه REP-01 بصلاحيته. قائمة المراجعة اللحظية غير تقرير الأداء.",
      ]),
    });
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
        "نفس الصنف والكمية والدقائق من جهازين — بهويّتيهما وجهازيهما ومنفّذيهما (ACC-16).",
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
