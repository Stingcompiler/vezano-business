import { expect, test } from "@playwright/test";

import { expectFrame } from "./frame-match";

/**
 * T0.19 معيار الإنجاز: المساعد يمرّ على صفحة عينة تحوي C-NOTICE بحالاته الثلاث،
 * والتخزين الحقيقي (IndexedDB في Chromium) يحفظ ويقرأ عدداً فوق MAX_SAFE_INTEGER (ACC-97).
 */
const NOTICE_TEXTS = {
  ready: ["لا عملاء بعد", "يُنشأ العميل عند أول بيع آجل، أو أضفه الآن.", "إضافة عميل"],
  offline: [
    "بلا اتصال — البيع والوردية يعملان محلياً",
    "حُفظ البيع محلياً — لم تتم الطباعة",
    "الفاتورة 1043 مسجَّلة. الطابعة غير متصلة؛ أعد طباعة نسخة بنفس الرقم دون تسجيل بيع جديد.",
  ],
  error: [
    "لم يُحفظ البيع",
    "امتلأ تخزين الجهاز. صدّر نسخة محلية أو احذف نسخاً قديمة ثم أعد المحاولة. لا تعتبر هذه الفاتورة مُسجَّلة.",
  ],
} as const;

for (const state of ["ready", "offline", "error"] as const) {
  test(`PROBE/${state}: نصوص حرفية وأنماط ولمس وaxe`, async ({ page }, info) => {
    await page.goto(`/dev/probe?state=${state}`);
    await expectFrame(page, info, {
      screenId: "PROBE",
      state,
      texts: [...NOTICE_TEXTS[state], "بقالة النيل — تجريبي"],
      styles: [
        [".c-frame__banner", "background-color", "brand.strong"],
        ["body", "background-color", "surface.page"],
      ],
    });
  });
}

test("IndexedDB حقيقي: حفظ عملية ذرّياً وقراءتها بعدد فوق MAX_SAFE_INTEGER (ACC-97)", async ({
  page,
}) => {
  await page.goto("/dev/probe");
  await page.getByTestId("save-probe").click();
  await expect(page.getByTestId("stored")).toContainText("محفوظ");
  await expect(page.getByTestId("stored")).toContainText("9007199254740993");
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).toContain("sting-probe");
});

test("Skip link أول عنصر، F6 بين المناطق، dir=rtl على الجذر", async ({ page }) => {
  await page.goto("/dev/probe");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.keyboard.press("Tab");
  await expect(page.locator(".c-frame__skip")).toBeFocused();
  await page.keyboard.press("F6");
  await expect(page.locator("header.c-frame__banner")).toBeFocused();
});
