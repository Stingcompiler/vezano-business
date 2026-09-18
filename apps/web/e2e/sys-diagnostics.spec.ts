import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.36 — SYS-04 انخفاض التخزين أو فشل استدامته (3) + SYS-11 الدعم والتشخيص (4). بالأيام لا
 * بالميجابايت؛ نمنع قبل الحفظ لا بعده — لا نجاح كاذب؛ المعاملات لا تُحذف لتحرير مساحة؛ التقرير معروض
 * قبل الإرسال بلا أسماء ولا مبالغ؛ الإرسال قرار المالك.
 */
const json = (status: number, body: unknown) => ({ status, json: body });
const MB = 1024 * 1024;

const at = (h: number, m: number, daysAgo = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

interface OpSeed {
  readonly id: string;
  readonly state: "local" | "synced" | "quarantined";
  readonly attempts: readonly Record<string, unknown>[];
}

/** يزوّر `navigator.storage.estimate` قبل تحميل الصفحة — المساحة المتبقية بالبايت. */
async function mockStorage(page: Page, free: number, persisted = true) {
  await page.addInitScript(
    ({ free, persisted }) => {
      const quota = 500 * 1024 * 1024;
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: {
          estimate: () => Promise.resolve({ usage: quota - free, quota }),
          persisted: () => Promise.resolve(persisted),
          persist: () => Promise.resolve(persisted),
        },
      });
    },
    { free, persisted },
  );
}

async function seed(page: Page, role: "owner" | "cashier", ops: readonly OpSeed[]) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ role, ops }) => {
      const req = indexedDB.open("sting-bootstrap");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(new Error(String(req.error)));
      });
      await new Promise<void>((res) => {
        const tx = db.transaction(["meta", "operations"], "readwrite");
        const m = tx.objectStore("meta");
        const o = tx.objectStore("operations");
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
            userName: role === "owner" ? "سالم" : "سميرة ع.",
            roleName: role === "owner" ? "مالك" : "كاشير",
            roleCode: role,
          }),
        });
        m.put({ key: "diag.print_failures", value: JSON.stringify([new Date().toISOString()]) });
        let seq = 1;
        for (const s of ops) {
          o.put({
            operationId: s.id,
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [],
            state: s.state,
            createdLocalSeq: seq++,
            snapshotRelation: "none",
          });
          m.put({ key: `sync.attempts:${s.id}`, value: JSON.stringify(s.attempts) });
        }
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { role, ops },
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
  {
    id: "op-old",
    state: "synced",
    attempts: [
      { at: at(9, 0, 20), event: "saved" },
      { at: at(9, 0, 20), event: "sent" },
      { at: at(9, 0, 20), event: "accepted" },
    ],
  },
  {
    id: "op-err",
    state: "quarantined",
    attempts: [
      { at: at(9, 12), event: "saved" },
      { at: at(9, 12), event: "sent" },
      { at: at(9, 12), event: "transient", status: 503, code: "server_error" },
      { at: at(9, 21), event: "sent" },
      { at: at(9, 21), event: "rejected", code: "validation" },
    ],
  },
  { id: "op-pending", state: "local", attempts: [{ at: at(8, 0, 1), event: "saved" }] },
];

test.describe("SYS-04", () => {
  test("ready: بالأيام لا بالميجابايت؛ ما يشغل المساحة؛ التنظيف الآمن لا يلمس معلّقاً؛ معلّق > 6 ساعات", async ({
    page,
  }, info) => {
    await mockStorage(page, 420 * MB);
    await seed(page, "owner", OPS);
    await login(page, "/sync/storage");
    await expectFrame(page, info, {
      screenId: "SYS-04",
      state: "ready",
      texts: fromFrame("SYS-04", "ready", [
        "مساحة الجهاز",
        "كم بقي، وكم يكفي من أيام البيع بمعدّلك، وما الذي يشغل المساحة — والصور أولها غالباً.",
        "بالأيام لا بالميجابايت",
        "التنظيف الآمن",
        "صور الأصناف تُحذف محلياً وتبقى على الخادم؛ الفواتير المؤكَّدة القديمة كذلك. لا نعرض زرّ تنظيف يلمس معلّقاً.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-04"]');
    await expect(root).toContainText("420 ميجابايت");
    await expect(root).toContainText(/يكفي \d+ أيام بيع بمعدّلك/);
    await expect(root).toContainText("تخزين مستديم");
    await expect(root).toContainText("معلّق منذ أكثر من 6 ساعات");
    await expect(root).toContainText("عمليات مؤكدة1");
    await expect(root).toContainText("عمليات معلّقة1");
    await page.getByRole("button", { name: /فرّغ .* بحذف الصور المحلية/ }).click();
    await expect(root).toContainText("حُذفت سجلات 1 عملية مؤكدة قديمة — المعاملات نفسها باقية.");
    await expect(root).toContainText("عمليات معلّقة1");
  });

  test("validation_error: المساحة دون الحدّ الآمن — نمنع قبل الحفظ لا بعده", async ({
    page,
  }, info) => {
    await mockStorage(page, 12 * MB);
    await seed(page, "owner", OPS);
    await login(page, "/sync/storage?blocked=sale");
    await expectFrame(page, info, {
      screenId: "SYS-04",
      state: "validation_error",
      texts: fromFrame("SYS-04", "validation_error", [
        "المساحة لا تكفي لعملية",
        "محاولة حفظ فاتورة والمساحة أقلّ من الحدّ الآمن. نمنع قبل الحفظ لا بعده.",
        "لا نجاح كاذب",
        "الأسوأ من المنع أن نقبل ثم نفقد. المنع مؤلمٌ لحظةً، والفقد يُكتشف بعد أسبوع.",
        "مخرج فوري",
        "بحذف الصور المحلية",
      ]),
    });
    await expect(page.locator('[data-screen="SYS-04"]')).toContainText("12 ميجابايت");
  });

  test("server_error: المتبقي أقل من 40 وآخر محاولتي كتابة فشلتا — ما يتوقف وما يستمر", async ({
    page,
  }, info) => {
    await mockStorage(page, 12 * MB, false);
    await seed(page, "owner", OPS);
    await login(page, "/sync/storage");
    // فشل كتابتين: العدّاد في الذاكرة — يُغذّى من مسارات الحفظ؛ هنا نحاكيه عبر واجهة الاختبار
    await page.evaluate(() => {
      const w = window as unknown as { __stingWriteFail?: () => void };
      w.__stingWriteFail?.();
      w.__stingWriteFail?.();
    });
    await expectFrame(page, info, {
      screenId: "SYS-04",
      state: "server_error",
      texts: fromFrame("SYS-04", "server_error", [
        "مساحة الجهاز على وشك النفاد",
        "ميغابايت. آخر محاولتي كتابة فشلتا.",
        "لن تظهر رسالة «تم الحفظ» ما دامت الكتابة تفشل.",
        "البديل الآمن: تصدير نسخة إلى ذاكرة خارجية ثم تفريغ المرفقات القديمة. المعاملات نفسها لا تُحذف لتحرير مساحة أبداً.",
        "يتوقف",
        "إرفاق صور بالفواتير والمستندات الجديدة",
        "البيع بالذمة — لأن قيده قد لا يُكتب، ودَين بلا قيد خسارة",
        "يستمر",
        "البيع النقدي بإيصال مختصر يُكتب في مساحة محجوزة سلفاً",
        "قراءة التقارير والكشوف المحفوظة",
      ]),
    });
    await expect(page.locator('[data-screen="SYS-04"]')).toContainText("غير مستديم — قد يُمحى");
  });
});

test.describe("SYS-11", () => {
  test("ready → success: ما يُرسل بالضبط معروض قبل الإرسال؛ لا أسماء ولا مبالغ؛ رقم مرجعي", async ({
    page,
  }, info) => {
    await mockStorage(page, 420 * MB);
    await seed(page, "owner", OPS);
    const sent: Record<string, unknown>[] = [];
    await page.route("**/api/support/reports", (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      sent.push(body);
      return route.fulfill(
        json(201, {
          reference: "SUP-260918-0001",
          created_at: new Date().toISOString(),
          sent_keys: Object.keys(body["payload"] as object).sort(),
        }),
      );
    });
    await login(page, "/support");
    await expectFrame(page, info, {
      screenId: "SYS-11",
      state: "ready",
      texts: fromFrame("SYS-11", "ready", [
        "الدعم والتشخيص",
        "ما يُرسل إلى الدعم. القاعدة الحاكمة: لا أسرار ولا بيانات مستأجر آخر ولا مبالغ.",
        "ما يُرسل بالضبط، معروض قبل الإرسال",
        "يُرسل",
        "إصدار التطبيق ونوع الجهاز ومساحته الحرة",
        "سجلّ الأخطاء التقنية آخر 48 ساعة ومعرّفات العمليات المتعثّرة",
        "لا يُرسل",
        "أسماء الأطراف وأرقام هواتفهم وأرصدتهم",
        "مبالغ الفواتير وتفاصيل الأصناف والأسعار",
        "أسماء الزبائن والأرقام والمبالغ",
        "لا تُرسل افتراضياً",
        ". لو احتاجها الدعم يطلبها بتذكرة، وتُرفق بموافقتك لمرة واحدة تنتهي بإغلاق التذكرة.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    const root = page.locator('[data-screen="SYS-11"]');
    await expect(root).toContainText("2 خطأ · معلّق 1 · محجوز 1 · فشل طباعة 1");
    await expect(root).toContainText("rejected validation · op operr");
    await page.getByLabel("ملاحظة للدعم (اختياري)").fill("الطابعة");
    await page.getByRole("button", { name: "إرسال التقرير" }).click();
    await expectFrame(page, info, {
      screenId: "SYS-11",
      state: "success",
      texts: fromFrame("SYS-11", "success", [
        "أُرسل التقرير",
        "رقم مرجعي يُقال لموظف الدعم، ومعه بالضبط ما أُرسل: سجل الأخطاء، إصدار التطبيق، حالة المزامنة.",
        "وما لم يُرسل",
        "نعدّده صراحةً: لا فواتير ولا مبالغ ولا أسماء عملاء ولا رموز دخول. الثقة تُبنى بقول ما لم نأخذه لا بقول ما أخذنا.",
      ]),
    });
    await expect(root).toContainText("SUP-260918-0001");
    expect(sent).toHaveLength(1);
    const payload = sent[0]!["payload"] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "app",
      "device",
      "errors",
      "generated_at",
      "print_failures",
      "storage",
      "sync",
    ]);
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/سميرة|سالم|amount|invoice_number|party/);
    expect((payload["errors"] as unknown[]).length).toBe(2);
    expect(sent[0]!["note"]).toBe("الطابعة");
  });

  test("empty: لا أخطاء في سبعة أيام — «أرسل تقريراً على أي حال»", async ({ page }, info) => {
    await mockStorage(page, 420 * MB);
    await seed(page, "owner", [OPS[0]!]);
    await login(page, "/support");
    await expectFrame(page, info, {
      screenId: "SYS-11",
      state: "empty",
      texts: fromFrame("SYS-11", "empty", [
        "لا شيء يُبلَّغ عنه",
        "لا أخطاء مسجّلة في آخر سبعة أيام. الشاشة تُفتح غالباً بطلب موظف الدعم لا بمبادرة المستخدم.",
        "المخرج قائم",
        "«أرسل تقريراً على أي حال» — فالمشكلة قد تكون سلوكاً خاطئاً لا خطأً مسجّلاً.",
      ]),
    });
    await expect(page.getByRole("button", { name: "أرسل تقريراً على أي حال" })).toBeEnabled();
  });

  test("permission_denied: الموظف يُنشئ التقرير ويحفظه محلياً ويطلب من المالك إرساله", async ({
    page,
  }, info) => {
    await mockStorage(page, 420 * MB);
    await seed(page, "cashier", OPS);
    await login(page, "/support");
    await expectFrame(page, info, {
      screenId: "SYS-11",
      state: "permission_denied",
      texts: fromFrame("SYS-11", "permission_denied", [
        "الإرسال للمالك",
        "التقرير يحوي بنية بيانات المنشأة وأسماء فروعها وأجهزتها. إرساله خارج المنشأة قرار مالكها.",
        "ما يفعله الموظف",
        "يُنشئ التقرير ويحفظه محلياً ويطلب من المالك إرساله. عمله في التشخيص لا يُهدر.",
      ]),
    });
    await expect(page.getByRole("button", { name: "أرسل تقريراً على أي حال" })).toBeDisabled();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "إنشاء التقرير وحفظه محلياً" }).click();
    expect((await download).suggestedFilename()).toMatch(/^sting-support-.*\.json$/);
    await expect(page.locator('[data-screen="SYS-11"]')).toContainText(
      "حُفظ التقرير محلياً — اطلب من المالك إرساله",
    );
  });
});
