import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T1.20 — POS-10 (6). المرتجع يبدأ من الفاتورة الأصل وكل سطر يعرض المُباع والمُرتجَع سابقاً والمتاح
 * (السقف تراكمي — ACC-11)؛ حالة البضاعة تُسأل (ACC-10) ووجهة الردّ معلنة؛ مستند مستقل لا يمحو
 * الأصل (ACC-09)؛ الردّ النقدي فوق حدّ الدور يُمنع والوجهة تغيّر الحكم (G-09)؛ بلا اتصال محفوظ
 * محلياً والنقد خرج من الصندوق فعلاً (SHIFT-02).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface Seed {
  readonly role?: "cashier" | "owner";
  /** مرتجع سابق محلي على الشاي بكمية (بالألف). */
  readonly priorTea?: string;
  readonly party?: boolean;
}

async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, priorTea, party, openedAt }) => {
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
            roleName: role === "owner" ? "مالك" : "كاشير",
            roleCode: role,
          }),
        });
        meta.put({
          key: "shift.open",
          value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
        });
        meta.put({ key: "inventory.balances_as_of", value: openedAt });
        proj.put({
          key: "entity:shifts.Shift:s1",
          value: {
            id: "s1",
            number: "OPEN-0091",
            branch_id: "b1",
            branch_name: "الفرع الرئيسي",
            device_id: "d1",
            device_name: "كاشير 2",
            user_id: "u1",
            user_name: "سميرة ع.",
            opening_float_minor: "184000",
            business_date: openedAt.slice(0, 10),
            opened_at: openedAt,
            state: "open",
            closed_at: "",
            operation_id: "op-open-1",
          },
        });
        ops.put({
          operationId: "op-open-1",
          kind: "shift_open",
          opVersion: 1,
          dependencies: [],
          members: [],
          state: "synced",
          createdLocalSeq: 1,
          snapshotRelation: "none",
        });
        proj.put({
          key: "entity:inventory.Balance:i-tea",
          value: { item_id: "i-tea", qty_milli: "6000", as_of: openedAt },
        });
        // الفاتورة 1039: شاي 4 عبوات × 120.00 + زيت 1 لتر × 300.00 = 780.00 نقداً
        proj.put({
          key: "entity:sales.Sale:sale-1039",
          value: {
            id: "sale-1039",
            invoice_number: "1039",
            shift_id: "s1",
            branch_id: "b1",
            device_id: "d1",
            user_id: "u1",
            user_name: "سميرة ع.",
            party_id: party ? "p1" : "",
            party_name: party ? "أحمد الطيب — تجريبي" : "",
            subtotal_minor: "78000",
            discount_minor: "0",
            total_minor: "78000",
            cash_minor: party ? "0" : "78000",
            bank_minor: "0",
            credit_minor: party ? "78000" : "0",
            received_minor: "",
            change_minor: "",
            lines: [
              {
                id: "ln-tea",
                item_id: "i-tea",
                item_name: "شاي أسود 250غ",
                unit_code: "عبوة",
                factor_milli: "1000",
                qty_milli: "4000",
                decimal_places: 0,
                unit_price_minor: "12000",
                line_total_minor: "48000",
                manual_price: false,
              },
              {
                id: "ln-oil",
                item_id: "i-oil",
                item_name: "زيت 1 لتر",
                unit_code: "لتر",
                factor_milli: "1000",
                qty_milli: "1000",
                decimal_places: 0,
                unit_price_minor: "30000",
                line_total_minor: "30000",
                manual_price: false,
              },
            ],
            business_date: openedAt.slice(0, 10),
            occurred_at: openedAt,
            operation_id: "op-sale-1039",
          },
        });
        ops.put({
          operationId: "op-sale-1039",
          kind: "sale",
          opVersion: 1,
          dependencies: ["op-open-1"],
          members: [],
          state: "synced",
          createdLocalSeq: 2,
          snapshotRelation: "none",
        });
        if (priorTea) {
          proj.put({
            key: "entity:sales.SaleReturn:ret-0",
            value: {
              id: "ret-0",
              return_number: "RET-KRT-A2-26-000001",
              sale_id: "sale-1039",
              invoice_number: "1039",
              shift_id: "s1",
              branch_id: "b1",
              user_name: "سميرة ع.",
              party_id: "",
              party_name: "",
              condition: "good",
              destination: "cash",
              total_minor: "12000",
              cash_minor: "12000",
              credit_minor: "0",
              lines: [
                {
                  id: "rl-0",
                  sale_line_id: "ln-tea",
                  item_id: "i-tea",
                  item_name: "شاي أسود 250غ",
                  unit_code: "عبوة",
                  qty_milli: priorTea,
                  decimal_places: 0,
                  line_total_minor: "12000",
                },
              ],
              business_date: openedAt.slice(0, 10),
              occurred_at: openedAt,
              operation_id: "op-ret-0",
            },
          });
          ops.put({
            operationId: "op-ret-0",
            kind: "sale_return",
            opVersion: 1,
            dependencies: ["op-open-1", "op-sale-1039"],
            members: [],
            state: "synced",
            createdLocalSeq: 3,
            snapshotRelation: "none",
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      role: s.role ?? "cashier",
      priorTea: s.priorTea ?? "",
      party: s.party ?? false,
      openedAt: new Date().toISOString(),
    },
  );
}

async function login(page: Page, next: string) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.route("**/api/shifts/s1", (route) => route.fulfill(json(200, { id: "s1" })));
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

function pushRoute(page: Page, seen: { kind: string; members: { entity: string }[] }[]) {
  return page.route("**/api/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string; kind: string; members: { entity: string }[] }[];
      request_id: string;
    };
    seen.push(...body.operations);
    return route.fulfill(
      json(200, {
        protocol_version: 1,
        sync_epoch: "epoch-A",
        request_id: body.request_id,
        results: body.operations.map((o) => ({
          operation_id: o.operation_id,
          status: "accepted",
          member_receipts: [],
        })),
        server_seq_high: "9",
      }),
    );
  });
}

const RETURN = "/pos/invoices/sale-1039/return";
const plus = (page: Page, item: string) => page.getByRole("button", { name: `زيادة ${item}` });

test.describe("POS-10", () => {
  test("ready → partial → success: من الفاتورة الأصل، كمية جزئية، صالحة نقداً — مستند مستقل والمخزون يعود", async ({
    page,
  }, info) => {
    // المالك بلا حدّ نقدي — 240.00 تتجاوز حدّ الكاشير (يُختبر في permission_denied)
    await seed(page, { priorTea: "1000", role: "owner" });
    const pushed: { kind: string; members: { entity: string }[] }[] = [];
    await pushRoute(page, pushed);
    await login(page, RETURN);
    await expectFrame(page, info, {
      screenId: "POS-10",
      state: "ready",
      texts: fromFrame("POS-10", "ready", [
        "مرتجع على الفاتورة 1039",
        "الأصل يبقى كما هو؛ هذا مستند مرتجع مستقل",
        "من الفاتورة الأصل",
        "المرتجع يبدأ باختيار الأصل، وكل سطر يعرض المباع والمرتَجع سابقاً والمتاح رده.",
        "السقف معروض",
        "الصنف",
        "مُباع",
        "مُرتجَع سابقاً",
        "الكمية المرتجعة الآن",
        "شاي أسود 250غ",
        "زيت 1 لتر",
        "حالة البضاعة",
        "صالحة — تعود للمخزون",
        "تالفة — إلى الحجر أو الهالك",
        "وجهة الرد",
        "نقداً من الصندوق",
        "خصماً من ذمة العميل",
        "قيمة المرتجع",
        "الكمية المرتجعة لا تتجاوز",
        "المُباع ناقص المُرتجَع سابقاً",
        "الآن 3 لا 4.",
        "تسجيل المرتجع",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    // ردّ 2 من الشاي (المتاح 3): جزئي بقيمة 240.00
    await plus(page, "شاي أسود 250غ").click();
    await plus(page, "شاي أسود 250غ").click();
    await expectFrame(page, info, {
      screenId: "POS-10",
      state: "partial",
      texts: fromFrame("POS-10", "partial", ["قيمة المرتجع", "تسجيل المرتجع"]),
    });
    const root = page.locator('[data-screen="POS-10"]');
    await expect(root).toContainText("240.00");
    await page.getByRole("button", { name: "تسجيل المرتجع" }).click();
    await expectFrame(page, info, {
      screenId: "POS-10",
      state: "success",
      texts: fromFrame("POS-10", "success", [
        "سُجّل المرتجع",
        "مستندٌ مستقل يشير إلى أصله، والأصل باقٍ كما كان",
        "وجهة الرد معلنة",
        "نقدٌ من الصندوق، أو تخفيض ذمّة، والتالف إلى الحجر — الثلاثة في شاشة النجاح لا في افتراض القارئ.",
        "نقداً من الصندوق",
        "صالحة — تعود للمخزون",
      ]),
    });
    await expect(root).toContainText("RET-KRT-A2-26-000001");
    expect(pushed.map((o) => o.kind)).toEqual(["sale_return"]);
    expect(pushed[0]!.members.map((m) => m.entity).sort()).toEqual([
      "inventory.StockMovement",
      "sales.SaleReturn",
      "sales.SaleReturnLine",
    ]);
    // المخزون المحلي عاد +2 والأصل لم يُمسّ
    const after = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const get = (k: string) =>
        new Promise<{ value: Record<string, unknown> } | undefined>((res) => {
          const r = db.transaction("projections").objectStore("projections").get(k);
          r.onsuccess = () => res(r.result as { value: Record<string, unknown> } | undefined);
        });
      const bal = await get("entity:inventory.Balance:i-tea");
      const sale = await get("entity:sales.Sale:sale-1039");
      db.close();
      return { bal: bal?.value["qty_milli"], total: sale?.value["total_minor"] };
    });
    expect(after).toEqual({ bal: "8000", total: "78000" });
  });

  test("validation_error: كمية تتجاوز المتاح — ردّ 4 والمتاح 3 (السقف تراكمي)", async ({
    page,
  }, info) => {
    await seed(page, { priorTea: "1000" });
    await login(page, RETURN);
    for (let i = 0; i < 4; i++) await plus(page, "شاي أسود 250غ").click();
    await expectFrame(page, info, {
      screenId: "POS-10",
      state: "validation_error",
      texts: fromFrame("POS-10", "validation_error", [
        "كمية تتجاوز المتاح",
        "ردّ 4 والمتاح 3.",
        "الأصل ناقص المردود",
        "السقف تراكمي عبر كل مرتجعات الفاتورة",
        "— وإلا صار المرتجع باباً لإخراج نقدٍ بلا بضاعة.",
      ]),
    });
    await expect(page.getByRole("button", { name: "تسجيل المرتجع" })).toBeDisabled();
    // الكمية تبقى عند السقف 3
    await expect(page.locator(".pos-ret__qty").first()).toHaveText("3");
  });

  test("permission_denied: ردّ نقدي فوق حدّ الكاشير — والوجهة تغيّر الحكم", async ({
    page,
  }, info) => {
    await seed(page, { party: true });
    await login(page, RETURN);
    // الزيت 300.00 > حدّ الكاشير النقدي 200.00
    await plus(page, "زيت 1 لتر").click();
    await expectFrame(page, info, {
      screenId: "POS-10",
      state: "permission_denied",
      texts: fromFrame("POS-10", "permission_denied", [
        "ردّ نقدي فوق الحدّ",
        "المرتجع يُخرج نقداً من الصندوق، وحدّه المالي حدّ الدور",
        "الوجهة تغيّر الحكم",
        "الرد إلى ذمّة الطرف تخفيضُ دينٍ يحتمل حدّاً أوسع؛ إخراج النقد أضيق. الحدّان منفصلان في",
      ]),
    });
    await expect(page.locator("body")).toContainText("الحدّان منفصلان في «الأدوار والصلاحيات».");
    await expect(page.getByRole("button", { name: "تسجيل المرتجع" })).toBeDisabled();
    await page.getByLabel("خصماً من ذمة العميل").check();
    await expect(page.locator('[data-screen="POS-10"]')).toHaveAttribute("data-state", "partial");
    await expect(page.getByRole("button", { name: "تسجيل المرتجع" })).toBeEnabled();
  });

  test("saved_local: مرتجع تالف بلا اتصال — محفوظ محلياً، إلى الحجر لا المخزون، والصندوق لا ينتظر", async ({
    page,
    context,
  }, info) => {
    await seed(page);
    await login(page, RETURN);
    await plus(page, "شاي أسود 250غ").click();
    await page.getByLabel("تالفة — إلى الحجر أو الهالك").check();
    await context.setOffline(true);
    await page.getByRole("button", { name: "تسجيل المرتجع" }).click();
    await expectFrame(page, info, {
      screenId: "POS-10",
      state: "saved_local",
      texts: fromFrame("POS-10", "saved_local", [
        "مرتجع بلا اتصال",
        "محفوظ محلياً، والنقد خرج من الصندوق فعلاً.",
        "الصندوق لا ينتظر",
        "حركة الصندوق تُقيَّد لحظتها محلياً",
        "— العدّ في الإغلاق يطابق الواقع لا المزامنة.",
        "تالفة — إلى الحجر أو الهالك",
        "نقداً من الصندوق",
      ]),
    });
    await context.setOffline(false);
    const stored = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const ops = await new Promise<{ kind: string; members: { entity: string }[] }[]>((res) => {
        const r = db.transaction("operations").objectStore("operations").getAll();
        r.onsuccess = () => res(r.result as { kind: string; members: { entity: string }[] }[]);
      });
      const bal = await new Promise<{ value: { qty_milli: string } } | undefined>((res) => {
        const r = db
          .transaction("projections")
          .objectStore("projections")
          .get("entity:inventory.Balance:i-tea");
        r.onsuccess = () => res(r.result as { value: { qty_milli: string } } | undefined);
      });
      db.close();
      return { ret: ops.find((o) => o.kind === "sale_return"), bal: bal?.value.qty_milli };
    });
    expect(stored.ret!.members.map((m) => m.entity).sort()).toEqual([
      "inventory.QuarantineMovement",
      "sales.SaleReturn",
      "sales.SaleReturnLine",
    ]);
    // التالف لا يزيد المخزون الصالح
    expect(stored.bal).toBe("6000");
    // SHIFT-02 يرى المرتجع النقدي خارجاً من الصندوق (تنقّل داخل التطبيق — الجلسة في الذاكرة)
    await navTo(page, "الوردية والصندوق");
    await expect(page).toHaveURL(/\/shifts\/current$/);
    await expect(page.locator('[data-screen="SHIFT-02"]')).toContainText("مرتجع نقدي");
    await expect(page.locator('[data-screen="SHIFT-02"]')).toContainText("RET-KRT-A2-26-000001");
  });
});
