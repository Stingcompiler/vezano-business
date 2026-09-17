import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.25 — PTY-06 (6). سداد نقدي 40 على ذمّة 180: الرصيد المركّب 140 فوراً (لقطة + سداد محلي —
 * ACC-03) والنقد يدخل درج SHIFT-02؛ التحويل «مسجَّل — غير مطابق» لا يُسقط الذمّة (ACC-133) ومرجعه لا
 * يُستهلك مرتين (ACC-15)؛ الردّ يطلب سبباً والكاشير يقبض ولا يردّ؛ بلا اتصال «سُجّل بلا اتصال».
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface Seed {
  readonly role?: "cashier" | "owner";
  readonly usedRef?: string;
}

async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, usedRef, openedAt }) => {
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
            userName: role === "owner" ? "سالم" : "سميرة ع.",
            roleName: role === "owner" ? "مالك" : "كاشير",
            roleCode: role,
            ownerName: "ندى",
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
        // أحمد: خادمي 120 + آجل معلّق 60 = 180
        proj.put({
          key: "entity:parties.Party:p1",
          value: {
            id: "p1",
            name: "أحمد الطيب — تجريبي",
            name_normalized: "احمد الطيب — تجريبي",
            phone: "0912555447",
            credit_limit_minor: "50000",
            is_customer: true,
            is_supplier: false,
            distinct_from_id: "",
            balance_minor: "12000",
            balance_as_of: openedAt,
            last_sale_at: "",
            is_active: true,
            deactivated_at: "",
            updated_at: openedAt,
          },
        });
        proj.put({
          key: "entity:sales.Sale:sale-1043",
          value: {
            id: "sale-1043",
            invoice_number: "INV-KRT-A2-26-000001",
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
            business_date: openedAt.slice(0, 10),
            occurred_at: openedAt,
            operation_id: "op-sale-1043",
          },
        });
        ops.put({
          operationId: "op-sale-1043",
          kind: "sale",
          opVersion: 1,
          dependencies: ["op-open-1"],
          members: usedRef
            ? [
                {
                  entity: "sales.Payment",
                  id: "pay-x",
                  schemaVersion: 1,
                  payload: { method: "bank", reference: usedRef },
                  serverSeq: null,
                },
              ]
            : [],
          state: "pending",
          createdLocalSeq: 2,
          snapshotRelation: "none",
        });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role: s.role ?? "cashier", usedRef: s.usedRef ?? "", openedAt: new Date().toISOString() },
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

function pushRoute(
  page: Page,
  seen: { kind: string; members: { payload: Record<string, unknown> }[] }[],
) {
  return page.route("**/api/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      operations: {
        operation_id: string;
        kind: string;
        members: { payload: Record<string, unknown> }[];
      }[];
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

const PAY = "/parties/p1/payment";

test.describe("PTY-06", () => {
  test("ready → saving → success: سداد نقدي 40 يخفض 180 إلى 140 فوراً ويدخل درج SHIFT-02", async ({
    page,
  }, info) => {
    await seed(page);
    const pushed: { kind: string; members: { payload: Record<string, unknown> }[] }[] = [];
    await pushRoute(page, pushed);
    // المسجَّل أخيراً يعمل أولاً: تأخير الرفع ليُرى «جارٍ الحفظ» ثم يمرّ إلى القبول
    await page.route("**/api/sync/push", async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      return route.fallback();
    });
    await login(page, PAY);
    await expectFrame(page, info, {
      screenId: "PTY-06",
      state: "ready",
      texts: fromFrame("PTY-06", "ready", [
        "تسجيل سداد أو رد مبلغ",
        "— سداد نقدي",
        "وسيلة ومرجع وصلاحية وإيصال. التحويل البنكي لا يُسقط الذمة حتى المطابقة — ACC-133.",
        "سداد",
        "ردّ مبلغ",
        "سداد من أحمد الطيب — تجريبي",
        "عليه الآن",
        "180.00",
        "المبلغ المسدَّد",
        "الوسيلة",
        "نقداً",
        "تحويل بنكي",
        "الرصيد بعد السداد",
        "النقد يدخل صندوق الوردية المفتوحة فوراً ويظهر في",
        "SHIFT-02",
        "تسجيل السداد وطباعة إيصال",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="PTY-06"]');
    // الرصيد المركّب قبل السداد: خادمي 120 + معلّق 60 (ACC-03)
    await expect(root).toContainText("خادمي 120.00 + معلّق هذا الجهاز 60.00 = 180.00");
    await page.getByLabel("المبلغ المسدَّد").fill("40");
    await expect(root).toContainText("140.00");
    await page.getByRole("button", { name: "تسجيل السداد وطباعة إيصال" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-06",
      state: "saving",
      texts: fromFrame("PTY-06", "saving", [
        "جارٍ الحفظ",
        "الحفظ والطباعة منفصلان هنا أيضاً: يُحفظ السند ثم يُطبع. لا تُطبع ورقة على شيء لم يُحفظ.",
      ]),
    });
    await expectFrame(page, info, {
      screenId: "PTY-06",
      state: "success",
      texts: fromFrame("PTY-06", "success", [
        "سُجّل السداد",
        "رقم نهائي وطباعة جاهزة. نسخة للطرف ونسخة تبقى في المستندات.",
        "لا يُحذف",
        "التصحيح بسند عكس يشير إليه. سندُ قبضٍ يختفي يعني مالاً قُبض ولا أثر له.",
        "المسار التالي: اطبع، أو سجّل سداداً لطرف آخر — لا عودة إلى نموذج فارغ بلا سياق.",
      ]),
    });
    await expect(root).toContainText("REC-KRT-A2-26-000001");
    await expect(root).toContainText("140.00");
    const rec = pushed.find((o) => o.kind === "payment_receipt")!;
    expect(rec.members[0]!.payload).toMatchObject({
      kind: "receipt",
      method: "cash",
      amount_minor: "4000",
      party_id: "p1",
      receipt_number: "REC-KRT-A2-26-000001",
    });
    // SHIFT-02: السداد +40 داخل الصندوق
    await page.getByRole("link", { name: "الوردية والصندوق" }).click();
    await expect(page).toHaveURL(/\/shifts\/current$/);
    const shift = page.locator('[data-screen="SHIFT-02"]');
    await expect(shift).toContainText("REC-KRT-A2-26-000001");
    await expect(shift).toContainText("سداد من أحمد الطيب");
    // 1,840 + 40 (بيع نقدي) + 40 (سداد) = 1,920
    await expect(shift.locator(".shift-expected__v")).toContainText("1,920.00");
  });

  test("ready (تحويل بنكي): مسجَّل — غير مطابق، الرصيد لا يتغير، ومرجع مستهلَك يُرفض", async ({
    page,
  }, info) => {
    await seed(page, { usedRef: "TRF-88214" });
    const pushed: { kind: string; members: { payload: Record<string, unknown> }[] }[] = [];
    await pushRoute(page, pushed);
    await login(page, PAY);
    await page.getByLabel("تحويل بنكي").check();
    await expectFrame(page, info, {
      screenId: "PTY-06",
      state: "ready",
      texts: fromFrame("PTY-06", "ready", [
        "— تحويل غير مطابق",
        "المبلغ",
        "مرجع التحويل — إلزامي",
        "مسجَّل — غير مطابق",
        "رفع الإيصال لا يعني وصول المبلغ. تبقى ذمة العميل",
        "حتى تؤكد الاستلام في كشف البنك، ثم يُسقط الدين بفعل صريح.",
        "الرصيد بعد التسجيل",
        "— لا يتغير",
        "تسجيل التحويل بانتظار المطابقة",
      ]),
    });
    const root = page.locator('[data-screen="PTY-06"]');
    await page.getByLabel("المبلغ المسدَّد").fill("180");
    await page.getByLabel("مرجع التحويل — إلزامي").fill("TRF-88214");
    await page.getByRole("button", { name: "تسجيل التحويل بانتظار المطابقة" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-06",
      state: "validation_error",
      texts: fromFrame("PTY-06", "validation_error", ["مرجع التحويل — إلزامي"]),
    });
    await expect(root).toContainText("مرجع تحويل لا يُستهلك مرتين (ACC-15)");
    expect(pushed).toHaveLength(0);
    await page.getByLabel("مرجع التحويل — إلزامي").fill("TRF-99001");
    await page.getByRole("button", { name: "تسجيل التحويل بانتظار المطابقة" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    // الذمّة لم تتغير: 180
    await expect(root).toContainText("تحويل بنكي · مسجَّل — غير مطابق");
    await expect(root.locator(".shift-facts")).toContainText("180.00");
    expect(pushed[0]!.members[0]!.payload).toMatchObject({
      method: "bank",
      reference: "TRF-99001",
    });
  });

  test("saved_local: بلا اتصال — سند مؤقت ورصيد محلي موسوم", async ({ page, context }, info) => {
    await seed(page);
    await login(page, PAY);
    await page.getByLabel("المبلغ المسدَّد").fill("40");
    await context.setOffline(true);
    await page.getByRole("button", { name: "تسجيل السداد وطباعة إيصال" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-06",
      state: "saved_local",
      texts: fromFrame("PTY-06", "saved_local", [
        "سُجّل بلا اتصال",
        "السداد محفوظ على الجهاز بسند مؤقت. رصيد الطرف يُحدَّث محلياً ويُوسم «غير مزامن».",
        "الخطر",
        "قد يكون الطرف قد سدّد في فرع آخر في الوقت نفسه. الكشف يُظهر السند المؤقت بوسمه حتى تتم المزامنة ويُطابَق.",
      ]),
    });
    await context.setOffline(false);
    await expect(page.locator('[data-screen="PTY-06"]')).toContainText("140.00");
  });

  test("permission_denied: الكاشير يقبض ولا يردّ — تبويب «ردّ مبلغ» معطّل بسببه", async ({
    page,
  }, info) => {
    await seed(page);
    await login(page, PAY);
    await page.getByRole("button", { name: "ردّ مبلغ" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-06",
      state: "permission_denied",
      texts: fromFrame("PTY-06", "permission_denied", [
        "الكاشير يقبض ولا يردّ",
        "القبض يزيد النقد والردّ يُخرجه. الفعلان متعاكسان في الأثر فلا يتساويان في الصلاحية.",
        "نُظهر",
        "تبويب «ردّ مبلغ» معطّلاً بسببه لا محذوفاً — الكاشير يعرف أن المسار موجود ويُطلب.",
        "«اطلب من ندى» بالمبلغ والسبب والطرف، فتوافق من جهازها ويُنسب الردّ إليها.",
      ]),
    });
  });

  test("validation_error (ردّ): الردّ يطلب سبباً مكتوباً دائماً — ولو نفّذه المالك", async ({
    page,
  }, info) => {
    await seed(page, { role: "owner" });
    const pushed: { kind: string; members: { payload: Record<string, unknown> }[] }[] = [];
    await pushRoute(page, pushed);
    await login(page, PAY);
    await page.getByRole("button", { name: "ردّ مبلغ" }).click();
    await page.getByLabel("المبلغ المردود").fill("10");
    await page.getByRole("button", { name: "تسجيل الردّ وطباعة إيصال" }).click();
    await expectFrame(page, info, {
      screenId: "PTY-06",
      state: "validation_error",
      texts: fromFrame("PTY-06", "validation_error", [
        "الردّ يطلب سبباً مكتوباً دائماً، ولو نفّذه المالك بنفسه.",
      ]),
    });
    expect(pushed).toHaveLength(0);
    await page.getByLabel("السبب").fill("بضاعة ناقصة");
    await page.getByRole("button", { name: "تسجيل الردّ وطباعة إيصال" }).click();
    await expect(page.locator('[data-screen="PTY-06"]')).toHaveAttribute("data-state", "success");
    expect(pushed[0]!.members[0]!.payload).toMatchObject({
      kind: "refund",
      amount_minor: "1000",
      reason: "بضاعة ناقصة",
    });
    // الردّ يرفع الذمّة: 180 + 10 = 190
    await expect(page.locator('[data-screen="PTY-06"] .shift-facts')).toContainText("190.00");
  });
});
