import { type Page } from "@playwright/test";

import { clickInDrawer } from "./nav";

/** أقسام مساحة المشغّل كما تظهر في القائمة (0005 §١١٣). */
export const PLATFORM_SECTIONS = [
  "النظرة العامة",
  "مراجعة الدفع",
  "المستأجرون",
  "الاستحقاقات",
  "الباقات والتسعير",
  "طلبات التحقُّق",
  "البلاغات",
  "الخلافات",
  "الإعلانات",
  "الإرسال",
  "طلبات الجولة",
  "لوحة الاكتساب",
  "الصحة",
  "النسخ",
  "المشغّلون",
] as const;

/**
 * الانتقال إلى قسم في مساحة المشغّل: على ≥ 834 القائمة جانبية ثابتة، وعلى الهاتف درج يُفتح
 * بزرّ «القائمة» أولاً (الروابط في DOM دائماً — الفتح للنقر لا للقراءة).
 */
export async function goSection(page: Page, name: string) {
  await clickInDrawer(page, () =>
    page.getByRole("button", { name, exact: true }).first().click({ timeout: 10_000 }),
  );
}
