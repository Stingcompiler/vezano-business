import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.39 — SYS-09 تحديث التطبيق مع معلّق (5) + SYS-10 استيراد بيانات بمعاينة (6). لا تحديث إجباري
 * فوري؛ ارفع ثم حدّث بزرّ واحد؛ المسار الآمن: ارفع ← صدّر ← حدّث؛ الرجوع الآمن افتراضي. الاستيراد:
 * المطابقة تُقترح لا تُفترض، لا كتابة أثناء الفحص، المكرر يحتاج قرارك، نجاح جزئي يُسمّى جزئياً،
 * بصمة الملف تمنع المضاعفة، الاستئناف بالبصمة، التراجع خلال 24 ساعة.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function seed(page: Page, ops: number, meta: Record<string, string> = {}) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ ops, meta }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "operations"], "readwrite");
        const m = tx.objectStore("meta");
        const o = tx.objectStore("operations");
        m.clear();
        o.clear();
        m.put({
          key: "device.registration",
          value: JSON.stringify({
            deviceId: "d1",
            prefix: "POS1",
            branchId: "b1",
            branchCode: "KRT",
          }),
        });
        m.put({ key: "sync_epoch", value: "epoch-A" });
        m.put({
          key: "shift.context",
          value: JSON.stringify({
            branchId: "b1",
            branchName: "الرئيسي",
            branchCode: "KRT",
            deviceId: "d1",
            deviceName: "حاسوب الكاشير 1",
            devicePrefix: "POS1",
            userId: "u1",
            userName: "سالم",
            roleName: "مالك",
            roleCode: "owner",
          }),
        });
        for (const [k, v] of Object.entries(meta)) m.put({ key: k, value: v });
        for (let i = 0; i < ops; i++) {
          o.put({
            operationId: `op-${i}`,
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [
              {
                entity: "sales.Sale",
                id: `op-${i}-h`,
                schemaVersion: 1,
                serverSeq: null,
                payload: { invoice_number: `INV-${i}`, total_minor: "10000" },
              },
            ],
            state: "local",
            createdLocalSeq: i + 1,
            snapshotRelation: "none",
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { ops, meta },
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

const update = (latest = "1.4.0") => ({
  latest_version: latest,
  notes: "تسريع البحث",
  schema_version: 2,
  released_at: "2026-09-18T08:00:00Z",
});

function pushOk(page: Page) {
  return page.route("**/api/sync/push", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      request_id: string;
      operations: { operation_id: string }[];
    };
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

test.describe("SYS-09", () => {
  test("pending_sync → validation_error → success: ارفع ثم حدّث، المسار الآمن، والمعلّق نجا", async ({
    page,
  }, info) => {
    await seed(page, 12);
    await page.route("**/api/app/update", (route) => route.fulfill(json(200, update())));
    await pushOk(page);
    await page.route("**/api/sync/status", (route) =>
      route.fulfill(
        json(200, {
          server_time: "",
          sync_epoch: "epoch-A",
          server_seq_high: "9",
          quarantined: 0,
          conflicted: 0,
          last_accepted_at: null,
        }),
      ),
    );
    await login(page, "/sync/update");
    await expectFrame(page, info, {
      screenId: "SYS-09",
      state: "pending_sync",
      texts: fromFrame("SYS-09", "pending_sync", [
        "تحديث التطبيق مع عمليات معلقة",
        "تحديث متاح",
        "حدّث بعد رفع المعلّق",
        "عملية معلّقة والتحديث ينتظر. لا نمنع — نُرتّب.",
        "الترتيب المقترح",
        "ارفع ثم حدّث. وزرّه واحد ينفّذ الاثنين بالترتيب بلا أن يعود المستخدم مرتين.",
        "التحديث رغم المعلّق",
        "متاح بتأكيد يقول المخاطرة صراحةً: التحديث يُهاجر قاعدة البيانات، ومعلّقٌ من إصدار قديم قد يحتاج تدخّلاً.",
        "تأجيل التحديث حتى المزامنة",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-09"]');
    await expect(root).toContainText("كم عملية معلّقة الآن؟12");
    await expect(root).toContainText("1.4.0 · تسريع البحث");
    // ارفع ثم حدّث: يرفع، وبلا نسخة خلال 7 أيام يتوقف عند المسار الآمن
    await page.getByRole("button", { name: "ارفع ثم حدّث" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-09",
      state: "validation_error",
      texts: fromFrame("SYS-09", "validation_error", [
        "تحديث التطبيق مؤجَّل",
        "التحديث يغيّر صيغة التخزين. تشغيله الآن مع معلّق غير مرفوع مخاطرة لا داعي لها.",
        "المسار الآمن:",
        "ارفع المعلّق ← صدّر نسخة ← حدّث",
        "مانع",
        "لا توجد نسخة محلية محفوظة خلال آخر 7 أيام",
        "سليم",
        "مساحة كافية للتحديث وللنسخة الاحتياطية معاً",
        "تأجيل التحديث حتى المزامنة",
      ]),
    });
    await expect(root).toContainText("كم عملية معلّقة الآن؟0");
    // بعد التصدير (نسخة حديثة) يصير التحديث آمناً
    await seed(page, 0, { "backup.last_exported_at": new Date().toISOString() });
    await login(page, "/sync/update");
    await expectFrame(page, info, {
      screenId: "SYS-09",
      state: "ready",
      texts: fromFrame("SYS-09", "ready", [
        "تحديث متاح",
        "رقم الإصدار وما فيه، ثم السؤال الحاسم: كم عملية معلّقة الآن؟ صفرٌ يعني تحديثاً آمناً، وغيره يعني قراراً.",
        "لا تحديث إجباري فوري",
        "التحديث في منتصف يوم بيعٍ مزدحم قرارٌ سيئ ولو كان الإصدار أفضل. نقترح «بعد إقفال الوردية».",
      ]),
    });
    await page.getByRole("button", { name: "حدّث الآن" }).click();
    // «التركيب» = إعادة تحميل؛ الجلسة في الذاكرة → دخول ثم العودة بـ?updated=1
    await expect(page).toHaveURL(/\/login\?next=.*updated/);
    await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-09",
      state: "success",
      texts: fromFrame("SYS-09", "success", [
        "حُدّث التطبيق",
        "عملية ما زالت في الطابور بترتيبها.",
        "نقول ذلك أولاً",
        "قبل أي ذكر لمزايا الإصدار. من حدّث وعنده معلّق يسأل عنه لا عن الجديد.",
      ]),
    });
    await expect(root).toContainText("الإصدار الجديد يعمل، والمعلّق نجا كما هو: 0 عملية");
  });

  test("server_error: فشل التحديث — الإصدار القديم يعمل والمعلّق سليم", async ({ page }, info) => {
    await seed(page, 3);
    await page.route("**/api/app/update", (route) =>
      route.fulfill(json(503, { detail: "unavailable" })),
    );
    await login(page, "/sync/update");
    await expectFrame(page, info, {
      screenId: "SYS-09",
      state: "server_error",
      texts: fromFrame("SYS-09", "server_error", [
        "فشل التحديث",
        "التنزيل أو التركيب تعثّر. الإصدار القديم يعمل كما كان والمعلّق سليم.",
        "الرجوع الآمن",
        "هو السلوك الافتراضي لا خياراً. تطبيقٌ نصف محدَّث على دفتر مالٍ حالةٌ لا نسمح بوجودها.",
      ]),
    });
    await expect(page.locator('[data-screen="SYS-09"]')).toContainText("كم عملية معلّقة الآن؟3");
  });
});

const CSV =
  "الصنف,الوحدة,السعر,باركود\n" +
  "سكر — كيس 50,kg,120.00,\n" +
  "زيت قلي 5 لتر,carton,80.00,\n" +
  "دقيق فاخر,,35.00,\n" +
  "شاي أحمر,pack,-9.00,\n" +
  "معلبات فول,piece,7.50,222\n" +
  "معلبات فول,piece,8.00,\n";

const row = (
  line: number,
  name: string,
  unit: string,
  price: string,
  result: string,
  extra: Record<string, unknown> = {},
) => ({
  line,
  row_hash: `h${line}`,
  values: { name, unit, price, barcode: "" },
  result,
  reason: "",
  price_minor: price ? String(Math.round(Number(price) * 100)) : "",
  ...extra,
});

const previewed = (over: Record<string, unknown> = {}) => ({
  id: "b-1",
  kind: "items",
  file_name: "أصناف-سبتمبر.csv",
  status: "previewed",
  mapping: { name: 0, unit: 1, price: 2, barcode: 3 },
  headers: ["الصنف", "الوحدة", "السعر", "باركود"],
  suggested_mapping: { name: 0, unit: 1, price: 2, barcode: 3 },
  rows: [
    row(2, "سكر — كيس 50", "kg", "120.00", "create"),
    row(3, "زيت قلي 5 لتر", "carton", "80.00", "update", {
      old_price_minor: "7500",
      item_id: "i-2",
    }),
    row(4, "دقيق فاخر", "", "35.00", "rejected", { reason: "unit_required" }),
    row(5, "شاي أحمر", "pack", "-9.00", "rejected", { reason: "negative", price_minor: "" }),
    row(6, "معلبات فول", "piece", "7.50", "needs_decision", { duplicate_of_line: 7 }),
    row(7, "معلبات فول", "piece", "8.00", "needs_decision", { duplicate_of_line: 6 }),
  ],
  total_rows: 6,
  create_count: 1,
  update_count: 1,
  rejected_count: 2,
  decision_count: 2,
  applied_count: 0,
  revert_until: "",
  already_imported: false,
  ...over,
});

test.describe("SYS-10", () => {
  test("ready → loading → validation_error → partial → server_error → success: المعاينة والقرار والاستئناف والتراجع", async ({
    page,
  }, info) => {
    await seed(page, 0);
    let batch = previewed();
    const calls: string[] = [];
    await page.route("**/api/imports/preview", async (route) => {
      calls.push("preview");
      await new Promise((r) => setTimeout(r, 1200));
      return route.fulfill(json(200, batch));
    });
    await page.route("**/api/imports/b-1/decide", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        decisions: Record<string, string>;
      };
      calls.push(`decide:${JSON.stringify(body.decisions)}`);
      batch = previewed({
        rows: batch.rows.map((r) =>
          r.line === 7
            ? { ...r, result: "create", reason: "" }
            : r.line === 6
              ? { ...r, result: "rejected", reason: "duplicate_in_file" }
              : r,
        ),
        create_count: 2,
        rejected_count: 3,
        decision_count: 0,
      });
      return route.fulfill(json(200, batch));
    });
    await page.route("**/api/imports/b-1/apply", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as { stop_after?: number };
      calls.push(`apply:${body.stop_after ?? "all"}`);
      batch =
        body.stop_after !== undefined
          ? { ...batch, status: "applying", applied_count: 1 }
          : {
              ...batch,
              status: "applied",
              applied_count: 3,
              revert_until: new Date(Date.now() + 86_400_000).toISOString(),
              already_imported: true,
            };
      return route.fulfill(json(200, batch));
    });
    await page.route("**/api/imports/b-1/revert", (route) => {
      calls.push("revert");
      batch = { ...batch, status: "reverted" };
      return route.fulfill(json(200, batch));
    });
    await page.route("**/api/imports/b-1/rejected.csv", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: "﻿السطر,name,unit,price,barcode,السبب\n4,دقيق فاخر,,35.00,,الوحدة فارغة\n",
      }),
    );
    await login(page, "/sync/import");
    await expectFrame(page, info, {
      screenId: "SYS-10",
      state: "ready",
      texts: fromFrame("SYS-10", "ready", [
        "استيراد بيانات",
        "مدخل البيانات الجملة. الخطر أن يُستورد الملف مرتين فيتضاعف كل شيء.",
        "اختر ملفاً وطابق أعمدته",
        "رفع الملف ثم مطابقة أعمدته بحقول النظام، مع معاينة أول خمسة صفوف كما ستُحفظ فعلاً.",
        "المطابقة تُقترح لا تُفترض",
        "النظام يخمّن من العناوين ويعرض تخمينه للتعديل. الافتراض الصامت يُدخل السعر في حقل التكلفة.",
        "الوحدة إلزامية",
        "صنفٌ بلا وحدة لا يُستورد — نفس قاعدة",
        "الاستيراد ليس باباً خلفياً يلتفّ على قواعد الإدخال.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.locator("body")).toContainText(
      "صنفٌ بلا وحدة لا يُستورد — نفس قاعدة إنشاء الصنف.",
    );
    await page.getByLabel("ملف الاستيراد").setInputFiles({
      name: "أصناف-سبتمبر.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CSV, "utf8"),
    });
    await page.getByRole("button", { name: "فحص الملف" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-10",
      state: "loading",
      texts: fromFrame("SYS-10", "loading", [
        "جارٍ الفحص",
        "الفحص قبل الكتابة: عدّ الصفوف، كشف التكرار داخل الملف، ومطابقته بما هو موجود.",
        "لا كتابة أثناء الفحص",
        "يُقرأ كاملاً ويُعرض تقريره ثم يُكتب بعد موافقة. الكتابة التدريجية تجعل الإلغاء مستحيلاً.",
      ]),
    });
    const root = page.locator('[data-screen="SYS-10"]');
    // المكرر بسعرين يحتاج قرارك — لا اختيار صامت
    await expectFrame(page, info, {
      screenId: "SYS-10",
      state: "validation_error",
      texts: fromFrame("SYS-10", "validation_error", [
        "معاينة استيراد الأصناف — قبل الاعتماد",
        "الصف",
        "الصنف كما ورد",
        "الوحدة",
        "السعر",
        "النتيجة",
        "يحتاج قرارك",
        "مكرر مع الصف",
        "بسعر مختلف. أيّهما الصحيح؟ نسألك ولا نختار.",
        "تنزيل المرفوضات لتصحيحها",
      ]),
    });
    await expect(root).toContainText("الملف: أصناف-سبتمبر.csv · 6 صفاً · 4 صفاً لن يُستورد");
    await expect(page.getByLabel("عمود السعر")).toHaveValue("2");
    await expect(root).toContainText("الوحدة فارغة. بلا وحدة لا يمكن حساب مخزون ولا سعر بيع.");
    await expect(root).toContainText("سعر سالب. لا نصحّحه نيابةً عنك ولا نستورده كصفر.");
    await expect(root).toContainText("مطابق لصنف قائم — سيُحدَّث سعره فقط");
    await expect(page.getByRole("button", { name: /استيراد .* صفاً الصالحة/ })).toBeDisabled();
    await page.getByRole("button", { name: "هذا الصحيح" }).nth(1).click();
    await page.getByRole("button", { name: "اعتماد القرارات" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-10",
      state: "partial",
      texts: fromFrame("SYS-10", "partial", [
        "تقرير ما لن يُستورد",
        "لا نرفض الملف كلّه",
        "المكرر داخل الملف",
        "استيراد",
        "صفاً الصالحة",
        "بعد الاستيراد تُعرض نتيجة مكتوبة: كم دخل، كم رُفض، وأين ملف المرفوضات. لا رسالة «تم» مجرّدة.",
      ]),
    });
    await expect(root).toContainText("6 صف: 3 سليم، 3 مرفوض.");
    expect(calls).toContain('decide:{"7":"keep"}');
    // انقطاع بعد صف ثم استئناف
    await page.getByRole("button", { name: "محاكاة انقطاع بعد صف" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-10",
      state: "server_error",
      texts: fromFrame("SYS-10", "server_error", [
        "انقطع أثناء الكتابة",
        "ثم انقطع. الملف نصف مستورد.",
        "الاستئناف بالبصمة",
        "نعرف ما كُتب ببصمة كل صف، فنستأنف من",
        "ولا تكرارها.",
      ]),
    });
    await expect(root).toContainText("كُتب 1 من 3 ثم انقطع");
    await page.getByRole("button", { name: "استئناف" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-10",
      state: "success",
      texts: fromFrame("SYS-10", "success", [
        "اكتمل الاستيراد",
        "والأهم: بصمة الملف محفوظة — رفعه ثانيةً يُكتشف ولا يُضاعف.",
        "التراجع",
        "ساعة ما لم تُباع أصنافها. بعدها يصير جزءاً من الدفتر.",
        "تنزيل المرفوضات لتصحيحها",
      ]),
    });
    await expect(root).toContainText("2 صنفاً أُضيف و1 حُدّث و3 رُفض");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "تنزيل المرفوضات لتصحيحها" }).click();
    expect((await download).suggestedFilename()).toBe("rejected-أصناف-سبتمبر.csv");
    await page.getByRole("button", { name: "التراجع عن الدفعة" }).click();
    await expect(root).toContainText("تراجعت الدفعة");
    expect(calls.filter((c) => c.startsWith("apply"))).toEqual(["apply:1", "apply:all"]);
    expect(calls).toContain("revert");
  });
});
