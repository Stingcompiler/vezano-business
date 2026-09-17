import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.16 — POS-05 (5) + خط حفظ البيع. مستلَم وباقٍ محسوبان محلياً (ACC-24)؛ عملية `sale` بأعضائها في
 * معاملة محلية واحدة (IndexedDB حقيقي) برقم فاتورة `INV-KRT-A2-26-000001`؛ النجاح بعد الحفظ لا قبله
 * ولا بعد الطباعة؛ `saving` يعطّل الزر؛ بيع نقدي 100 لقطعة → مخزون −1 وصندوق +100 ولا قيد ذمّة (§٧.٢).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface Seed {
  readonly lines?: readonly Record<string, unknown>[];
  readonly balances?: Record<string, string>;
}

const TEA = {
  id: "l1",
  item_id: "i2",
  item_name: "شاي أسود 250غ",
  unit_id: "u-pack",
  unit_code: "عبوة",
  unit_name: "عبوة",
  factor_milli: "1000",
  decimal_places: 0,
  qty_milli: "1000",
  unit_price_minor: "10000",
};

async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ lines, balances, openedAt }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections", "operations"], "readwrite");
        tx.objectStore("meta").put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d1",
            prefix: "A2",
            branchId: "b1",
            branchCode: "KRT",
          }),
        });
        tx.objectStore("meta").put({ key: "sync_epoch", value: "epoch-A" });
        tx.objectStore("meta").put({
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
        tx.objectStore("meta").put({
          key: "pos.cart",
          value: JSON.stringify({ lines, updated_at: openedAt }),
        });
        tx.objectStore("meta").put({
          key: "shift.open",
          value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
        });
        tx.objectStore("projections").put({
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
        tx.objectStore("operations").put({
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
        for (const [id, qty] of Object.entries(balances))
          tx.objectStore("projections").put({
            key: `entity:inventory.Balance:${id}`,
            value: { item_id: id, qty_milli: qty, as_of: openedAt },
          });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      lines: s.lines ?? [TEA],
      balances: s.balances ?? { i2: "6000" },
      openedAt: new Date().toISOString(),
    },
  );
}

async function login(page: Page) {
  await page.route("**/api/auth/account/login", (route) =>
    route.fulfill(
      json(200, { access: "a", refresh: "r", session_id: "s", tenant_id: "t1", user_id: "u1" }),
    ),
  );
  await page.goto("/login?next=%2Fpos%2Fpay");
  await page.getByLabel("رقم الهاتف أو البريد").fill("cashier@sting.example");
  await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/pos\/pay$/);
}

function acceptPush(
  page: Page,
  seen: { kind: string; members: { entity: string }[] }[],
  delayMs = 0,
) {
  return page.route("**/api/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: { operation_id: string; kind: string; members: { entity: string }[] }[];
      request_id: string;
    };
    seen.push(...body.operations);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
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

interface Local {
  readonly ops: {
    kind: string;
    state: string;
    members: { entity: string; payload: Record<string, unknown> }[];
  }[];
  readonly balance: string | null;
  readonly cartLines: number;
  readonly sales: {
    invoice_number: string;
    total_minor: string;
    cash_minor: string;
    credit_minor: string;
  }[];
}

async function readLocal(page: Page): Promise<Local> {
  return page.evaluate(async () => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    const all = <T>(store: string) =>
      new Promise<T[]>((res) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result as T[]);
      });
    const ops = await all<{
      kind: string;
      state: string;
      members: { entity: string; payload: Record<string, unknown> }[];
    }>("operations");
    const projections = await all<{ key: string; value: Record<string, unknown> }>("projections");
    const meta = await all<{ key: string; value: string }>("meta");
    db.close();
    const bal = projections.find((p) => p.key === "entity:inventory.Balance:i2");
    const cart = meta.find((m) => m.key === "pos.cart");
    return {
      ops: ops.map((o) => ({ kind: o.kind, state: o.state, members: o.members })),
      balance: bal ? String(bal.value["qty_milli"]) : null,
      cartLines: cart ? (JSON.parse(cart.value) as { lines: unknown[] }).lines.length : -1,
      sales: projections
        .filter((p) => p.key.startsWith("entity:sales.Sale:"))
        .map(
          (p) =>
            p.value as {
              invoice_number: string;
              total_minor: string;
              cash_minor: string;
              credit_minor: string;
            },
        ),
    };
  });
}

test.describe("POS-05", () => {
  test("ready → success: المطلوب والمستلَم والباقي، ثم الحفظ بمعاملة واحدة ورقم فاتورة والآثار (§٧.٢)", async ({
    page,
  }, info) => {
    await seed(page);
    const pushed: { kind: string; members: { entity: string }[] }[] = [];
    await acceptPush(page, pushed);
    await login(page);
    await expectFrame(page, info, {
      screenId: "POS-05",
      state: "ready",
      texts: fromFrame("POS-05", "ready", [
        "الدفع النقدي",
        "المطلوب",
        "100.00",
        "ج.س",
        "المبلغ المستلم",
        "100",
        "200",
        "500",
        "مبلغ مضبوط",
        "الباقي للعميل",
        "حفظ البيع — 100.00 ج.س",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    // لا حفظ قبل مبلغ مستلَم يكفي — الزر معطّل بسببه
    await expect(page.getByRole("button", { name: /حفظ البيع/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByRole("button", { name: "200", exact: true }).click();
    await expect(page.getByLabel("المبلغ المستلم")).toHaveValue("200.00");
    await expect(page.locator(".pos-pay__change")).toContainText("100.00");
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-05",
      state: "success",
      texts: fromFrame("POS-05", "success", [
        "اكتمل البيع",
        "النجاح بعد الحفظ",
        "لا بعد الطباعة. فشل الطابعة بعده لا يلغي البيع: «أعد الطباعة» تُخرج نسخة بنفس الرقم لا بيعاً جديداً (ACC-84).",
        "الباقي للعميل",
      ]),
    });
    await expect(page.locator(".pos-pay__change--big")).toContainText("100.00");
    await expect(page.locator('[data-screen="POS-05"]')).toContainText("INV-KRT-A2-26-000001");
    // §٧.٢ الصف الأول: مخزون −1 (6 → 5)، صندوق +100، لا قيد ذمّة؛ السلة فُرِّغت؛ العملية رُفعت
    const local = await readLocal(page);
    const sale = local.ops.find((o) => o.kind === "sale")!;
    expect(sale.members.map((m) => m.entity).sort()).toEqual([
      "inventory.StockMovement",
      "sales.Payment",
      "sales.Sale",
      "sales.SaleLine",
    ]);
    expect(sale.members.find((m) => m.entity === "sales.Payment")!.payload).toMatchObject({
      method: "cash",
      amount_minor: "10000",
      received_minor: "20000",
      change_minor: "10000",
    });
    expect(sale.members.find((m) => m.entity === "inventory.StockMovement")!.payload).toMatchObject(
      { delta_base_qty_milli: "-1000" },
    );
    expect(local.balance).toBe("5000");
    expect(local.cartLines).toBe(0);
    expect(local.sales[0]).toMatchObject({
      invoice_number: "INV-KRT-A2-26-000001",
      total_minor: "10000",
      cash_minor: "10000",
      credit_minor: "0",
    });
    expect(pushed.map((o) => o.kind)).toEqual(["sale"]);
    expect(sale.state).toBe("synced");
  });

  test("saving: زرّ واحد يُقفل ولا رسالة نجاح قبل الاكتمال", async ({ page }, info) => {
    await seed(page);
    await acceptPush(page, [], 8000);
    await login(page);
    await page.getByRole("button", { name: "مبلغ مضبوط" }).click();
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expect(page.getByRole("button", { name: /حفظ البيع/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.locator('[data-screen="POS-05"]')).not.toContainText("اكتمل البيع");
    await expectFrame(page, info, {
      screenId: "POS-05",
      state: "saving",
      texts: fromFrame("POS-05", "saving", [
        "جارٍ الحفظ",
        "زرّ واحد يُقفل، والطباعة لا تبدأ قبل تمام الحفظ.",
      ]),
    });
    await expect(page.locator('[data-screen="POS-05"][data-state="success"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test("saved_local: بلا اتصال — «محفوظ على هذا الجهاز — يُرفع عند الاتصال»، الباقي أكبر رقم", async ({
    page,
    context,
  }, info) => {
    await seed(page);
    await login(page);
    await expect(page.locator('[data-screen="POS-05"][data-state="ready"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByRole("button", { name: "500", exact: true }).click();
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expectFrame(page, info, {
      screenId: "POS-05",
      state: "saved_local",
      texts: fromFrame("POS-05", "saved_local", [
        "حُفظ على الجهاز",
        "النجاح بلا اتصال يُسمّى باسمه: «محفوظ على هذا الجهاز — يُرفع عند الاتصال».",
        "الباقي للعميل",
      ]),
    });
    await expect(page.locator(".pos-pay__change--big")).toContainText("400.00");
    const local = await readLocal(page);
    expect(local.ops.find((o) => o.kind === "sale")?.state).toBe("local");
    expect(local.sales[0]?.invoice_number).toBe("INV-KRT-A2-26-000001");
    await context.setOffline(false);
  });

  test("validation_error: صنف بلا سعر — يُطلب الرقم لهذه العملية ويُسجَّل باسمك، والبيع يكمل", async ({
    page,
  }, info) => {
    await seed(page, {
      lines: [
        TEA,
        {
          ...TEA,
          id: "l2",
          item_id: "i9",
          item_name: "ملح طعام",
          unit_price_minor: "0",
        },
      ],
      balances: {},
    });
    await acceptPush(page, []);
    await login(page);
    await expectFrame(page, info, {
      screenId: "POS-05",
      state: "validation_error",
      texts: fromFrame("POS-05", "validation_error", [
        "«ملح طعام» بلا سعر في بطاقته",
        "أُضيف الصنف من جرد سابق ولم يُسعَّر. الزبون واقف، والبيع يكمل.",
        "سعر البيع لهذه العملية",
        "SDG / العبوة",
        "يُسجَّل باسمك ووقته في سجل التدقيق، ويظهر في تقرير «أسعار أُدخلت يدوياً» لمراجعة المالك.",
        "لهذه العملية فقط",
        "الأسلم افتراضاً: لا يغيّر بطاقة الصنف، والمالك يسعّرها لاحقاً بهدوء",
        "واعتماده سعراً للصنف",
        "يحتاج صلاحية تسعير — الكاشير لا يملكها",
        "تخطي الصنف وإكمال البيع",
        "يُباع الباقي، ويُسجَّل أن صنفاً سقط من العملية لنقص سعر",
        "لن نقترح سعراً من متوسط أصناف أخرى ولا من آخر شراء: أي رقم نقترحه سيُقبل بالضغط ويصبح سعرك المعتمد بلا قرار منك.",
      ]),
    });
    await expect(page.getByRole("button", { name: "واعتماده سعراً للصنف" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByLabel("سعر البيع لهذه العملية").fill("120.00");
    await expect(page.locator('[data-screen="POS-05"][data-state="ready"]')).toBeVisible();
    // المطلوب 100 + 120 = 220
    await expect(page.locator(".pos-pay__required")).toContainText("220.00");
    await page.getByRole("button", { name: "مبلغ مضبوط" }).click();
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expect(page.locator('[data-screen="POS-05"][data-state="success"]')).toBeVisible();
    const local = await readLocal(page);
    const salt = local.ops
      .find((o) => o.kind === "sale")!
      .members.find((m) => m.entity === "sales.SaleLine" && m.payload["item_id"] === "i9")!;
    expect(salt.payload).toMatchObject({ unit_price_minor: "12000", manual_price: true });
  });

  test("بيع فوق الرصيد الدفتري يمرّ ويُوسم — لا منع (ACC-17)", async ({ page }) => {
    await seed(page, { lines: [{ ...TEA, qty_milli: "5000" }], balances: { i2: "3000" } });
    await acceptPush(page, []);
    await login(page);
    const root = page.locator('[data-screen="POS-05"]');
    await expect(root).toContainText("الكمية المطلوبة تتجاوز الرصيد الدفتري");
    await expect(root).toContainText(
      "الدفتر يقول 3 والزبون يطلب 5. البضاعة أمامك — الدفتر هو الذي قد يكون متأخراً.",
    );
    await expect(root).toContainText("البيع يمر.");
    await expect(root).toContainText("الرصيد بعد البيع");
    await page.getByRole("button", { name: "500", exact: true }).click();
    await page.getByRole("button", { name: /حفظ البيع/ }).click();
    await expect(page.locator('[data-screen="POS-05"][data-state="success"]')).toBeVisible();
    expect((await readLocal(page)).balance).toBe("-2000");
  });
});
