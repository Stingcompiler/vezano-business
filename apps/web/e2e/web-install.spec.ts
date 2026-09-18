import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.40 — WEB-01 تثبيت PWA أو عدم دعم التثبيت (4). تعليمات حسب البيئة لا زر وهمي؛ من رفض لا يُسأل
 * ثانيةً في الجلسة نفسها؛ عامل خدمة يخزّن الهيكل والأصول ولا يخزّن ردود API؛ التحديث لا يفقد المعلّق
 * ولا يُطبَّق من تحت يد المستخدم (ACC-93).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

async function seed(page: Page, pending = 0) {
  await page.goto("/welcome");
  await page.evaluate(
    async ({ pending }) => {
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
        for (let i = 0; i < pending; i++)
          o.put({
            operationId: `op-${i}`,
            kind: "sale",
            opVersion: 1,
            dependencies: [],
            members: [],
            state: "local",
            createdLocalSeq: i + 1,
            snapshotRelation: "none",
          });
        tx.oncomplete = () => res();
      });
      db.close();
    },
    { pending },
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

/** يزوّر `beforeinstallprompt` كما يطلقه Chrome/Android مع نتيجة محدَّدة. */
async function fireInstallPrompt(page: Page, outcome: "accepted" | "dismissed") {
  await page.evaluate((outcome) => {
    const e = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    e.prompt = () => Promise.resolve();
    e.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(e);
  }, outcome);
}

test.describe("WEB-01", () => {
  test("ready → success: التثبيت متاح على Chrome/Android؛ الرفض لا يُعاد في الجلسة؛ القبول = ثُبّت", async ({
    page,
  }, info) => {
    await seed(page);
    await login(page, "/install");
    const root = page.locator('[data-screen="WEB-01"]');
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "تثبيت التطبيق" })).toBeDisabled();
    await fireInstallPrompt(page, "dismissed");
    await expectFrame(page, info, {
      screenId: "WEB-01",
      state: "ready",
      texts: fromFrame("WEB-01", "ready", [
        "تثبيت PWA أو عدم دعم التثبيت",
        "الويب هو الطريق الأول لأغلب المحلات.",
        "Chrome · Android · مدعوم",
        "التثبيت متاح",
        "متصفحك يدعم التثبيت. التطبيق المثبَّت يعمل بلا اتصال ويحفظ العمليات محلياً حتى تعود الشبكة.",
        "التثبيت لا يُنشئ حساباً جديداً ولا ينقل بياناتك — هو نفس التطبيق باختصار على شاشتك.",
        "تثبيت التطبيق",
        "الفرق المُعلن",
        "المتصفح قد يمسح تخزينه تحت ضغط المساحة، والمثبَّت أثبت. نقولها عند اقتراح التثبيت — سببٌ حقيقي لا إلحاح.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await page.getByRole("button", { name: "تثبيت التطبيق" }).click();
    // رفض: لا يُسأل ثانيةً في الجلسة — الزر معطّل بسببه والمدخل يبقى
    await expect(page.getByRole("button", { name: "تثبيت التطبيق" })).toBeDisabled();
    await expect(root).toContainText("رفضتَ التثبيت في هذه الجلسة");
    await fireInstallPrompt(page, "accepted"); // متصفح أعاد العرض من قائمته
    await expect(page.getByRole("button", { name: "تثبيت التطبيق" })).toBeDisabled(); // ما زال مرفوضاً في الجلسة
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expectFrame(page, info, {
      screenId: "WEB-01",
      state: "success",
      texts: fromFrame("WEB-01", "success", [
        "ثُبّت",
        "صار أيقونةً على الشاشة. نقول ما تغيّر: يفتح بلا متصفح، ويعمل بلا اتصال، والتخزين أثبت.",
        "لا تكرار للطلب",
        "من رفض التثبيت لا يُسأل ثانيةً في الجلسة نفسها، والمدخل يبقى في الإعدادات.",
      ]),
    });
  });

  test("offline: يعمل بلا اتصال بعد التثبيت — الفرق المُعلن", async ({ page }, info) => {
    await seed(page);
    await login(page, "/install");
    await page.context().setOffline(true);
    await expectFrame(page, info, {
      screenId: "WEB-01",
      state: "offline",
      texts: fromFrame("WEB-01", "offline", [
        "يعمل بلا اتصال بعد التثبيت",
        "المثبَّت يفتح ويبيع بلا شبكة؛ وغير المثبَّت في المتصفح كذلك بعد أول زيارة.",
        "الفرق المُعلن",
        "المتصفح قد يمسح تخزينه تحت ضغط المساحة، والمثبَّت أثبت. نقولها عند اقتراح التثبيت — سببٌ حقيقي لا إلحاح.",
      ]),
    });
    await page.context().setOffline(false);
  });

  test.describe("iOS", () => {
    test.use({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    test("ready (Safari · iOS): تعليمات التثبيت اليدوي بخطوتين — لا زر وهمي", async ({
      page,
    }, info) => {
      await seed(page);
      await login(page, "/install");
      await expectFrame(page, info, {
        screenId: "WEB-01",
        state: "ready",
        texts: fromFrame("WEB-01", "ready", [
          "Safari · iOS · تثبيت يدوي",
          "التثبيت بخطوتين من المتصفح",
          "متصفحك لا يعطي التطبيقات زر تثبيت. الإضافة إلى الشاشة الرئيسية تتم من قائمة المتصفح نفسه.",
          "افتح قائمة المشاركة في شريط المتصفح",
          "اختر «إضافة إلى الشاشة الرئيسية»",
          "أكد الاسم ثم افتح التطبيق من أيقونته",
          "لا نضع زراً يقول «تثبيت» ثم لا يفعل شيئاً. التعليمات تتغيّر حسب متصفحك ونسخته.",
          "عرض التعليمات بالصور",
        ]),
      });
      await expect(page.getByRole("button", { name: "تثبيت التطبيق" })).toHaveCount(0);
    });
  });

  test.describe("in-app browser", () => {
    test.use({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/450.0]",
    });
    test("permission_denied: متصفح داخل تطبيق — غير مدعوم، نقولها بدل زر لا يعمل", async ({
      page,
    }, info) => {
      await seed(page);
      await login(page, "/install");
      await expectFrame(page, info, {
        screenId: "WEB-01",
        state: "permission_denied",
        texts: fromFrame("WEB-01", "permission_denied", [
          "متصفح داخل تطبيق · غير مدعوم",
          "التثبيت والإشعار غير متاحين هنا",
          "فتحتَ الرابط داخل متصفح مدمج في تطبيق آخر. هذه البيئة لا تسمح بالتثبيت ولا بإشعارات الويب، وقد تمحو ما يُحفظ محلياً دون إشعار.",
          "افتح الرابط في متصفح الجهاز الأساسي",
          "سجّل الدخول هناك ثم ثبّت التطبيق",
          "حتى ذلك الحين يعمل كل شيء عدا التثبيت والإشعار والعمل بلا اتصال. لا نطلب إذناً سيُرفض تلقائياً.",
          "نسخ الرابط لفتحه في المتصفح",
        ]),
      });
      await expect(page.getByRole("button", { name: "تثبيت التطبيق" })).toHaveCount(0);
    });
  });

  test("عامل الخدمة: يخزّن الهيكل والأصول ولا يخزّن ردود API؛ التحديث لا يُطبَّق مع معلّق (ACC-93)", async ({
    page,
    browserName,
  }, info) => {
    test.skip(browserName !== "chromium", "Service Worker في Chromium");
    await seed(page, 2);
    await page.route("**/api/sync/status", (route) =>
      route.fulfill(
        json(200, {
          server_time: "",
          sync_epoch: "epoch-A",
          server_seq_high: "1",
          quarantined: 0,
          conflicted: 0,
          last_accepted_at: null,
        }),
      ),
    );
    await login(page, "/install?sw=1");
    const swInfo = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      // نضمن أن العامل يتحكم بالصفحة ثم نطلب أصلاً وردّ API ونفحص المخزَّن
      await fetch("/manifest.webmanifest");
      await fetch("/api/sync/status").catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
      const keys = await caches.keys();
      const shell = await caches.open(keys.find((k) => k.endsWith("-shell")) ?? "none");
      const assets = await caches.open(keys.find((k) => k.endsWith("-assets")) ?? "none");
      const shellKeys = (await shell.keys()).map((r) => new URL(r.url).pathname);
      const assetKeys = (await assets.keys()).map((r) => new URL(r.url).pathname);
      const apiCached = [...shellKeys, ...assetKeys].some((p) => p.startsWith("/api/"));
      return { scope: reg.scope, keys, shellKeys, apiCached, assetCount: assetKeys.length };
    });
    expect(swInfo.scope).toMatch(/\/$/);
    expect(swInfo.keys.some((k) => k.startsWith("sting-sw-"))).toBe(true);
    expect(swInfo.shellKeys).toContain("/");
    expect(swInfo.shellKeys).toContain("/manifest.webmanifest");
    expect(swInfo.apiCached).toBe(false);
    // نسخة جديدة بانتظار الإذن — ومعلّق على الجهاز: لا تُطبَّق
    await page.evaluate(() =>
      (window as unknown as { __stingSwWaiting: (f: boolean) => void }).__stingSwWaiting(true),
    );
    await expect(page.locator('[data-screen="WEB-01"]')).toContainText(
      "نسخة جديدة جاهزة — أعد التحميل",
    );
    await expect(page.locator('[data-screen="WEB-01"]')).toContainText(
      fromFrame("WEB-01", "permission_denied", [
        "العمليات المحفوظة محلياً غير المزامَنة تُقرأ بالنسخة الجديدة ولا تُمحى —",
      ])[0]!,
    );
    await page.getByRole("button", { name: "أعد التحميل" }).click();
    await expect(page.locator('[data-screen="WEB-01"]')).toContainText(
      "على الجهاز عمليات لم تُرفع بعد — التحديث ينتظر رفعها",
    );
    await expect(page).toHaveURL(/\/install\?sw=1$/); // لم يُعَد التحميل
    void info;
  });
});
