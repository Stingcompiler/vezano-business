import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";
import { navTo } from "./nav";

/**
 * T1.37 — SYS-05 تصدير نسخة محلية (5) + SYS-06 استعادة ومعاينة (6). كلمة حماية + AES-GCM (قرار
 * المالك 0002 س٤)؛ بلا أسرار؛ المعلّق مشمول وموسوم؛ نحسب المساحة قبل البدء؛ التصدير نسخٌ لا رفع؛
 * الاستعادة: رفض قبل أي كتابة (تالف / منشأة أخرى / إصدار أحدث)، معاينة الفرق، دمج بالهويات على
 * دفعات، مرتين = لا تكرار، الصنف الناقص يُحجز.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const MB = 1024 * 1024;

interface OpSeed {
  readonly id: string;
  readonly state: "local" | "synced";
  readonly item: string;
}

async function mockStorage(page: Page, free: number) {
  await page.addInitScript(
    ({ free }) => {
      const quota = 500 * 1024 * 1024;
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: {
          estimate: () => Promise.resolve({ usage: quota - free, quota }),
          persisted: () => Promise.resolve(true),
          persist: () => Promise.resolve(true),
        },
      });
    },
    { free },
  );
}

async function seed(page: Page, ops: readonly OpSeed[], items: readonly string[]) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ ops, items }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "projections", "operations"], "readwrite");
        const m = tx.objectStore("meta");
        const p = tx.objectStore("projections");
        const o = tx.objectStore("operations");
        // جهاز نظيف لكل سيناريو (جهاز بديل): لا بقايا من بذر سابق
        m.clear();
        p.clear();
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
        m.put({ key: "invoice_seq", value: "41" });
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
        m.put({
          key: "home.cache",
          value: JSON.stringify({
            savedAt: new Date().toISOString(),
            summary: { tenant_name: "بقالة النيل — تجريبي" },
          }),
        });
        for (const it of items)
          p.put({
            key: `entity:catalog.Item:${it}`,
            value: { id: it, name: "سكر", server_seq: "5" },
          });
        p.put({
          key: "entity:parties.Party:p1",
          value: { id: "p1", name: "أحمد الطيب", server_seq: "3" },
        });
        let seq = 1;
        for (const s of ops) {
          o.put({
            operationId: s.id,
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [
              {
                entity: "sales.Sale",
                id: `${s.id}-h`,
                schemaVersion: 1,
                serverSeq: null,
                payload: { invoice_number: `INV-${s.id}`, total_minor: "10000" },
              },
              {
                entity: "sales.Payment",
                id: `${s.id}-p`,
                schemaVersion: 1,
                serverSeq: null,
                payload: { method: "cash", amount_minor: "10000" },
              },
              {
                entity: "inventory.StockMovement",
                id: `${s.id}-m`,
                schemaVersion: 1,
                serverSeq: null,
                payload: { item_id: s.item, delta_base_qty_milli: "-1000" },
              },
            ],
            state: s.state,
            createdLocalSeq: seq++,
            snapshotRelation: "none",
          });
          m.put({
            key: `sync.attempts:${s.id}`,
            value: JSON.stringify([{ at: new Date().toISOString(), event: "saved" }]),
          });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { ops, items },
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

const OPS: OpSeed[] = [
  { id: "op-a", state: "synced", item: "i1" },
  { id: "op-b", state: "synced", item: "i1" },
  { id: "op-c", state: "local", item: "i1" },
];

async function exportFile(
  page: Page,
  password = "sting-2026",
): Promise<{ name: string; text: string }> {
  await page.getByLabel("كلمة الحماية").fill(password);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "حفظ بكلمة حماية" }).click();
  const d = await download;
  const path = await d.path();
  const fs = await import("node:fs/promises");
  return { name: d.suggestedFilename(), text: await fs.readFile(path, "utf8") };
}

async function chooseFile(page: Page, name: string, text: string) {
  await page.getByLabel("ملف النسخة").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(text, "utf8"),
  });
}

test.describe("SYS-05", () => {
  test("ready → saving → success: بلا أسرار، المعلّق مشمول وموسوم، كلمة حماية إلزامية، التصدير نسخٌ لا رفع", async ({
    page,
  }, info) => {
    await mockStorage(page, 420 * MB);
    await seed(page, OPS, ["i1"]);
    await login(page, "/sync/backup");
    await expectFrame(page, info, {
      screenId: "SYS-05",
      state: "ready",
      texts: fromFrame("SYS-05", "ready", [
        "تصدير نسخة محلية",
        "مخرج الطوارئ في كل شاشة تخشى الفقد. يجب أن يعمل بلا اتصال وبلا صلاحية خادمية.",
        "ما الذي يُصدَّر",
        "نطاق التصدير مُعلن: كل بياناتك المحلية — الفواتير والأطراف والأرصدة والمعلّق. وبلا أسرار: لا رموز جلسات ولا مفاتيح.",
        "يعمل بلا اتصال",
        "وهذا سبب وجوده: من فقد الشبكة أو انتهت جلسته يحتاجه أكثر من غيره.",
        "المعلّق مشمول",
        "عمليات لم تُرفع. النسخة التي تُغفل المعلّق تُطمئن كذباً.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-05"]');
    await expect(root).toContainText("النسخة تحمل دفترك كاملاً؛ من يملكها يملك أرقامك");
    await expect(root).toContainText("حفظ بكلمة حماية");
    await expect(root).toContainText("المعاملات3");
    await expect(root).toContainText("الأطراف وأرصدتها1");
    // بلا كلمة: لا يمرّ
    await page.getByRole("button", { name: "حفظ بكلمة حماية" }).click();
    await expect(page.getByLabel("كلمة الحماية")).toHaveAttribute("aria-invalid", "true");

    const file = await exportFile(page);
    expect(file.name).toMatch(/^sting-backup-\d{8}-\d{4}\.stg$/);
    const env = JSON.parse(file.text) as Record<string, unknown>;
    expect(env["format"]).toBe("sting-backup");
    expect(env["tenant_id"]).toBe("t1");
    expect(file.text).not.toContain("device.registration");
    expect(file.text).not.toContain("INV-op-a"); // المحتوى مشفَّر
    await expectFrame(page, info, {
      screenId: "SYS-05",
      state: "success",
      texts: fromFrame("SYS-05", "success", [
        "صُدّرت النسخة",
        "معلّقة — التصدير نسخٌ لا رفع.",
        "لا نخلط",
        "نقولها صراحةً لأن من صدّر قد يظنّ أنه «أنهى الموضوع». النسخة حمايةٌ من الفقد لا بديلٌ عن المزامنة.",
      ]),
    });
    await expect(root).toContainText("ما زالت العمليات 1 معلّقة");
    await expect(root).toContainText("المعاملات3");
  });

  test("validation_error → المعلّق وحده؛ server_error: فشل الرفع والملف باقٍ", async ({
    page,
  }, info) => {
    await mockStorage(page, 1024); // كيلوبايت واحد
    await seed(page, OPS, ["i1"]);
    await page.route("**/api/support/backups", (route) =>
      route.fulfill(json(500, { detail: "boom" })),
    );
    await login(page, "/sync/backup");
    await expectFrame(page, info, {
      screenId: "SYS-05",
      state: "validation_error",
      texts: fromFrame("SYS-05", "validation_error", [
        "لا مساحة للملف",
        "ميجابايت والمتاح",
        ". نحسب قبل البدء لا في منتصفه.",
        "البديل",
        "تصدير المعلّق وحده",
        "— وهو أهم ما في النسخة على أي حال.",
      ]),
    });
    await page.getByRole("button", { name: /تصدير المعلّق وحده/ }).click();
    await expect(page.locator('[data-screen="SYS-05"]')).toHaveAttribute("data-state", "ready");
    await expect(page.locator('[data-screen="SYS-05"]')).toContainText("المعاملات1");
    await exportFile(page);
    await page.getByRole("button", { name: "رفع النسخة إلى تخزين المنشأة" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-05",
      state: "server_error",
      texts: fromFrame("SYS-05", "server_error", [
        "فشل الرفع إلى التخزين",
        "اختار رفع النسخة إلى تخزين سحابي وفشل الرفع. الملف المحلي سليم.",
        "الملف باقٍ",
        "فشل قناةٍ واحدة لا يُلغي نسخةً أُنتجت.",
        "شارك يدوياً",
      ]),
    });
  });
});

test.describe("SYS-06", () => {
  test("validation_error: تالف / لمنشأة أخرى بلا كشف اسمها / إصدار أحدث — قبل أي كتابة", async ({
    page,
  }, info) => {
    await mockStorage(page, 420 * MB);
    await seed(page, OPS, ["i1"]);
    await login(page, "/sync/restore");
    await expectFrame(page, info, {
      screenId: "SYS-06",
      state: "ready",
      texts: fromFrame("SYS-06", "ready", [
        "استعادة نسخة ومعاينتها",
        "أخطر فعل في النظام: يكتب فوق دفتر قائم. خمس حالات ناقصة، كلها حراسة.",
        "معاينة قبل أي كتابة",
        "الملف قُرئ ولم يُكتب حرفٌ بعد. نعرض ما فيه: المنشأة، والتاريخ، والعدد، وما الذي سيتغيّر مقارنةً بالحالي.",
        "لا استعادة كاملة عمياء",
        "الاستعادة دمجٌ بالهويات لا إحلال. الإحلال يمحو ما عمله الجهاز بعد النسخة.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-06"]');
    await chooseFile(page, "broken.stg", "{not json");
    await expectFrame(page, info, {
      screenId: "SYS-06",
      state: "validation_error",
      texts: fromFrame("SYS-06", "validation_error", ["الملف لا يُقبل", "اختيار ملف آخر"]),
    });
    const other = {
      format: "sting-backup",
      version: 2,
      tenant_id: "t-other",
      device_id: "d9",
      exported_at: "2026-09-11T10:00:00Z",
      sync_epoch: "e",
      counts: { operations: 1, pending: 0, parties: 0, items: 0, projections: 0 },
      kdf: { name: "PBKDF2-SHA256", iterations: 1000, salt: "AAAA" },
      iv: "AAAA",
      ciphertext: "Zm9v",
    };
    await chooseFile(page, "sting-backup-0911.stg", JSON.stringify(other));
    await expect(root).toContainText(
      "رُفض الملف — لم يتغير شيء. هذه النسخة تخص منشأة أخرى. لم تُقرأ بياناتها ولم تُكتب على جهازك.",
    );
    await expect(root).toContainText("منشأة الملفلا تطابق منشأتك");
    await expect(root).toContainText("منشأتكبقالة النيل — تجريبي");
    await expect(root).toContainText(
      "لا نعرض اسم المنشأة الأخرى ولا أي محتوى من الملف — عزل المستأجرين يمنع ذلك حتى في رسالة الخطأ.",
    );
    await expect(root).not.toContainText("t-other");
    await chooseFile(page, "new.stg", JSON.stringify({ ...other, tenant_id: "t1", version: 99 }));
    await expect(root).toContainText("حدّث التطبيق ثم أعد المحاولة");
  });

  test("conflict → ready → success: معاينة الفرق، المعلّق المحلي لا يُمسّ، دمج بالهويات، مرتين = لا تكرار", async ({
    page,
  }, info) => {
    await mockStorage(page, 420 * MB);
    // جهاز المصدر: 3 عمليات → تصدير
    await seed(page, OPS, ["i1"]);
    await login(page, "/sync/backup");
    const file = await exportFile(page);
    // جهاز بديل: صنف i1 موجود، عملية معلّقة محلية خاصة به
    await seed(page, [{ id: "op-z", state: "local", item: "i1" }], ["i1"]);
    await page.goto("/login?next=%2Fsync%2Frestore");
    await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await chooseFile(page, file.name, file.text);
    const root = page.locator('[data-screen="SYS-06"]');
    await expect(root).toContainText("العدد3 عملية · 1 معلّق");
    await page.getByLabel("كلمة الحماية").fill("wrong-pass");
    await page.getByRole("button", { name: "فتح الملف ومعاينته" }).click();
    await expect(root).toContainText("كلمة الحماية غير صحيحة");
    await page.getByLabel("كلمة الحماية").fill("sting-2026");
    await page.getByRole("button", { name: "فتح الملف ومعاينته" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-06",
      state: "conflict",
      texts: fromFrame("SYS-06", "conflict", [
        "توقّف قبل الاستعادة",
        "ارفع المعلّق أولاً — الأسلم",
        "تصدير المعلّق كملف ثم المتابعة",
        "متابعة الاستعادة",
      ]),
    });
    await expect(root).toContainText("على هذا الجهاز 1 عمليات لم تصل الخادم");
    await expect(root).toContainText("INV-op-z");
    await page.getByRole("button", { name: "متابعة الاستعادة", exact: true }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("ستُضاف 3 فاتورة · ستُحدَّث 0 أرصدة · لن يُحذف شيء.");
    await page.getByRole("button", { name: "استعادة الآن" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-06",
      state: "success",
      texts: fromFrame("SYS-06", "success", [
        "اكتملت الاستعادة",
        "الكتابات الجديدة على هذا الجهاز تأخذ هوية جديدة — فلو استُعيد الملف مرتين لم يتكرّر شيء.",
        "حماية التكرار",
        "مذكورة في شاشة النجاح لا في وثيقة. من استعاد مرةً قد يعيدها ظنّاً أنها لم تكتمل.",
      ]),
    });
    await expect(root).toContainText("أُضيفت 3 عملية");
    // مرة ثانية: لا تكرار
    await page.getByRole("button", { name: "تصدير نسخة محلية" }).click();
    await expect(page).toHaveURL(/\/sync\/backup$/);
    await navTo(page, "استعادة", { exact: true });
    await expect(page).toHaveURL(/\/sync\/restore$/);
    await chooseFile(page, file.name, file.text);
    await page.getByLabel("كلمة الحماية").fill("sting-2026");
    await page.getByRole("button", { name: "فتح الملف ومعاينته" }).click();
    await page.getByRole("button", { name: "متابعة الاستعادة", exact: true }).click();
    await expect(root).toContainText("ستُضاف 0 فاتورة");
    const count = await page.evaluate(async () => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res) => (req.onsuccess = () => res(req.result)));
      const n = await new Promise<number>((res) => {
        const r = db.transaction("operations").objectStore("operations").count();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      return n;
    });
    expect(count).toBe(4);
  });

  test("partial + server_error: صنف ناقص يُحجز؛ انقطاع بعد دفعة ثم استئناف", async ({
    page,
  }, info) => {
    await mockStorage(page, 420 * MB);
    // فوق حجم الدفعة (50) كي يكون للانقطاع معنى: دفعة اكتملت ودفعة لم تبدأ
    const many: OpSeed[] = Array.from({ length: 55 }, (_, i) => ({
      id: `op-${String(i).padStart(2, "0")}`,
      state: "synced" as const,
      item: "i1",
    }));
    await seed(page, [...many, { id: "op-x", state: "synced", item: "i-gone" }], ["i1"]);
    await login(page, "/sync/backup");
    const file = await exportFile(page);
    await seed(page, [], ["i1"]);
    await page.goto("/login?next=%2Fsync%2Frestore");
    await page.getByLabel("رقم الهاتف أو البريد").fill("owner@sting.example");
    await page.getByLabel("كلمة المرور").fill("sting-demo-2026");
    await page.getByRole("button", { name: "دخول" }).click();
    await chooseFile(page, file.name, file.text);
    await page.getByLabel("كلمة الحماية").fill("sting-2026");
    await page.getByRole("button", { name: "فتح الملف ومعاينته" }).click();
    const root = page.locator('[data-screen="SYS-06"]');
    await expect(root).toContainText("1 تشير إلى صنف غير موجود وستُحجز");
    await page.getByRole("button", { name: "محاكاة انقطاع بعد دفعة" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-06",
      state: "server_error",
      texts: fromFrame("SYS-06", "server_error", [
        "انقطع أثناء الكتابة",
        "أسوأ توقيت. الدفتر الآن نصف مستعاد.",
        "لا نترك نصفاً",
        "الاستعادة تُطبَّق على دفعات قابلة للتراجع: ما اكتمل يبقى وما انقطع يُلغى كاملاً. ونعرض بالضبط أين وقفنا وزرّ استئناف.",
      ]),
    });
    await page.getByRole("button", { name: "استئناف" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-06",
      state: "partial",
      texts: fromFrame("SYS-06", "partial", ["استُعيد بعضه", "لا نخترع", "ما نجح ثابت"]),
    });
    await expect(root).toContainText("نزلت 55 فاتورة من 56؛ 1 تشير إلى صنف لم يعد موجوداً.");
  });
});
