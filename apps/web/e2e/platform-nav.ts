import { type Page } from "@playwright/test";

import { clickInDrawer } from "./nav";

/** أقسام مساحة المشغّل كما تظهر في القائمة (0005 §١١٣). */
export const PLATFORM_SECTIONS = [
  "النظرة العامة",
  "المستأجرون",
  "مراجعة الدفع",
  "الاستحقاقات",
  "الباقات والتسعير",
  "طلبات التحقُّق",
  "البلاغات",
  "الخلافات",
  "الإرسال",
  "الإعلانات",
  "الصحة",
  "النسخ",
  "المشغّلون",
  "M0",
  "طلبات الجولة",
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
