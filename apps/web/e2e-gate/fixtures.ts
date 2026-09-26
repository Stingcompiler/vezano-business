import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from "@playwright/test";

/**
 * أدوات بوابة T1.43: إعادة الضبط إلى الحالة الابتدائية (§١٥.٤: عميل برصيد صفر، مخزون سكر 10،
 * صندوق صفر، جهازان)، وجهاز = سياق متصفح مستقل بتخزينه، يدخل بالحساب الحقيقي ويجهَّز بالتنزيل
 * الأول من الخادم الحقيقي — لا `page.route` في هذه المجموعة.
 */
export const OWNER = { identifier: "+249912447001", password: "sting-demo-2026", pin: "123456" };
export const CASHIER = { identifier: "cashier@sting.example", password: "sting-demo-2026" };
export const SHOP = "بقالة النيل — تجريبي";
export const CUSTOMER = "أحمد الطيب — تجريبي";
export const ITEM = "سكر";

export interface ScenarioSummary {
  tenant_a: string;
  tenant_b: string;
  branch_a: string;
  sync_epoch: string;
  initial_state: { customer: { id: string; name: string }; item_stock: string };
}

export async function resetScenario(request: APIRequestContext): Promise<ScenarioSummary> {
  const r = await request.post("/api/scenario/reset");
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()) as ScenarioSummary;
}

/** مفاتيح الأعطال المعزولة عن الإنتاج: drop_ack / freeze_reconciliation / network_cut / printer_fail. */
export async function setFault(
  request: APIRequestContext,
  key: string,
  on: boolean,
): Promise<void> {
  const r = await request.post("/api/scenario/faults", { data: { key, on } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

export interface Device {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly name: string;
}

/** جهاز جديد: دخول بالحساب (الوجهة `/setup-device`) ثم اختيار المنشأة ثم التجهيز الأول من الخادم
 * الحقيقي (تسجيل الجهاز + تنزيل النسخة) — حتى الرئيسية. */
export async function newDevice(
  browser: Browser,
  name: string,
  who: { identifier: string; password: string } = OWNER,
): Promise<Device> {
  const context = await browser.newContext({ locale: "ar" });
  // التخزين الدائم (ACC-05) لا يمنحه Chromium بلا رأس لأي موقع (لا تفاعل ولا تثبيت) — نحاكي منحه
  // هنا فقط؛ منح المتصفح الحقيقي يُتحقق يدوياً على الجهاز المستهدف (ملف الأدلة)
  await context.addInitScript(() => {
    if (navigator.storage) {
      navigator.storage.persist = () => Promise.resolve(true);
      navigator.storage.persisted = () => Promise.resolve(true);
    }
  });
  const page = await context.newPage();
  await page.goto("/login?next=%2Fsetup-device");
  await page.getByLabel("رقم الهاتف أو البريد").fill(who.identifier);
  await page.getByLabel("كلمة المرور").fill(who.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/(select-org\?.*|setup-device)$/);
  if (/\/select-org/.test(page.url())) {
    await page.getByRole("button", { name: new RegExp(SHOP) }).click();
  }
  await expect(page).toHaveURL(/\/setup-device$/, { timeout: 30_000 });
  await expect(page.locator('[data-screen="ACC-05"]')).toHaveAttribute("data-state", "success", {
    timeout: 120_000,
  });
  // شاشة التجهيز بلا تنقّل — نمضي إلى شاشة الفتح (بتنقّلها) ثم الرئيسية
  await page.getByRole("button", { name: "افتح وردية وابدأ البيع" }).click();
  await expect(page).toHaveURL(/\/shifts\/open$/);
  await nav(page, "الرئيسية", /\/$/);
  return { context, page, name };
}

/**
 * رابط التنقل ولو كانت مجموعته مطويّة (0005 §١٣٤): المطويّ في DOM مخفياً — تُفتح مجموعته أولاً.
 * يعيد الرابط ظاهراً جاهزاً للنقر.
 */
export async function revealLink(page: Page, label: string) {
  const visible = page.getByRole("link", { name: label }).first();
  if ((await visible.count()) && (await visible.isVisible())) return visible;
  const collapsed = page
    .locator(".c-nav--collapsible")
    .getByRole("link", { name: label, includeHidden: true })
    .first();
  if (await collapsed.count()) {
    const section = page.locator(".c-nav__section").filter({ has: collapsed });
    await section.first().locator(".c-nav__group--toggle").click();
    return collapsed;
  }
  return visible;
}

/** الجلسة في الذاكرة فقط (§٩.٤): كل تنقّل عميلي عبر الروابط — `page.goto` يُسقط الجلسة. */
export async function nav(page: Page, label: string, url: RegExp): Promise<void> {
  await (await revealLink(page, label)).click();
  await expect(page).toHaveURL(url);
}

/** إلى الرئيسية من أي شاشة: نقطة البيع → الأصناف (AppNav) → الرئيسية. */
export async function goHome(page: Page): Promise<void> {
  if (/\/$/.test(page.url())) return;
  if (await page.getByRole("link", { name: "الرئيسية", includeHidden: true }).count()) {
    await nav(page, "الرئيسية", /\/$/);
    return;
  }
  await nav(page, "الأصناف", /\/catalog$/);
  await nav(page, "الرئيسية", /\/$/);
}

/** يفتح وردية بدرج صفر (الحالة الابتدائية): من نجاح التجهيز أو من الرئيسية. */
export async function openShift(page: Page, drawer = "0.00"): Promise<void> {
  await goHome(page);
  // رئيسية بلا أرقام: «افتح وردية»؛ رئيسية بأرقام: مؤشر الذمم/المبيعات → تنقّل البيع → الوردية
  // والصندوق (بلا وردية يحوّل إلى الفتح)
  const open = page.getByRole("button", { name: "افتح وردية" });
  const kpi = page.getByRole("link", { name: /^(الذمم|مبيعات اليوم|نقد الصناديق)/ });
  await expect(open.or(kpi).first()).toBeVisible();
  if (await open.count()) {
    await open.click();
  } else {
    await goPos(page);
    await (await revealLink(page, "الوردية والصندوق")).click();
  }
  await expect(page).toHaveURL(/\/shifts\/open$/);
  await page.getByLabel("ما تعدّه الآن في الدرج").fill(drawer);
  await page.getByRole("button", { name: "افتح الوردية وابدأ البيع" }).click();
  await expect(page.locator('[data-screen="SHIFT-01"]')).toHaveAttribute("data-state", "success");
  await nav(page, "نقطة البيع", /\/pos$/);
}

export async function goPos(page: Page): Promise<void> {
  if (/\/pos$/.test(page.url())) return;
  if (await page.getByRole("link", { name: "نقطة البيع", includeHidden: true }).count()) {
    await nav(page, "نقطة البيع", /\/pos$/);
    return;
  }
  await goHome(page);
  // رئيسية الموظف: «بيع جديد»؛ رئيسية المالك: مؤشر «مبيعات اليوم» → الفواتير (تنقّل البيع) → نقطة
  // البيع؛ وقبل أول بيع «يومٌ لم يبدأ» → شاشة الفتح تعرض الوردية المفتوحة ورابط نقطة البيع
  const sell = page.getByRole("link", { name: /بيع جديد|افتح نقطة البيع/ });
  const kpi = page.getByRole("link", { name: /^مبيعات اليوم/ });
  const open = page.getByRole("button", { name: "افتح وردية" });
  await expect(sell.or(kpi).or(open).first()).toBeVisible();
  if (await sell.count()) {
    await sell.click();
  } else if (await kpi.count()) {
    await kpi.click();
    await expect(page).toHaveURL(/\/pos\/invoices$/);
    await (await revealLink(page, "نقطة البيع")).click();
  } else {
    await open.click();
    await expect(page).toHaveURL(/\/shifts\/open$/);
    await (await revealLink(page, "نقطة البيع")).click();
  }
  await expect(page).toHaveURL(/\/pos$/);
}

/** يضيف كيلوغرامات من «سكر» (100.00 للكغ) — الصنف الوحيد ذو الرصيد في الحالة الابتدائية. */
export async function addSugar(page: Page, kg = "1"): Promise<void> {
  await goPos(page);
  const row = page.locator(".c-table tbody tr", { hasText: "سكر" }).first();
  await row.getByRole("button", { name: "إضافة" }).click();
  await page.getByLabel(/^الكمية بال/).fill(kg);
  await page.getByRole("button", { name: "تأكيد الإضافة" }).click();
  await expect(page.locator(".c-cart")).toContainText("سكر");
}

export async function pickCustomer(page: Page, name = CUSTOMER): Promise<void> {
  await page.getByRole("button", { name: "اختيار العميل" }).click();
  await expect(page).toHaveURL(/\/pos\/customer$/);
  await page.getByLabel("اختيار العميل").fill(name.split(" ")[0]!);
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page).toHaveURL(/\/pos$/);
  await expect(page.locator(".c-cart")).toContainText(name);
}

/** بيع آجل كامل للعميل المختار — يعيد بعد الحفظ. */
export async function saveCredit(page: Page): Promise<void> {
  await page.getByRole("button", { name: "متابعة إلى الدفع" }).click();
  await expect(page).toHaveURL(/\/pos\/pay$/);
  await page.getByRole("button", { name: "آجل", exact: true }).click();
  await expect(page).toHaveURL(/\/pos\/pay\/credit$/);
  await page.getByRole("button", { name: "حفظ البيع الآجل" }).click();
  await expect(page.locator('[data-screen="POS-06"]')).toHaveAttribute(
    "data-state",
    /saved_local|pending_sync|synced|success/,
  );
}

/** المزامنة اليدوية من مركز المزامنة — تعيد بعد خلوّ الجهاز من معلّق (الرفع مؤكد لا مطلوب). */
export async function syncNow(page: Page): Promise<void> {
  await goHome(page);
  await nav(page, "المزامنة", /\/sync$/);
  await page.getByRole("button", { name: "محاولة رفع الآن" }).click();
  await expect.poll(() => pendingCount(page), { timeout: 30_000 }).toBe(0);
  await expect(page.locator('[data-screen="SYS-01"]')).toHaveAttribute(
    "data-state",
    /synced|ready/,
    { timeout: 30_000 },
  );
}

/** كشف حساب العميل من قائمة العملاء (PTY-05) — بعد اكتمال الحساب من الخادم؛ يعيد نصّ الشاشة. */
export async function statement(page: Page, name = CUSTOMER): Promise<string> {
  await goPos(page);
  await nav(page, "العملاء والذمم", /\/parties$/);
  const reply = page.waitForResponse((r) => r.url().includes("/statement"));
  await page
    .getByRole("button", { name: new RegExp(name) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/parties\/[^/]+\/statement$/);
  await reply;
  const root = page.locator('[data-screen="PTY-05"]');
  await expect(root).toBeVisible();
  await expect(root).not.toContainText("جارٍ");
  return root.innerText();
}

/**
 * قطع الشبكة عن الخادم كما يقع في المحل: طلبات `/api/*` تسقط والمتصفح يعلن «بلا اتصال».
 * (لا `setOffline` لأن خادم Next التطويري يخدم أجزاء المسارات عند الطلب — ليس عامل الخدمة هنا.)
 */
export async function cutNetwork(d: Device): Promise<void> {
  await d.context.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await d.page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
}

export async function restoreNetwork(d: Device): Promise<void> {
  await d.context.unroute("**/api/**");
  await d.page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
  });
}

/** بيع نقدي بمبلغ مضبوط — يعيد رقم الفاتورة من شاشة النجاح. */
export async function saveCash(page: Page): Promise<string> {
  await page.getByRole("button", { name: "متابعة إلى الدفع" }).click();
  await expect(page).toHaveURL(/\/pos\/pay$/);
  await page.getByRole("button", { name: "مبلغ مضبوط" }).click();
  await page.getByRole("button", { name: /حفظ البيع/ }).click();
  const root = page.locator('[data-screen="POS-05"]');
  await expect(root).toHaveAttribute("data-state", /success|saved_local|pending_sync|synced/);
  const m = /INV-[A-Z0-9-]+/.exec(await root.innerText());
  expect(m, "رقم الفاتورة في شاشة النجاح").toBeTruthy();
  return m![0];
}

/** بيع مختلط: نقداً + آجل على العميل المختار. */
export async function saveMixed(page: Page, cash: string, credit: string): Promise<void> {
  await page.getByRole("button", { name: "متابعة إلى الدفع" }).click();
  await expect(page).toHaveURL(/\/pos\/pay$/);
  await page.getByRole("button", { name: "مختلط", exact: true }).click();
  await expect(page).toHaveURL(/\/pos\/pay\/mixed$/);
  await page.getByLabel("نقداً").fill(cash);
  await page.getByLabel("آجل").fill(credit);
  await page.getByRole("button", { name: /حفظ البيع/ }).click();
  await expect(page.locator('[data-screen="POS-07"]')).toHaveAttribute(
    "data-state",
    /success|saved_local|pending_sync|synced/,
  );
}

/** شاشة الوردية الحالية (SHIFT-02) — نصّها بعد ردّ الخادم. */
export async function shiftScreen(page: Page): Promise<string> {
  await goPos(page);
  const reply = page.waitForResponse((r) => r.url().includes("/api/shifts/"));
  await nav(page, "الوردية والصندوق", /\/shifts\/current$/);
  await reply;
  const root = page.locator('[data-screen="SHIFT-02"]');
  await expect(root).toBeVisible();
  await expect(root).not.toContainText("جارٍ");
  return root.innerText();
}

/** أرصدة المخزون (INV-01) — نصّها بعد وصول ردّ الخادم (لا القيمة المخزَّنة من زيارة سابقة). */
export async function stockScreen(page: Page): Promise<string> {
  await goPos(page);
  const reply = page.waitForResponse((r) => r.url().includes("/api/inventory/balances"));
  await nav(page, "المخزون", /\/inventory$/);
  await reply;
  const root = page.locator('[data-screen="INV-01"]');
  await expect(root).toHaveAttribute("data-state", /ready|pending_sync|stale/);
  await expect(root).not.toContainText("جارٍ");
  return root.innerText();
}

/** يفتح الفاتورة بالرقم من قائمة الفواتير (POS-09). */
export async function openInvoice(page: Page, number: string): Promise<void> {
  await goPos(page);
  await nav(page, "الفواتير", /\/pos\/invoices$/);
  const row = page.locator("tbody tr", { hasText: number }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "فتح" }).click();
  await expect(page).toHaveURL(/\/pos\/invoices\/[^/]+$/);
  await expect(page.locator('[data-screen="POS-09"]')).toContainText(number);
}

export async function pendingCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const req = indexedDB.open("sting-bootstrap");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(new Error(String(req.error)));
    });
    const rows = await new Promise<{ state: string }[]>((res) => {
      const r = db.transaction("operations").objectStore("operations").getAll();
      r.onsuccess = () => res(r.result as { state: string }[]);
    });
    db.close();
    return rows.filter((o) => o.state === "local" || o.state === "pending").length;
  });
}

/**
 * تبديل المستخدم على الجهاز نفسه (جهاز مشترك): السياق نفسه وتخزينه — الجلسة في الذاكرة فتُفتح
 * صفحة الدخول من جديد، والجهاز يُجدَّد من سرّ التسجيل المحفوظ لا يُسجَّل من جديد.
 */
export async function switchUser(
  d: Device,
  who: { identifier: string; password: string },
): Promise<void> {
  await d.page.goto("/login?next=%2Fsetup-device");
  await d.page.getByLabel("رقم الهاتف أو البريد").fill(who.identifier);
  await d.page.getByLabel("كلمة المرور").fill(who.password);
  await d.page.getByRole("button", { name: "دخول" }).click();
  await expect(d.page).toHaveURL(/\/(select-org\?.*|setup-device)$/);
  if (/\/select-org/.test(d.page.url()))
    await d.page.getByRole("button", { name: new RegExp(SHOP) }).click();
  await expect(d.page).toHaveURL(/\/setup-device$/, { timeout: 30_000 });
  await expect(d.page.locator('[data-screen="ACC-05"]')).toHaveAttribute("data-state", "success", {
    timeout: 60_000,
  });
  await d.page.getByRole("button", { name: "افتح وردية وابدأ البيع" }).click();
  await expect(d.page).toHaveURL(/\/shifts\/open$/);
  await nav(d.page, "الرئيسية", /\/$/);
}
