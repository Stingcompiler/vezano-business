import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T1.17 — POS-06 (5) + POS-07 (7). الآجل بالرصيد المركّب «خادمي X + معلّق هذا الجهاز Y = Z» (ACC-02)
 * وحدّ ائتمان أداةَ انتباه لا قفلاً (تجاوز بسبب = حدث)؛ المختلط بثلاث وجهات معلنة: نقد → الصندوق،
 * آجل → الذمّة، تحويل → «مسجَّل — غير مطابق» (ACC-08، 13، 14)؛ الأجزاء قيد واحد ذرّي والفارق يُعرض
 * ولا يُوزَّع (ACC-24). السيناريو الموحَّد ١٠٠ = ٤٠ + ٦٠ يظهر في SHIFT-02 من الحفظ نفسه.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface Seed {
  readonly customer?: boolean;
  readonly balance?: string;
  readonly limit?: string;
  readonly pendingSales?: number;
  readonly qty?: string;
  readonly stock?: string;
}

async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ customer, balance, limit, pendingSales, qty, stock, openedAt }) => {
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
        meta.put({ key: "inventory.balances_as_of", value: openedAt });
        meta.put({
          key: "pos.cart",
          value: JSON.stringify({
            lines: [
              {
                id: "l1",
                item_id: "i2",
                item_name: "شاي أسود 250غ",
                unit_id: "u-pack",
                unit_code: "عبوة",
                unit_name: "عبوة",
                factor_milli: "1000",
                decimal_places: 0,
                qty_milli: qty,
                unit_price_minor: "10000",
              },
            ],
            ...(customer ? { customer: { id: "p1", name: "أحمد الطيب — تجريبي" } } : {}),
            updated_at: openedAt,
          }),
        });
        meta.put({
          key: "shift.open",
          value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
        });
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
            business_date: "2026-09-16",
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
          members: [
            {
              entity: "shifts.ShiftOpened",
              id: "s1",
              schemaVersion: 1,
              payload: { shift_id: "s1", opening_float_minor: "184000" },
              serverSeq: null,
            },
          ],
          state: "synced",
          createdLocalSeq: 1,
          snapshotRelation: "none",
        });
        proj.put({
          key: "entity:parties.Party:p1",
          value: {
            id: "p1",
            name: "أحمد الطيب — تجريبي",
            name_normalized: "احمد الطيب — تجريبي",
            phone: "0912555447",
            credit_limit_minor: limit,
            is_customer: true,
            is_supplier: false,
            distinct_from_id: "",
            balance_minor: balance,
            last_sale_at: "",
            is_active: true,
            deactivated_at: "",
            updated_at: openedAt,
          },
        });
        proj.put({
          key: "entity:inventory.Balance:i2",
          value: { item_id: "i2", qty_milli: stock, as_of: openedAt },
        });
        // مبيعات آجلة سابقة على هذا الجهاز لم يؤكّدها الخادم — «معلّق هذا الجهاز»
        for (let i = 0; i < pendingSales; i++) {
          proj.put({
            key: `entity:sales.Sale:prev-${i}`,
            value: {
              id: `prev-${i}`,
              invoice_number: `INV-KRT-A2-26-00000${i + 1}`,
              shift_id: "s1",
              branch_id: "b1",
              device_id: "d1",
              user_id: "u1",
              user_name: "سميرة ع.",
              party_id: "p1",
              party_name: "أحمد الطيب — تجريبي",
              subtotal_minor: "5000",
              discount_minor: "0",
              total_minor: "5000",
              cash_minor: "0",
              bank_minor: "0",
              credit_minor: "5000",
              received_minor: "",
              change_minor: "",
              lines: [],
              business_date: "2026-09-16",
              occurred_at: openedAt,
              operation_id: `op-prev-${i}`,
            },
          });
          ops.put({
            operationId: `op-prev-${i}`,
            kind: "sale",
            opVersion: 1,
            dependencies: ["op-open-1"],
            members: [],
            state: "pending",
            createdLocalSeq: 2 + i,
            snapshotRelation: "none",
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      customer: s.customer ?? true,
      balance: s.balance ?? "12000",
      limit: s.limit ?? "50000",
      pendingSales: s.pendingSales ?? 0,
      qty: s.qty ?? "1000",
      stock: s.stock ?? "6000",
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
  await page.route("**/api/catalog/balances**", (route) =>
    route.fulfill(json(200, { branch_id: "b1", as_of: new Date().toISOString(), balances: [] })),
  );
  await page.route("**/api/shifts/s1", (route) => route.fulfill(json(200, { id: "s1" })));
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, (c) => `\\${c}`)}$`));
}

function pushRoute(
  page: Page,
  seen: { kind: string }[],
  opts: { delayMs?: number; status?: number } = {},
) {
  return page.route("**/api/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string; kind: string }[];
      request_id: string;
    };
    seen.push(...body.operations);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.status && opts.status >= 500)
      return route.fulfill(json(opts.status, { detail: "server_error" }));
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

async function readOps(page: Page) {
  return page.evaluate(async () => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    const rows = await new Promise<
      {
        kind: string;
        state: string;
        members: { entity: string; payload: Record<string, unknown> }[];
      }[]
    >((res) => {
      const r = db.transaction("operations").objectStore("operations").getAll();
      r.onsuccess = () =>
        res(
          r.result as {
            kind: string;
            state: string;
            members: { entity: string; payload: Record<string, unknown> }[];
          }[],
        );
    });
    db.close();
    return rows;
  });
}

test.describe("POS-06", () => {
  test("ready → saved_local: الرصيد قبل الالتزام مركّباً، ثم الالتزام يدخل «معلّق هذا الجهاز» فوراً", async ({
    page,
  }, info) => {
    await seed(page);
    const pushed: { kind: string }[] = [];
    await pushRoute(page, pushed);
    await login(page, "/pos/pay/credit");
    await expectFrame(page, info, {
      screenId: "POS-06",
      state: "ready",
      texts: fromFrame("POS-06", "ready", [
        "الدفع الآجل",
        "آجل على أحمد الطيب — تجريبي",
        "عليه قبل هذا البيع",
        "يضاف الآن",
        "عليه بعد الحفظ",
        "الرصيد مركّب",
        "خادمي",
        "معلّق",
        "الرصيد حتى تغطية الخادم",
        "قد يختلف إن سجّل جهاز آخر سداداً لم يصلنا بعد.",
        "حد ائتمان مرن",
        "— اختياري",
        "متبقٍ",
        "لو تجاوز البيع الحد",
        "يظهر تنبيه بالمبلغ الزائد ويُطلب سبب، ثم",
        "يُكمَل البيع",
        "حفظ البيع الآجل",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="POS-06"]');
    // خادمي 120 + معلّق 0 = 120، يضاف 100، بعد الحفظ 220؛ الحدّ 500 ومتبقٍ 380
    for (const n of ["120.00", "100.00", "220.00", "500.00", "380.00"])
      await expect(root).toContainText(n);
    await page.getByRole("button", { name: "حفظ البيع الآجل" }).click();
    await expectFrame(page, info, {
      screenId: "POS-06",
      state: "saved_local",
      texts: fromFrame("POS-06", "saved_local", [
        "آجل بلا اتصال",
        "الدين تكوَّن محلياً ولم يره الخادم.",
        "المعلّق يظهر فوراً",
        "الفاتورة تدخل «معلّق هذا الجهاز» في رصيده المركّب من اللحظة — فبيعٌ آجل ثانٍ له يراها",
      ]),
    });
    const ops = await readOps(page);
    const sale = ops.find((o) => o.kind === "sale")!;
    const pay = sale.members.find((m) => m.entity === "sales.Payment")!;
    expect(pay.payload).toMatchObject({ method: "credit", amount_minor: "10000" });
    expect(sale.members.find((m) => m.entity === "sales.Sale")!.payload["party_id"]).toBe("p1");
    expect(pushed.map((o) => o.kind)).toEqual(["sale"]);
    expect(ops.some((o) => o.kind === "credit_override")).toBe(false);
  });

  test("validation_error: تجاوز حدّ الائتمان — تنبيه بالمبلغ الزائد وسبب، ثم يُكمَل البيع بحدث تجاوز", async ({
    page,
  }, info) => {
    await seed(page, { limit: "15000" });
    const pushed: { kind: string }[] = [];
    await pushRoute(page, pushed);
    await login(page, "/pos/pay/credit");
    await page.getByRole("button", { name: "حفظ البيع الآجل" }).click();
    await expectFrame(page, info, {
      screenId: "POS-06",
      state: "validation_error",
      texts: fromFrame("POS-06", "validation_error", [
        "تجاوز حدّ الائتمان",
        "الرصيد بعد البيع يتجاوز حدّ الطرف.",
        "حدّه",
        "— هذا البيع يرفعه إلى",
        "تحويل الفارق نقداً في دفع مختلط",
      ]),
    });
    await expect(page.locator('[data-screen="POS-06"]')).toContainText("150.00");
    await page.getByLabel("السبب").fill("زبون معروف — يسدّد الجمعة");
    await page.getByRole("button", { name: "حفظ البيع الآجل" }).click();
    await expect(page.locator('[data-screen="POS-06"][data-state="saved_local"]')).toBeVisible();
    await expect
      .poll(async () => (await readOps(page)).filter((o) => o.kind === "credit_override").length)
      .toBe(1);
    const ov = (await readOps(page)).find((o) => o.kind === "credit_override")!;
    expect(ov.members[0]!.payload).toMatchObject({
      party_id: "p1",
      credit_limit_minor: "15000",
      balance_after_minor: "22000",
      reason: "زبون معروف — يسدّد الجمعة",
    });
  });

  test("permission_denied: رصيد مخوَّل وقت البيع — الكاشير لا يفتح الكشف الكامل", async ({
    page,
  }, info) => {
    await seed(page);
    await login(page, "/pos/pay/credit");
    await page.getByRole("button", { name: "كشف حساب" }).click();
    await expectFrame(page, info, {
      screenId: "POS-06",
      state: "permission_denied",
      texts: fromFrame("POS-06", "permission_denied", [
        "رصيد مخوَّل وقت البيع",
        "الكاشير يرى رصيد من أمامه ليقرّر البيع، ولا يفتح كشفه الكامل.",
        "والفواتير التفصيلية بابها",
        "بصلاحيته.",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "والفواتير التفصيلية بابها «كشف الحساب» بصلاحيته.",
    );
    await expect(page).toHaveURL(/\/pos\/pay\/credit$/);
  });

  test("stale: الرصيد يشمل عمليتين معلقتين من هذا الجهاز — قد يختلف إن سجّل جهاز آخر سداداً", async ({
    page,
  }, info) => {
    await seed(page, { pendingSales: 2 });
    await login(page, "/pos/pay/credit");
    await expectFrame(page, info, {
      screenId: "POS-06",
      state: "stale",
      texts: fromFrame("POS-06", "stale", [
        "الرصيد حتى تغطية الخادم",
        "ويشمل عمليتين معلقتين من هذا الجهاز",
        "قد يختلف إن سجّل جهاز آخر سداداً لم يصلنا بعد.",
        "عليه قبل هذا البيع",
      ]),
    });
    // خادمي 120 + معلّق 100 = 220، وبعد البيع 320
    const root = page.locator('[data-screen="POS-06"]');
    for (const n of ["220.00", "320.00"]) await expect(root).toContainText(n);
  });

  test("بلا عميل: عميل مسمّى — شرط الأثر الآجل", async ({ page }) => {
    await seed(page, { customer: false });
    await login(page, "/pos/pay/credit");
    await expect(page.locator('[data-screen="POS-06"]')).toContainText(
      "عميل مسمّى — شرط الأثر الآجل",
    );
    await expect(page.getByRole("button", { name: "حفظ البيع الآجل" })).toHaveCount(0);
  });
});

test.describe("POS-07", () => {
  test("ready → success: ١٠٠ = ٤٠ نقداً + ٦٠ آجلاً — ثلاث وجهات معلنة، والصندوق يرى الـ40 فوراً", async ({
    page,
  }, info) => {
    await seed(page);
    const pushed: { kind: string }[] = [];
    await pushRoute(page, pushed);
    await login(page, "/pos/pay/mixed");
    await page.getByLabel("نقداً").fill("40.00");
    await page.getByLabel("آجل").fill("60.00");
    await expectFrame(page, info, {
      screenId: "POS-07",
      state: "ready",
      texts: fromFrame("POS-07", "ready", [
        "الدفع المختلط والتحويل",
        "الإجمالي",
        "ج.س",
        "نقداً",
        "آجل",
        "تحويل بنكي",
        "مطابق",
        "40.00 + 60.00 + 0.00 = 100.00",
        "الآجل على",
        "أحمد الطيب — تجريبي",
        "النقد وحده يدخل الصندوق. الجزء الآجل يدخل ذمة العميل، والتحويل البنكي يُسجَّل بلا مطابقة تلقائية.",
        "حفظ البيع — 100.00 ج.س",
        "يدخل صندوق الوردية المفتوحة",
      ]),
    });
    await expect(page.locator(".cat-saving__note")).toContainText("120.00 → 180.00");
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-07",
      state: "success",
      texts: fromFrame("POS-07", "success", [
        "ثلاث وجهات معلنة",
        "لا «تم استلام 100»",
        "المئة لم تُستلم — استُلم 40 والتُزم بـ60. لفظ الاستلام على الآجل يطمس الفرق الذي بُني عليه الكشف كله.",
        "إلى الصندوق — نقد فقط",
        "إلى ذمّة",
        "رصيد الطرف بعد الحفظ",
        "أثر العملية في ثلاث شاشات:",
        "نقد الوردية +",
        "بوضع مزامنتها",
      ]),
    });
    const root = page.locator('[data-screen="POS-07"]');
    for (const n of ["40.00", "60.00", "180.00", "INV-KRT-A2-26-000001"])
      await expect(root).toContainText(n);
    const sale = (await readOps(page)).find((o) => o.kind === "sale")!;
    expect(
      sale.members
        .filter((m) => m.entity === "sales.Payment")
        .map((m) => [m.payload["method"], m.payload["amount_minor"]])
        .sort(),
    ).toEqual([
      ["cash", "4000"],
      ["credit", "6000"],
    ]);
    expect(pushed.map((o) => o.kind)).toEqual(["sale"]);
    // SHIFT-02 من الجهاز نفسه: +40.00 داخل الصندوق و60.00 خارجه، والمتوقَّع 1,840 + 40 (ACC-08)
    await navTo(page, "الوردية والصندوق");
    await expect(page).toHaveURL(/\/shifts\/current$/);
    const shift = page.locator('[data-screen="SHIFT-02"]');
    await expect(shift).toContainText("INV-KRT-A2-26-000001");
    await expect(shift.locator(".shift-expected__v")).toContainText("1,880.00");
    await expect(shift).toContainText("بيع نقدي");
  });

  test("validation_error: الأجزاء لا تساوي الإجمالي — الفارق يُعرض ولا يُوزَّع والحفظ معطّل", async ({
    page,
  }, info) => {
    await seed(page);
    await login(page, "/pos/pay/mixed");
    await page.getByLabel("نقداً").fill("30");
    await page.getByLabel("آجل").fill("30");
    await page.getByLabel("تحويل بنكي").fill("30");
    await expectFrame(page, info, {
      screenId: "POS-07",
      state: "validation_error",
      texts: fromFrame("POS-07", "validation_error", [
        "الأجزاء لا تساوي الإجمالي",
        "الفارق يُعرض ولا يُوزَّع",
        "· ناقص",
        "الحفظ معطّل حتى يساوي مجموع التسوية الإجمالي",
      ]),
    });
    await expect(page.locator(".pos-mixed__sum")).toContainText("30.00 + 30.00 + 30.00 = 90.00");
    await expect(page.locator(".pos-mixed__diff")).toContainText("10.00");
    await expect(page.getByRole("button", { name: /حفظ البيع/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("تحويل بنكي بمرجع: مسجَّل — غير مطابق حتى يُرى في كشف البنك (ACC-14)", async ({ page }) => {
    await seed(page);
    await pushRoute(page, []);
    await login(page, "/pos/pay/mixed");
    await page.getByLabel("تحويل بنكي").fill("100");
    await expect(page.getByRole("button", { name: /حفظ البيع/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByLabel("مرجع").fill("TRF-88214");
    await expect(page.locator('[data-screen="POS-07"]')).toContainText(
      "إيصال التحويل لا يعني وصول المبلغ. يبقى «مسجَّل — غير مطابق» حتى تؤكده في كشف البنك، ولا يُسقط ذمة العميل قبل ذلك.",
    );
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expect(page.locator('[data-screen="POS-07"][data-state="success"]')).toBeVisible();
    await expect(page.locator('[data-screen="POS-07"]')).toContainText("مسجَّل — غير مطابق");
    const sale = (await readOps(page)).find((o) => o.kind === "sale")!;
    expect(sale.members.find((m) => m.entity === "sales.Payment")!.payload).toMatchObject({
      method: "bank",
      amount_minor: "10000",
      reference: "TRF-88214",
    });
  });

  test("saving: قيد واحد ذرّي — الأجزاء الثلاثة تُحفظ معاً أو لا تُحفظ", async ({ page }, info) => {
    await seed(page);
    await pushRoute(page, [], { delayMs: 8000 });
    await login(page, "/pos/pay/mixed");
    await page.getByLabel("نقداً").fill("40");
    await page.getByLabel("آجل").fill("60");
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expect(page.getByRole("button", { name: /حفظ البيع/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expectFrame(page, info, {
      screenId: "POS-07",
      state: "saving",
      texts: fromFrame("POS-07", "saving", [
        "قيد واحد ذرّي",
        "الأجزاء الثلاثة تُحفظ معاً أو لا تُحفظ.",
      ]),
    });
  });

  test("saved_local: مختلط بلا اتصال — النقد في الدرج فعلاً والدين في المعلّق", async ({
    page,
    context,
  }, info) => {
    await seed(page);
    await login(page, "/pos/pay/mixed");
    await expect(page.locator('[data-screen="POS-07"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByLabel("نقداً").fill("40");
    await page.getByLabel("آجل").fill("60");
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-07",
      state: "saved_local",
      texts: fromFrame("POS-07", "saved_local", [
        "مختلط بلا اتصال",
        "النقد في الدرج فعلاً والدين في المعلّق.",
        "الوجهتان محليتان معاً",
        "الصندوق يُقيّد",
        "والذمّة تدخل معلّق الطرف — فالإغلاق والكشف صادقان قبل المزامنة",
      ]),
    });
    await context.setOffline(false);
  });

  test("server_error: فشل الرفع بعد الحفظ — لا إعادة بيع، الرفع يُعاد من طابور المزامنة", async ({
    page,
  }, info) => {
    await seed(page);
    await pushRoute(page, [], { status: 500 });
    await login(page, "/pos/pay/mixed");
    await page.getByLabel("نقداً").fill("100");
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-07",
      state: "server_error",
      texts: fromFrame("POS-07", "server_error", [
        "فشل الرفع بعد الحفظ",
        "العملية محفوظة محلياً والخادم يردّها أو لا يُبلَغ.",
        "لا إعادة بيع",
        "البيع تمّ والإيصال خرج. الرفع يُعاد من طابور المزامنة",
        "— وإعادة العملية من الشاشة تصنع التكرار الذي تراجعه",
      ]),
    });
    await expect(page.locator("body")).toContainText(
      "الرفع يُعاد من طابور المزامنة — وإعادة العملية من الشاشة تصنع التكرار الذي تراجعه «مراجعة التكرار».",
    );
    await expect(page.getByRole("button", { name: /حفظ البيع/ })).toHaveCount(0);
    const sale = (await readOps(page)).find((o) => o.kind === "sale")!;
    expect(["local", "pending"]).toContain(sale.state);
  });

  test("partial: بيع فوق الرصيد الدفتري يمرّ ويُوسم", async ({ page }, info) => {
    await seed(page, { qty: "5000", stock: "3000" });
    await login(page, "/pos/pay/mixed");
    await expectFrame(page, info, {
      screenId: "POS-07",
      state: "partial",
      texts: fromFrame("POS-07", "partial", [
        "الكمية المطلوبة تتجاوز الرصيد الدفتري",
        "الدفتر يقول 3 والزبون يطلب 5. البضاعة أمامك — الدفتر هو الذي قد يكون متأخراً.",
        "البيع يمر.",
      ]),
    });
  });
});
