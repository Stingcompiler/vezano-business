import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.41 — WEB-02 إذن Web Push وحالاته (4). نشرح قبل حوار المتصفح؛ الرفض لا يمنع شيئاً ولا اشتراك
 * ناجح كاذب؛ الاشتراك المنتهي يُجدَّد صامتاً إن كان الإذن قائماً؛ بعد التفعيل إشعار تجريبي فوراً
 * (ACC-107، 113). نقطة النهاية لا تُعرض في الشاشة.
 */
const json = (status: number, body: unknown) => ({ status, json: body });

const STATUS = {
  configured: true,
  public_key: "BPUBLICKEY",
  subscribed: false,
  created_at: "",
  last_used_at: "",
  expired: false,
};

async function seed(page: Page) {
  await page.goto("/welcome");
  await page.evaluate(async () => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    await new Promise<void>((res) => {
      const tx = db.transaction(["meta", "operations"], "readwrite");
      const m = tx.objectStore("meta");
      tx.objectStore("operations").clear();
      m.clear();
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
      tx.oncomplete = () => res();
    });
    db.close();
  });
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

interface Fake {
  permission?: "default" | "granted" | "denied" | "unsupported";
  request?: "granted" | "denied";
  subscription?: { endpoint: string; p256dh: string; auth: string } | null;
  subscribeFails?: boolean;
}

/** مزوّد Push وهمي يُثبَّت قبل أي سكربت للصفحة (لا خدمة Push في Chromium بلا رأس). */
async function fakePush(page: Page, fake: Fake) {
  await page.addInitScript((fake) => {
    const w = window as unknown as {
      __stingPushFakePending?: Fake;
      __stingPushFake?: (f: Fake) => void;
    };
    w.__stingPushFakePending = fake;
    let installed = false;
    Object.defineProperty(w, "__stingPushFake", {
      configurable: true,
      get: () => (installed ? undefined : undefined),
      set: (fn: (f: Fake) => void) => {
        Object.defineProperty(w, "__stingPushFake", {
          value: fn,
          configurable: true,
          writable: true,
        });
        if (!installed) {
          installed = true;
          fn(fake);
        }
      },
    });
  }, fake);
}

/** يزوّر خادم الإشعارات: الحالة تتبدّل مع الاشتراك والإلغاء، والاختبار يعيد `sent` أو سببه. */
async function mockServer(page: Page, init: Partial<typeof STATUS> = {}, testReason?: string) {
  const st = { ...STATUS, ...init };
  const calls: { path: string; body: unknown }[] = [];
  await page.route("**/api/push/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() as unknown;
    calls.push({ path, body });
    if (path.endsWith("/status")) return route.fulfill(json(200, st));
    if (path.endsWith("/subscribe")) {
      st.subscribed = true;
      st.expired = false;
      st.created_at = "2026-09-18T09:00:00Z";
      return route.fulfill(json(200, st));
    }
    if (path.endsWith("/unsubscribe")) {
      st.subscribed = false;
      return route.fulfill(json(200, st));
    }
    if (path.endsWith("/test")) {
      const sent = st.subscribed && st.configured && !testReason;
      if (sent) st.last_used_at = "2026-09-18T09:00:05Z";
      return route.fulfill(
        json(200, {
          sent,
          reason: sent
            ? undefined
            : (testReason ?? (st.subscribed ? "push_not_configured" : "not_subscribed")),
          ...st,
        }),
      );
    }
    return route.fulfill(json(404, {}));
  });
  return { st, calls };
}

test.describe("WEB-02", () => {
  test("ready → success: نشرح قبل الحوار؛ القبول = اشتراك ثم إشعار تجريبي فوراً؛ الإيقاف يعود لجاهز", async ({
    page,
  }, info) => {
    await fakePush(page, { permission: "default", request: "granted" });
    const srv = await mockServer(page);
    await seed(page);
    await login(page, "/notify");
    await expectFrame(page, info, {
      screenId: "WEB-02",
      state: "ready",
      texts: fromFrame("WEB-02", "ready", [
        "إذن Web Push وحالاته",
        "إذنٌ يُطلب مرة واحدة في عمر الموقع — فإن أُهدر لا يُستعاد بسهولة.",
        "قبل أن نطلب الإذن",
        "نشرح ما سيصل قبل أن يظهر حوار المتصفح: تنبيهات الفواتير والمخزون، لا إعلانات.",
        "طلبنا قبل طلب المتصفح",
        "لأن رفض المتصفح دائمٌ تقريباً. شاشتنا قابلة للرفض بلا ثمن، وحواره ليس كذلك.",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    // لا طلب إذن ولا اشتراك قبل التفاعل
    expect(srv.calls.filter((c) => c.path.endsWith("/subscribe"))).toHaveLength(0);
    await page.getByRole("button", { name: "تفعيل الإشعارات" }).click();
    await expectFrame(page, info, {
      screenId: "WEB-02",
      state: "success",
      texts: fromFrame("WEB-02", "success", [
        "فُعّل",
        "نُرسل إشعاراً تجريبياً فوراً — التجربة تُثبت أن القناة تعمل، والادّعاء لا يُثبت.",
        "وما لا يصل",
        "نقول إن الإشعارات لا تصل والمتصفح مغلق تماماً على بعض الأنظمة. حدٌّ تقني نعلنه لا نخفيه.",
      ]),
    });
    const sub = srv.calls.find((c) => c.path.endsWith("/subscribe"));
    expect(sub?.body).toEqual({
      endpoint: "https://push.example/fake-endpoint",
      p256dh: "fake-p256dh",
      auth: "fake-auth",
    });
    // إشعار تجريبي فوراً بعد الاشتراك — والشاشة لا تعرض نقطة النهاية
    expect(srv.calls.filter((c) => c.path.endsWith("/test"))).toHaveLength(1);
    const root = page.locator('[data-screen="WEB-02"]');
    await expect(root).toContainText("أُرسل الإشعار التجريبي");
    await expect(root).not.toContainText("push.example");
    await page.getByRole("button", { name: "إيقاف الإشعارات" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    expect(srv.calls.filter((c) => c.path.endsWith("/unsubscribe"))).toHaveLength(1);
  });

  test("ready: بلا مفاتيح VAPID لا نطلب إذناً — الزر معطّل بسببه", async ({ page }) => {
    await fakePush(page, { permission: "default", request: "granted" });
    await mockServer(page, { configured: false, public_key: "" });
    await seed(page);
    await login(page, "/notify");
    const btn = page.getByRole("button", { name: "تفعيل الإشعارات" });
    await expect(btn).toBeDisabled();
    await expect(page.locator('[data-screen="WEB-02"]')).toContainText(
      "مفاتيح الإشعارات غير مضبوطة في النشر",
    );
  });

  test("permission_denied: رفض المتصفح لا يمنع شيئاً ولا اشتراك ناجح كاذب", async ({
    page,
  }, info) => {
    await fakePush(page, { permission: "default", request: "denied" });
    const srv = await mockServer(page);
    await seed(page);
    await login(page, "/notify");
    await page.getByRole("button", { name: "تفعيل الإشعارات" }).click();
    await expectFrame(page, info, {
      screenId: "WEB-02",
      state: "permission_denied",
      texts: fromFrame("WEB-02", "permission_denied", [
        "صلاحية مرفوضة",
        "حتى ذلك الحين يعمل كل شيء عدا التثبيت والإشعار والعمل بلا اتصال. لا نطلب إذناً سيُرفض تلقائياً.",
      ]),
    });
    expect(srv.calls.filter((c) => c.path.endsWith("/subscribe"))).toHaveLength(0);
    await expect(page.getByRole("button", { name: "تفعيل الإشعارات" })).toHaveCount(0);
    // البوابة والصندوق يعملان: التنقل متاح
    await page.getByRole("button", { name: "التثبيت" }).click();
    await expect(page).toHaveURL(/\/install$/);
  });

  test.describe("in-app browser", () => {
    test.use({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 [FBAN/FB4A;FBAV/450.0]",
    });
    test("permission_denied: متصفح داخل تطبيق — لا نطلب إذناً سيُرفض تلقائياً", async ({
      page,
    }, info) => {
      await mockServer(page);
      await seed(page);
      await login(page, "/notify");
      await expectFrame(page, info, {
        screenId: "WEB-02",
        state: "permission_denied",
        texts: fromFrame("WEB-02", "permission_denied", [
          "صلاحية مرفوضة",
          "متصفح داخل تطبيق · غير مدعوم",
          "حتى ذلك الحين يعمل كل شيء عدا التثبيت والإشعار والعمل بلا اتصال. لا نطلب إذناً سيُرفض تلقائياً.",
        ]),
      });
      await expect(page.getByRole("button", { name: "تفعيل الإشعارات" })).toHaveCount(0);
    });
  });

  test("expired → success: الإذن قائم فالتجديد صامت بلا سؤال — ثم إشعار تجريبي", async ({
    page,
  }, info) => {
    await fakePush(page, { permission: "granted", subscription: null });
    const srv = await mockServer(page, { expired: true });
    await seed(page);
    await login(page, "/notify");
    await expectFrame(page, info, {
      screenId: "WEB-02",
      state: "success",
      texts: fromFrame("WEB-02", "success", ["فُعّل"]),
    });
    expect(srv.calls.filter((c) => c.path.endsWith("/subscribe"))).toHaveLength(1);
    expect(srv.calls.filter((c) => c.path.endsWith("/test"))).toHaveLength(1);
  });

  test("expired: الإذن لم يُمنح بعد فلا تجديد صامت — نشرح ثم نطلب؛ وإشعار تجريبي فاشل يقول سببه", async ({
    page,
  }, info) => {
    await fakePush(page, { permission: "default", request: "granted" });
    const srv = await mockServer(page, { expired: true }, "push_not_configured");
    await seed(page);
    await login(page, "/notify");
    await expectFrame(page, info, {
      screenId: "WEB-02",
      state: "expired",
      texts: fromFrame("WEB-02", "expired", [
        "انتهى الاشتراك",
        "اشتراك Push انتهى صلاحيته عند المزوّد — يحدث بعد شهور أو بتنظيف المتصفح.",
        "التجديد الصامت",
        "نجدّد بلا سؤال إن كان الإذن قائماً. السؤال من جديد يُخاطر بإذنٍ نملكه.",
      ]),
    });
    expect(srv.calls.filter((c) => c.path.endsWith("/subscribe"))).toHaveLength(0);
    await page.getByRole("button", { name: "تفعيل الإشعارات" }).click();
    const root = page.locator('[data-screen="WEB-02"]');
    await expect(root).toHaveAttribute("data-state", "success");
    await expect(root).toContainText("لم يُرسل: مفاتيح الإشعارات غير مضبوطة في النشر");
  });

  test("expired: الإذن قائم لكن المزوّد رفض التجديد — لا اشتراك ناجح كاذب", async ({ page }) => {
    await fakePush(page, { permission: "granted", subscribeFails: true });
    const srv = await mockServer(page, { expired: true });
    await seed(page);
    await login(page, "/notify");
    const root = page.locator('[data-screen="WEB-02"]');
    await expect(root).toHaveAttribute("data-state", "expired");
    await expect(root).toContainText("الإذن قائم — التجديد الصامت لم ينجح بعد");
    expect(srv.calls.filter((c) => c.path.endsWith("/subscribe"))).toHaveLength(0);
  });

  test("عامل الخدمة: يحمل معالجَي push وnotificationclick وبلا محتوى حساس", async ({ page }) => {
    const res = await page.request.get("/sw.js");
    const src = await res.text();
    expect(src).toContain('addEventListener("push"');
    expect(src).toContain('addEventListener("notificationclick"');
    expect(src).toContain('addEventListener("pushsubscriptionchange"');
    expect(src).toContain("showNotification");
  });
});
