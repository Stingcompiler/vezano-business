import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.18 — POS-08 (5) + POS-11 (4). الإيصال لا ينتظر المزامنة: محفوظ محلياً مقابل مؤكد خادمياً،
 * وإعادة الطباعة نسخة بنفس الرقم دون بيع جديد (ACC-84)، وفشل الطابعة لا يلغي بيعاً قُبض ثمنه
 * (القاعدة 6). POS-11 بلا `ready` — الحفظ والطباعة والمزامنة ثلاثة أفعال منفصلة تُسمّى بالاسم.
 * البيع المزروع هو سيناريو ١٠٠ = ٤٠ نقداً + ٦٠ آجلاً نفسه (سكر — 1 كغ) كما في إطار 03-D2.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

type OpState = "local" | "pending" | "synced" | "quarantined";

interface Seed {
  readonly opState?: OpState;
  readonly lastPush?: { kind: string; status?: number } | null;
  readonly extraPending?: number;
}

async function seed(page: Page, s: Seed = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ opState, lastPush, extraPending, openedAt }) => {
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
        meta.put({
          key: "shift.open",
          value: JSON.stringify({ shift_id: "s1", opened_at: openedAt }),
        });
        meta.put({ key: "sales.last", value: "sale-1" });
        meta.put({
          key: "home.cache",
          value: JSON.stringify({
            savedAt: openedAt,
            summary: { tenant_name: "بقالة الأمل" },
          }),
        });
        if (lastPush)
          meta.put({ key: "sync.last_push", value: JSON.stringify({ ...lastPush, at: openedAt }) });
        else meta.delete("sync.last_push");
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
          members: [],
          state: "synced",
          createdLocalSeq: 1,
          snapshotRelation: "none",
        });
        // البيع الموحَّد: سكر 1 كغ بـ100 = 40 نقداً + 60 آجلاً على أحمد الطيب
        proj.put({
          key: "entity:sales.Sale:sale-1",
          value: {
            id: "sale-1",
            invoice_number: "INV-KRT-A2-26-001043",
            shift_id: "s1",
            branch_id: "b1",
            device_id: "d1",
            user_id: "u1",
            user_name: "سميرة ع.",
            party_id: "p1",
            party_name: "أحمد الطيب",
            subtotal_minor: "10000",
            discount_minor: "0",
            total_minor: "10000",
            cash_minor: "4000",
            bank_minor: "0",
            credit_minor: "6000",
            received_minor: "4000",
            change_minor: "0",
            lines: [
              {
                id: "l1",
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
            business_date: "2026-09-16",
            occurred_at: openedAt,
            operation_id: "op-sale-1",
          },
        });
        ops.put({
          operationId: "op-sale-1",
          kind: "sale",
          opVersion: 1,
          dependencies: ["op-open-1"],
          members: [
            {
              entity: "sales.Sale",
              id: "sale-1",
              schemaVersion: 1,
              payload: { invoice_number: "INV-KRT-A2-26-001043", total_minor: "10000" },
              serverSeq: opState === "synced" ? "7" : null,
            },
          ],
          state: opState,
          createdLocalSeq: 2,
          snapshotRelation: "none",
        });
        // فواتير أخرى تنتظر الرفع — لعدّاد «بلا اتصال · N فواتير تنتظر»
        for (let i = 0; i < extraPending; i++)
          ops.put({
            operationId: `op-extra-${i}`,
            kind: "sale",
            opVersion: 1,
            dependencies: ["op-open-1"],
            members: [],
            state: "pending",
            createdLocalSeq: 3 + i,
            snapshotRelation: "none",
          });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    {
      opState: s.opState ?? "local",
      lastPush: s.lastPush ?? null,
      extraPending: s.extraPending ?? 0,
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

/** الطابعة لا تُفتح في الاختبار — نعدّ استدعاءات window.print. */
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints += 1;
    };
  });
}
const prints = (page: Page) =>
  page.evaluate(() => (window as unknown as { __prints: number }).__prints);

function faultsRoute(page: Page, active: string[]) {
  return page.route("**/api/scenario/faults", (route) => route.fulfill(json(200, { active })));
}

const RECEIPT = ["سكر — 1 كغ", "100.00", "الإجمالي", "نقداً", "40.00", "آجل — أحمد الطيب", "60.00"];

test.describe("POS-08", () => {
  test("saved_local: محفوظ محلياً، الإيصال بوسم «محفوظ على الجهاز»، والطباعة لا تنتظر", async ({
    page,
  }, info) => {
    await seed(page, { opState: "local" });
    await stubPrint(page);
    await faultsRoute(page, []);
    await login(page, "/pos/receipt/sale-1");
    await expectFrame(page, info, {
      screenId: "POS-08",
      state: "saved_local",
      texts: fromFrame("POS-08", "saved_local", [
        "حُفظ البيع محلياً",
        "الفاتورة",
        "مسجَّلة على هذا الجهاز. تُرفع تلقائياً عند عودة الاتصال — لا تُعِد البيع.",
        "محفوظ محلياً",
        "محفوظ على الجهاز",
        ...RECEIPT,
        "طباعة الإيصال",
        "مشاركة",
        "بيع جديد",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="POS-08"]');
    await expect(root).toContainText("INV-KRT-A2-26-001043");
    await expect(root.locator(".c-print__copy")).toHaveCount(0);
    await page.getByRole("button", { name: "طباعة الإيصال" }).click();
    await expect.poll(() => prints(page)).toBe(1);
    // الطباعة الأولى محلياً لا تجعل الحالة «نجاح» — النجاح مؤكَّد خادمياً فقط
    await expect(root).toHaveAttribute("data-state", "saved_local");
    await expect(page.getByRole("button", { name: "إعادة طباعة نسخة" })).toBeVisible();
    await expect(root.locator(".c-print__copy")).toHaveText("نسخة");
  });

  test("saved_local → «آخر بيع» عبر /pos/receipt/last يفتح الفاتورة نفسها", async ({ page }) => {
    await seed(page, { opState: "local" });
    await login(page, "/pos/receipt/last");
    const root = page.locator('[data-screen="POS-08"][data-state="saved_local"]');
    await expect(root).toBeVisible();
    await expect(root).toContainText("INV-KRT-A2-26-001043");
  });

  test("pending_sync: في طابور الرفع — والإيصال لا ينتظر", async ({ page }, info) => {
    await seed(page, { opState: "pending" });
    await login(page, "/pos/receipt/sale-1");
    await expectFrame(page, info, {
      screenId: "POS-08",
      state: "pending_sync",
      texts: fromFrame("POS-08", "pending_sync", [
        "محفوظ — في طابور الرفع",
        "البيع محفوظ محلياً وينتظر دوره.",
        "الإيصال لا ينتظر",
        "يُطبع الآن بوسم «محفوظ على الجهاز» في ذيله. الزبون لا يقف على المزامنة، والوسم يحفظ صدق الورقة.",
        "معلّق المزامنة",
        "محفوظ على الجهاز",
        ...RECEIPT,
        "طباعة الإيصال",
        "بيع جديد",
      ]),
    });
  });

  test("synced → success: مؤكد خادمياً، الطباعة الأولى نجاح، والثانية نسخة بنفس الرقم", async ({
    page,
  }, info) => {
    await seed(page, { opState: "synced", lastPush: { kind: "applied" } });
    await stubPrint(page);
    await faultsRoute(page, []);
    await login(page, "/pos/receipt/sale-1");
    await expectFrame(page, info, {
      screenId: "POS-08",
      state: "synced",
      texts: fromFrame("POS-08", "synced", [
        "مؤكد خادمياً",
        "الفاتورة",
        "وصلت الخادم",
        "وصارت مرجعية.",
        "إعادة الطباعة نسخة",
        "كل طبعة بعد الأولى تحمل «نسخة» ورقمَ الأصل نفسه (ACC-84).",
        ...RECEIPT,
        "طباعة الإيصال",
        "فتح الفاتورة",
        "بيع جديد",
      ]),
    });
    const root = page.locator('[data-screen="POS-08"]');
    // لا وسم محلي بعد التأكيد
    await expect(root).not.toContainText("محفوظ على الجهاز");
    await page.getByRole("button", { name: "طباعة الإيصال" }).click();
    await expect.poll(() => prints(page)).toBe(1);
    await expectFrame(page, info, {
      screenId: "POS-08",
      state: "success",
      texts: fromFrame("POS-08", "success", [
        "مؤكَّد خادمياً",
        "العملية على الخادم، والإيصال بلا وسم محلي.",
        "طُبعت نسخة واحدة",
        "إعادة الطباعة تصدر",
        "نسخة",
        "بنفس الرقم",
        "وتُوسَم «نسخة»، ولا تسجّل بيعاً جديداً.",
        "إعادة طباعة نسخة",
        "فتح الفاتورة",
      ]),
    });
    await page.getByRole("button", { name: "إعادة طباعة نسخة" }).click();
    await expect.poll(() => prints(page)).toBe(2);
    await expect(root.locator(".c-print__copy")).toHaveText("نسخة");
    await expect(root).toContainText("INV-KRT-A2-26-001043");
    // نسخة ≠ بيع جديد: لا عملية بيع ثانية
    const kinds = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const rows = await new Promise<{ kind: string }[]>((res) => {
        const r = db.transaction("operations").objectStore("operations").getAll();
        r.onsuccess = () => res(r.result as { kind: string }[]);
      });
      db.close();
      return rows.map((r) => r.kind);
    });
    expect(kinds.filter((k) => k === "sale")).toHaveLength(1);
  });

  test("server_error: رُفض الرفع — البيع لا يُلغى", async ({ page }, info) => {
    await seed(page, { opState: "quarantined" });
    await login(page, "/pos/receipt/sale-1");
    await expectFrame(page, info, {
      screenId: "POS-08",
      state: "server_error",
      texts: fromFrame("POS-08", "server_error", [
        "رُفض الرفع",
        "البيع محفوظ محلياً والخادم ردّه — تحقق دائم لا عطل عابر.",
        "البيع لا يُلغى",
        "الرفض يذهب إلى مراجعة العمليات المتعثرة (SYS-02) ولا يمسّ إيصالاً سُلّم. النقد قُبض والبضاعة خرجت — الورقة صادقة والمشكلة إدارية.",
        "محفوظ على الجهاز",
        ...RECEIPT,
        "طباعة الإيصال",
        "بيع جديد",
      ]),
    });
    await page.getByRole("button", { name: "الخادم رفض الفاتورة" }).click();
    await expect(page).toHaveURL(/\/pos\/receipt\/sale-1\/problem$/);
    await expect(
      page.locator('[data-screen="POS-11"][data-state="validation_error"]'),
    ).toBeVisible();
  });

  test("فشل الطابعة لا يلغي البيع: «حُفظ البيع — لم تتم الطباعة» ثم إعادة المحاولة", async ({
    page,
  }, info) => {
    await seed(page, { opState: "local" });
    await stubPrint(page);
    let active = ["printer_fail"];
    await page.route("**/api/scenario/faults", (route) => route.fulfill(json(200, { active })));
    await login(page, "/pos/receipt/sale-1");
    await page.getByRole("button", { name: "طباعة الإيصال" }).click();
    await expectFrame(page, info, {
      screenId: "POS-08",
      state: "saved_local",
      texts: fromFrame("POS-11", "saved_local", [
        "حُفظ البيع — لم تتم الطباعة",
        "مسجَّلة. المشكلة في الطابعة وحدها.",
        "إعادة محاولة الطباعة",
        "إعادة الطباعة لاحقاً تصدر نسخة بنفس الرقم",
        "ولا تسجّل بيعاً جديداً.",
      ]),
    });
    await expect.poll(() => prints(page)).toBe(0);
    active = [];
    await page.getByRole("button", { name: "إعادة محاولة الطباعة" }).click();
    await expect(page.getByText("حُفظ البيع — لم تتم الطباعة")).toHaveCount(0);
    await expect.poll(() => prints(page)).toBe(1);
  });
});

test.describe("POS-11", () => {
  test("offline: بلا اتصال · N فواتير تنتظر — الحالة الوحيدة التي لا تُوقف الكاشير", async ({
    page,
    context,
  }, info) => {
    await seed(page, { opState: "pending", extraPending: 2 });
    await login(page, "/pos/receipt/sale-1/problem");
    await context.setOffline(true);
    await expectFrame(page, info, {
      screenId: "POS-11",
      state: "offline",
      texts: fromFrame("POS-11", "offline", [
        "بلا اتصال",
        "فواتير تنتظر",
        "الحفظ",
        "تمّ على الجهاز",
        "الطباعة",
        "تمّت",
        "المزامنة",
        "متوقّفة",
        "الشبكة ساقطة والبيع تمّ كاملاً: النقد في الدرج والورقة بيد الزبون. الحالة الوحيدة التي لا تُوقف الكاشير ثانيةً واحدة.",
        "الحفظ والطباعة والمزامنة ثلاثة أفعال منفصلة",
        "ابدأ بيعاً جديداً",
      ]),
    });
    // البيع نفسه + فاتورتان أخريان = 3 فواتير تنتظر
    await expect(page.locator(".c-frame")).toContainText("بلا اتصال · 3 فواتير تنتظر");
    await context.setOffline(false);
    await page.getByRole("button", { name: "ابدأ بيعاً جديداً" }).click();
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("saved_local: الشبكة قائمة والخادم بطيء — رقم مؤقت بانتظار الخادم", async ({
    page,
  }, info) => {
    await seed(page, { opState: "local", lastPush: { kind: "applied" } });
    await stubPrint(page);
    await login(page, "/pos/receipt/sale-1/problem");
    await expectFrame(page, info, {
      screenId: "POS-11",
      state: "saved_local",
      texts: fromFrame("POS-11", "saved_local", [
        "محفوظ محلياً",
        "الحفظ",
        "على الجهاز",
        "الرقم النهائي",
        "بانتظار الخادم",
        "الطباعة",
        "برقم مؤقت",
        "الشبكة قائمة والخادم بطيء. حُفظ البيع محلياً برقم",
        "ريثما يُعطى رقمه النهائي.",
        "الرقم النهائي يُعطى عند المزامنة. الورقة تحمل المؤقّت ومعه وسم «مؤقت».",
        "اطبع وابدأ بيعاً جديداً",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator('[data-screen="POS-11"]')).toContainText("INV-KRT-A2-26-001043");
    await page.getByRole("button", { name: "اطبع وابدأ بيعاً جديداً" }).click();
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("validation_error: الخادم رفض الفاتورة — النقد في الدرج والقيد مرفوض", async ({
    page,
  }, info) => {
    await seed(page, { opState: "quarantined" });
    await login(page, "/pos/receipt/sale-1/problem");
    await expectFrame(page, info, {
      screenId: "POS-11",
      state: "validation_error",
      texts: fromFrame("POS-11", "validation_error", [
        "الخادم رفض الفاتورة",
        "النقد",
        "في الدرج",
        "الطباعة",
        "تمّت",
        "القيد في النظام",
        "مرفوض",
        "البيع وقع في الواقع والنظام يرفض قيده — وهذا أخطر ما في الشاشة.",
        "لا نُلغي ولا نطلب من الكاشير أن يشرح للزبون. نُبقي الفاتورة معلّقة ونُعلمه بصنفها، وتُحلّ بقرار المالك: إعادة الصنف أو قيد يدوي. النقد لا يُنكَر لأن سطراً في قاعدة البيانات اختفى.",
        "علّقها للمالك وابدأ بيعاً جديداً",
      ]),
    });
    await page.getByRole("button", { name: "علّقها للمالك وابدأ بيعاً جديداً" }).click();
    await expect(page).toHaveURL(/\/pos$/);
  });

  test("server_error: الخادم ردّ بخطأ 500 — إعادة محاولة بعد 30 ث ومواصلة البيع محلياً", async ({
    page,
  }, info) => {
    await seed(page, { opState: "pending", lastPush: { kind: "retry", status: 500 } });
    await login(page, "/pos/receipt/sale-1/problem");
    await expectFrame(page, info, {
      screenId: "POS-11",
      state: "server_error",
      texts: fromFrame("POS-11", "server_error", [
        "خطأ خادم",
        "الحفظ المحلي",
        "تمّ",
        "الخادم",
        "ردّ بخطأ 500",
        "إعادة المحاولة",
        "بعد 30 ث",
        "الخادم موجود ويردّ بخطأ. يختلف عن بلا اتصال: هناك لا نتوقّع رداً، وهنا الرد نفسه معطوب — فلا نُعيد إلى ما لا نهاية.",
        "ثلاث محاولات متباعدة ثم توقّف وسطرٌ في سجل يراه المالك. التكرار بلا حدّ يُخفي العطب أسبوعاً حتى يُكتشف بجرد لا يطابق.",
        "واصل البيع محلياً",
      ]),
    });
    await page.getByRole("button", { name: "واصل البيع محلياً" }).click();
    await expect(page).toHaveURL(/\/pos$/);
  });
});
