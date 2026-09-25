import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.24 — PTY-05 (7). الكشف المتتابع يبدأ بسطر «رصيد افتتاحي»؛ البيع الآجل من POS-07 يظهر بوسم
 * «معلّق — هذا الجهاز» وهو داخل الرصيد (ACC-02/03)؛ التركيب معلَن؛ فواتير فرع آخر تدخل الرصيد
 * المؤسسي دون تفاصيلها (ACC-46)؛ «لا يوجد سداد مسجل» حرفاً ولا أعمار ديون (G-15).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const at = (daysAgo: number, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const PARTY = {
  id: "p1",
  name: "أحمد الطيب — تجريبي",
  name_normalized: "احمد الطيب — تجريبي",
  phone: "0912555447",
  aliases: [],
  credit_limit_minor: "50000",
  is_customer: true,
  is_supplier: false,
  distinct_from_id: "",
  balance_minor: "12000",
  balance_as_of: at(0, 10, 30),
  last_sale_at: at(8),
  is_active: true,
  deactivated_at: "",
  updated_at: "2025-01-15T10:00:00.000Z",
};

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

/** سطور الإطار: افتتاحي 200 → سداد 200 → آجل 420 → سداد 300 → نقدي بلا أثر (فرع بحري) = 120 */
const ROWS = [
  row("OPEN-004", "opening", "رصيد افتتاحي", "2025-01-01T10:00:00.000Z", "20000", "", "20000", ""),
  row("PAY-0219", "payment", "سداد نقدي", at(34), "", "20000", "0"),
  row("INV-1021", "sale", "بيع آجل", at(20), "42000", "", "42000"),
  row("PAY-0240", "payment", "سداد نقدي", at(12), "", "30000", "12000"),
  row("INV-1039", "sale", "بيع نقدي — لا أثر آجل", at(8), "", "", "12000", "b2"),
];

const statement = (extra: Record<string, unknown> = {}) => ({
  party: { ...PARTY, note: "", last_movement_at: at(8), supplier_owed_minor: "0" },
  rows: ROWS,
  balance_minor: "12000",
  hidden_other_branch: 0,
  last_payment_at: at(12),
  oldest_unpaid_at: at(20),
  as_of: at(0, 10, 30),
  scope: "all",
  branch_names: { b1: "الرئيسي", b2: "فرع بحري" },
  range: "30",
  ...extra,
});

async function seed(page: Page, opts: { pending?: boolean; cache?: unknown } = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ pending, cache, party, now }) => {
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
            branchName: "الرئيسي",
            branchCode: "KRT",
            deviceId: "d1",
            deviceName: "كاشير 2",
            devicePrefix: "A2",
            userId: "u1",
            userName: "سالم",
            roleName: "مالك",
            roleCode: "owner",
          }),
        });
        if (cache) meta.put({ key: "parties.statement.p1", value: JSON.stringify(cache) });
        else meta.delete("parties.statement.p1");
        proj.put({ key: "entity:parties.Party:p1", value: party });
        if (pending) {
          proj.put({
            key: "entity:sales.Sale:sale-1043",
            value: {
              id: "sale-1043",
              invoice_number: "1043",
              shift_id: "s1",
              branch_id: "b1",
              device_id: "d1",
              user_id: "u1",
              user_name: "سميرة ع.",
              party_id: "p1",
              party_name: "أحمد الطيب — تجريبي",
              subtotal_minor: "10000",
              discount_minor: "0",
              total_minor: "10000",
              cash_minor: "4000",
              bank_minor: "0",
              credit_minor: "6000",
              received_minor: "",
              change_minor: "",
              lines: [],
              business_date: now.slice(0, 10),
              occurred_at: now,
              operation_id: "op-sale-1043",
            },
          });
          ops.put({
            operationId: "op-sale-1043",
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [],
            state: "pending",
            createdLocalSeq: 2,
            snapshotRelation: "none",
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { pending: opts.pending ?? false, cache: opts.cache ?? null, party: PARTY, now: at(0, 10, 34) },
  );
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

function statementRoute(
  page: Page,
  body: unknown,
  opts: { delayMs?: number; status?: number } = {},
) {
  return page.route("**/api/parties/p1/statement**", async (route) => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    return route.fulfill(json(opts.status ?? 200, body));
  });
}

const HEAD = [
  "كشف حساب —",
  "أحمد الطيب — تجريبي",
  "0912 ••• 447",
  "· عميل منذ يناير 2025",
  "الرصيد الحالي — عليه",
  "آخر تحديث خادمي",
  "آخر 30 يوماً",
  "كل الحركات",
  "طباعة وتصدير",
  "تسجيل سداد",
  "التاريخ والمستند",
  "البيان",
  "عليه",
  "له",
  "الرصيد",
  "الفرع",
];

test.describe("PTY-05", () => {
  test("pending_sync: البيع الآجل من POS-07 بوسم «معلّق — هذا الجهاز» وهو داخل الرصيد — 120 + 60 = 180", async ({
    page,
  }, info) => {
    await seed(page, { pending: true });
    await statementRoute(page, statement());
    await login(page, "/parties/p1/statement");
    await expectFrame(page, info, {
      screenId: "PTY-05",
      state: "pending_sync",
      texts: fromFrame("PTY-05", "pending_sync", [
        ...HEAD,
        "180.00",
        "+ معلّق هذا الجهاز",
        "معلّق المزامنة",
        "حركة واحدة معلقة من هذا الجهاز داخلة في الرصيد",
        "رصيد افتتاحي",
        "01 يناير 2025",
        "الرئيسي",
        "سداد نقدي",
        "بيع آجل",
        "بيع نقدي — لا أثر آجل",
        "فرع بحري",
        "اليوم 10:34",
        "بيع مختلط — الجزء الآجل",
        "مؤكد",
        "معلّق — هذا الجهاز",
        "يشمل فاتورة",
        "1043",
        "المعلّقة من هذا الجهاز. إن سجّل جهاز آخر سداداً لم يصلنا بعد فالرقم سيتغير عند المزامنة. الفواتير المنشأة في فرع آخر تدخل الرصيد المؤسسي دون أن تُعرض تفاصيلها هنا.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="PTY-05"]');
    // التركيب معلَن (ACC-03): خادمي 120 + معلّق 60 = 180، والرصيد الجاري للمعلّق 180
    await expect(root).toContainText("خادمي 120.00 + معلّق 60.00 = 180.00");
    await expect(root.locator("tbody tr").last()).toContainText("180.00");
    // آخر سداد و«منذ» تاريخاً فقط — لا أعمار
    await expect(root).toContainText("آخر سداد");
    await expect(root).toContainText("منذ 12 يوماً");
    await expect(root).toContainText("أقدم حركة غير مسدَّدة");
    await expect(root).not.toContainText("عمر الدين");
  });

  test("loading → ready: جارٍ الحساب — لا رصيد جزئي، ثم الكشف كاملاً", async ({ page }, info) => {
    await seed(page);
    await statementRoute(page, statement(), { delayMs: 4000 });
    await login(page, "/parties/p1/statement");
    await expectFrame(page, info, {
      screenId: "PTY-05",
      state: "loading",
      texts: fromFrame("PTY-05", "loading", [
        "جارٍ الحساب",
        "الكشف يُحسب من كل الحركات ولا يُقرأ جاهزاً. مع عدد الحركات في المدى.",
        "لا رصيد جزئي",
        "الرصيد الجاري لا يُعرض قبل اكتمال السلسلة — رقمٌ وسيط في كشف حساب يُقرأ ويُصدَّق.",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "PTY-05",
      state: "ready",
      texts: fromFrame("PTY-05", "ready", [
        ...HEAD,
        "رصيد افتتاحي",
        "سداد نقدي",
        "بيع آجل",
        "مؤكد",
        "لا جدول أعمار ديون",
      ]),
    });
    const root = page.locator('[data-screen="PTY-05"]');
    await expect(root).toContainText("120.00");
    await expect(root).toContainText("420.00");
    await expect(root).not.toContainText("+ معلّق هذا الجهاز");
  });

  test("empty: طرفٌ بلا حركات — الفراغ بداية لا نقص، و«لا يوجد سداد مسجل» حرفاً", async ({
    page,
  }, info) => {
    await seed(page);
    await statementRoute(
      page,
      statement({
        rows: [],
        balance_minor: "0",
        last_payment_at: "",
        oldest_unpaid_at: "",
        party: { ...PARTY, balance_minor: "0" },
      }),
    );
    await login(page, "/parties/p1/statement");
    await expectFrame(page, info, {
      screenId: "PTY-05",
      state: "empty",
      texts: fromFrame("PTY-05", "empty", [
        "طرفٌ بلا حركات",
        "أُنشئ ولم يُبع له ولا سُدّد منه.",
        "المسار",
        "«سجّل رصيداً افتتاحياً» أو «ابدأ بيعاً آجلاً». والفراغ هنا بدايةٌ لا نقص.",
      ]),
    });
    await expect(page.locator('[data-screen="PTY-05"]')).toContainText("لا يوجد سداد مسجل");
  });

  test("stale: كشفٌ من آخر مطابقة — لا يُطبع بلا وسم", async ({ page }, info) => {
    await seed(page, { cache: statement({ as_of: at(0, 15, 40) }) });
    await statementRoute(page, { detail: "server_error" }, { status: 500 });
    await login(page, "/parties/p1/statement");
    await expectFrame(page, info, {
      screenId: "PTY-05",
      state: "stale",
      texts: fromFrame("PTY-05", "stale", [
        "كشفٌ من آخر مطابقة",
        "قبل ساعتين، وقد سدّد الطرف في فرع آخر.",
        "لا يُطبع بلا وسم",
        "الطباعة تحمل «محدَّث 3:40 م» في الترويسة. ورقةٌ بلا وقت تُقرأ لحظيةً بعد أسبوع.",
        "رصيد افتتاحي",
      ]),
    });
    await expect(page.locator('[data-screen="PTY-05"]')).toContainText("15:40");
  });

  test("offline: كشف محلي — من بيانات الجهاز ومعه ما لم يُرفع موسوماً", async ({
    page,
    context,
  }, info) => {
    await seed(page, { pending: true, cache: statement() });
    await statementRoute(page, statement());
    await login(page, "/parties/p1/statement");
    await expect(page.locator('[data-screen="PTY-05"][data-state="pending_sync"]')).toBeVisible();
    await context.setOffline(true);
    await expectFrame(page, info, {
      screenId: "PTY-05",
      state: "offline",
      texts: fromFrame("PTY-05", "offline", [
        "كشف محلي",
        "من بيانات الجهاز، ومعه ما لم يُرفع موسوماً سطراً سطراً.",
        "التركيب معلَن",
        "«خادمي 340 + معلّق 100 = 440»",
        "المجموع وحده يُوهم بتأكيدٍ لم يحصل.",
        "معلّق — هذا الجهاز",
      ]),
    });
    await expect(page.locator('[data-screen="PTY-05"]')).toContainText("180.00");
    await context.setOffline(false);
  });

  test("permission_denied: كشف فرعٍ آخر — الرصيد نعم والتفصيل لا (ACC-46)", async ({
    page,
  }, info) => {
    await seed(page);
    await statementRoute(
      page,
      statement({
        rows: [ROWS[0]!],
        hidden_other_branch: 4,
        scope: "branch",
      }),
    );
    await login(page, "/parties/p1/statement");
    await expectFrame(page, info, {
      screenId: "PTY-05",
      state: "permission_denied",
      texts: fromFrame("PTY-05", "permission_denied", [
        "كشف فرعٍ آخر",
        "جهاز فرع يحسب رصيداً مؤسسياً نشأ بعضه في فرع آخر.",
        "الرصيد نعم والتفصيل لا",
        "يُعرض الرصيد المؤسسي كاملاً (وهو حقيقة الطرف)، ولا تُكشف فواتير الفرع الآخر",
        "رصيد افتتاحي",
      ]),
    });
    const root = page.locator('[data-screen="PTY-05"]');
    await expect(root).toContainText("120.00");
    await expect(root).not.toContainText("INV-1021");
  });
});
