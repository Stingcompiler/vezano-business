import { expect, type Page, test } from "@playwright/test";

import { expectFrame } from "./frame-match";
import { fromFrame } from "./frame-provenance";

/**
 * T1.42 — WEB-03 ربط طابعة ويب وتجربة عربية (4). القدرة تُفحص قبل الزر (R-09)؛ BLE فقط عبر
 * Web Bluetooth؛ قياس ورق لا يناسب يُمنع قبل الطباعة؛ بعد الإرسال نسأل عن النتيجة ولا نفترض؛
 * الطرازات من بيانات خارجية ولا نَعِد بكل طابعة (G-10؛ ACC-83 لا يُدّعى قبل ورقة).
 */
const json = (status: number, body: unknown) => ({ status, json: body });

interface Printer {
  id: string;
  name: string;
  conn: "ble" | "usb" | "network";
  width: 58 | 80 | "a4";
  ble?: { id: string; name: string; profileId: string };
  lastTest?: { at: string; mode: "text" | "image"; result: "ok" | "failed" | "sent" | "unknown" };
}

async function seed(page: Page, printers: Printer[] = []) {
  await page.goto("/welcome");
  await page.evaluate(async (printers) => {
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
      m.put({ key: "print.printers", value: JSON.stringify(printers) });
      tx.oncomplete = () => res();
    });
    db.close();
  }, printers);
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

interface BleFake {
  available?: boolean;
  pair?: { id: string; name: string; profileId: string } | null;
  outcome?: "printed" | "failed" | "unknown";
}

/** بلوتوث وهمي يُثبَّت قبل سكربت الصفحة — لا Web Bluetooth في Chromium بلا رأس. */
async function fakeBle(page: Page, fake: BleFake) {
  await page.addInitScript((fake) => {
    const w = window as unknown as { __stingBleFake?: (f: BleFake) => void };
    let installed = false;
    Object.defineProperty(w, "__stingBleFake", {
      configurable: true,
      get: () => undefined,
      set: (fn: (f: BleFake) => void) => {
        Object.defineProperty(w, "__stingBleFake", {
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

const YESTERDAY = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(17, 40, 0, 0);
  return d.toISOString();
};
const TODAY = () => {
  const d = new Date();
  d.setHours(13, 5, 0, 0);
  return d.toISOString();
};

test.describe("WEB-03", () => {
  test("ready: لا Web Bluetooth → لا زر (R-09)؛ الطرازات من بيانات خارجية بلا وعد؛ صفحة التجربة معروضة", async ({
    page,
  }, info) => {
    await fakeBle(page, { available: false });
    await seed(page);
    await login(page, "/print");
    await expectFrame(page, info, {
      screenId: "WEB-03",
      state: "ready",
      texts: fromFrame("WEB-03", "ready", [
        "ربط طابعة ويب وتجربة عربية",
        "الطباعة من المتصفح أضعف من الأصلية. ثلاث حالات ناقصة.",
        "الطابعة والتجربة العربية",
        "تجربةٌ بنصّ عربي متصل ورقم لاتيني وباركود معاً — لأن العطب يظهر في أحدها لا في كلّها.",
        "طرازات مثبتة بالاختبار",
        "نعرض ما جُرّب فعلاً ولا نَعِد بكل طابعة (G-10).",
      ]),
      styles: [[".cat-head__title", "color", "brand.strong"]],
    });
    await expect(page.getByRole("button", { name: "ربط طابعة بلوتوث (BLE)" })).toHaveCount(0);
    await expect(page.locator('[data-screen="WEB-03"]')).toContainText(
      "لا نعرض زراً لقدرة لا نملكها",
    );
    // الطرازات بيانات خارجية: الملف يُجلب لا يُضمَّن — ولا طراز مثبت بعد
    const models = await page.request.get("/printers/models.json");
    const data = (await models.json()) as { profiles: unknown[]; tested: unknown[] };
    expect(data.profiles.length).toBeGreaterThan(0);
    expect(data.tested).toEqual([]);
    await expect(page.locator('[data-screen="WEB-03"]')).toContainText("لم يُثبَّت طراز بعد");
    // صفحة التجربة منقّطة (صورة raster) ونصّها
    await expect(page.locator(".web03-print__image")).toHaveAttribute("src", /^data:image\/png/);
    await expect(page.locator(".web03-print")).toContainText("بقالة النيل — تجريبي");
    await expect(page.locator(".web03-print")).toContainText("شكراً لتعاملكم معنا");
  });

  test("ready → success → ok: ربط طابعة BLE، إرسال صفحة التجربة، السؤال عن النتيجة ثم «تجربتك: سليمة»", async ({
    page,
  }, info) => {
    await fakeBle(page, {
      available: true,
      pair: { id: "dev-1", name: "طابعة حرارية 80مم — الكاشير 1", profileId: "ble-18f0" },
      outcome: "printed",
    });
    await seed(page);
    await login(page, "/print");
    const root = page.locator('[data-screen="WEB-03"]');
    await page.getByRole("button", { name: "ربط طابعة بلوتوث (BLE)" }).click();
    await expect(root).toContainText("طابعة حرارية 80مم — الكاشير 1");
    await expect(root).toContainText("غير مجرَّبة");
    await expect(root).toContainText("لم تُجرَّب");
    await page.getByRole("button", { name: "طباعة صفحة تجربة" }).click();
    await expectFrame(page, info, {
      screenId: "WEB-03",
      state: "success",
      texts: fromFrame("WEB-03", "success", [
        "طُبعت التجربة",
        "نسأل عن النتيجة: هل اتصلت الحروف؟ هل ظهر الباركود؟ الجواب يضبط الإعداد.",
        "لا نفترض",
        "المتصفح يقول «أُرسل للطباعة» ولا يعرف ما خرج. سؤالٌ واحد أصدق من ادّعاء.",
      ]),
    });
    // لا نجاح قبل تأكيد البنود الأربعة بالعين
    await expect(page.getByRole("button", { name: "تجربتك: سليمة" })).toBeDisabled();
    for (const c of [
      "الحروف متصلة كما تُكتب، غير مقطّعة",
      "السطر يبدأ من اليمين",
      "الأرقام والمبلغ مقروءان وغير مقلوبين",
      "لا مربعات فارغة مكان أي حرف",
    ])
      await page.getByLabel(c).check();
    await page.getByRole("button", { name: "تجربتك: سليمة" }).click();
    await expect(root).toHaveAttribute("data-state", "ready");
    await expect(root).toContainText("تجربتك: سليمة");
    await expect(root).toContainText(
      "التشكيل والاتجاه صحيحان على ورقة التجربة، وأكّدها أمين الصندوق بعينه.",
    );
    await expect(root).toContainText("اليوم");
    await expect(page.getByRole("button", { name: "إعادة التجربة" })).toBeVisible();
    // النتيجة محفوظة على الجهاز (الجلسة في الذاكرة فقط — دخول جديد بعد إعادة التحميل)
    await page.reload();
    await login(page, "/print");
    await expect(root).toContainText("تجربتك: سليمة");
  });

  test("validation_error: قياس الورق لا يناسب — نمنع قبل الطباعة", async ({ page }, info) => {
    await fakeBle(page, { available: false });
    await seed(page, [
      { id: "sys-1", name: "طابعة مكتبية A4 — الإدارة", conn: "network", width: "a4" },
    ]);
    await login(page, "/print");
    await page.getByRole("button", { name: "طباعة صفحة تجربة" }).click();
    await expectFrame(page, info, {
      screenId: "WEB-03",
      state: "validation_error",
      texts: fromFrame("WEB-03", "validation_error", [
        "قياس الورق لا يناسب",
        "نمنع قبل الطباعة",
        "الطباعة الخاطئة تُتلف ورقاً ووقتاً أمام الزبون، ولا تُكتشف إلا بعد خروجها.",
      ]),
    });
    await expect(page.locator('[data-screen="WEB-03"]')).toContainText("ملم والمختار A4.");
    await expect(page.locator('[data-screen="WEB-03"]')).toContainText("لم تُجرَّب");
  });

  test("server_error: لوحة الطابعات — سليمة/فشلت/غير مجرَّبة، و«تجربة نمط صورة» بعد فشل النص", async ({
    page,
  }, info) => {
    await fakeBle(page, { available: false });
    await seed(page, [
      {
        id: "sys-1",
        name: "طابعة حرارية 80مم — الكاشير 1",
        conn: "usb",
        width: 80,
        lastTest: { at: YESTERDAY(), mode: "text", result: "ok" },
      },
      {
        id: "sys-2",
        name: "طابعة حرارية 58مم — الكاشير 2",
        conn: "usb",
        width: 58,
        lastTest: { at: TODAY(), mode: "text", result: "failed" },
      },
      { id: "sys-3", name: "طابعة مكتبية A4 — الإدارة", conn: "network", width: "a4" },
    ]);
    await login(page, "/print");
    await expectFrame(page, info, {
      screenId: "WEB-03",
      state: "server_error",
      texts: fromFrame("WEB-03", "server_error", [
        "طابعات هذا الجهاز",
        "نطبع صفحة تجربة عربية ونسألك عن النتيجة. الحكم حكمك لا حكمنا.",
        "الطابعة",
        "نتيجة التجربة العربية",
        "آخر تجربة",
        "الإجراء",
        "طابعة حرارية 80مم — الكاشير 1",
        "USB · تعريف النظام",
        "التشكيل والاتجاه صحيحان على ورقة التجربة، وأكّدها أمين الصندوق بعينه.",
        "إعادة التجربة",
        "تجربتك: سليمة",
        "طابعة حرارية 58مم — الكاشير 2",
        "الحروف ظهرت مقطّعة ومعكوسة الاتجاه. هذه مشكلة خطوط الطابعة لا مشكلة نصك.",
        "تجربة نمط صورة",
        "تجربتك: فشلت",
        "طابعة مكتبية A4 — الإدارة",
        "شبكة",
        "لم تُجرَّب",
        "متاحة للنظام ولم نطبع عليها تجربة عربية بعد. لن نصفها بمدعومة قبل ورقة.",
        "طباعة صفحة تجربة",
        "غير مجرَّبة",
        "لماذا لا نقول «مدعومة»؟",
        "نعرض نتيجة تجربتك على جهازك، لا قائمة توافق مخترعة.",
        "صفحة التجربة — ما نطبعه ونسألك أن تتحققه",
        "بقالة النيل — تجريبي",
        "سكر أبيض · 2 كغ",
        "الإجمالي",
        "200.00",
        "شكراً لتعاملكم معنا",
        "الحروف متصلة كما تُكتب، غير مقطّعة",
        "السطر يبدأ من اليمين",
        "الأرقام والمبلغ مقروءان وغير مقلوبين",
        "لا مربعات فارغة مكان أي حرف",
      ]),
    });
    const root = page.locator('[data-screen="WEB-03"]');
    await expect(root).toContainText("أمس");
    await expect(root).toContainText("اليوم");
    // فشل النص → تجربة نمط صورة (raster) عبر حوار النظام، ثم السؤال
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    await page.getByRole("button", { name: "تجربة نمط صورة" }).click();
    await expect(root).toHaveAttribute("data-state", "success");
    await expect(page.locator("#web03-print-area")).toHaveAttribute("data-mode", "image");
    await page.getByRole("button", { name: "تجربتك: فشلت" }).click();
    await expect(root).toHaveAttribute("data-state", "server_error");
    await expect(root).toContainText("لم تخرج الورقة أو خرجت ناقصة");
  });

  test("server_error: فشل النقل عبر BLE = failed؛ انقطاع بعد الإرسال = unknown بلا إعادة تلقائية", async ({
    page,
  }) => {
    await fakeBle(page, { available: true, outcome: "failed" });
    await seed(page, [
      {
        id: "ble-1",
        name: "طابعة BLE",
        conn: "ble",
        width: 80,
        ble: { id: "dev-1", name: "طابعة BLE", profileId: "ble-18f0" },
      },
    ]);
    await login(page, "/print");
    const root = page.locator('[data-screen="WEB-03"]');
    await page.getByRole("button", { name: "طباعة صفحة تجربة" }).click();
    await expect(root).toHaveAttribute("data-state", "server_error");
    await expect(root).toContainText("تعذّر الاتصال بالطابعة");
    await page.evaluate(() => {
      (window as unknown as { __stingBleFake: (f: unknown) => void }).__stingBleFake({
        available: true,
        outcome: "unknown",
      });
    });
    await page.getByRole("button", { name: "إعادة التجربة" }).click();
    await expect(root).toHaveAttribute("data-state", "server_error");
    await expect(root).toContainText(
      "انقطع الاتصال بعد الإرسال — لا نعيد تلقائياً كي لا تتكرر ورقة.",
    );
    await expect(root).toContainText("لم تتأكد الطباعة");
  });
});
