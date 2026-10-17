/**
 * نصوص الجوال وحده — لا مقابل لها في الويب (تبويب «المزيد»، شاشة «لم تُبنَ بعد»، وشاشات NAT
 * الأصلية لاحقاً). قليلة عمداً، وكل نص هنا قرار مكتوب في 0005 §١٦٦. ما له مقابل في الويب يُؤخذ
 * من `tx` لا من هنا.
 */
export const MOBILE_TEXTS = {
  more: "المزيد",
  notBuiltTitle: "لم تُبنَ هذه الشاشة على الجوال بعد",
  notBuiltBody: "افتحها على الويب — الحساب نفسه والبيانات نفسها.",
  openWeb: "افتح على الويب",
} as const;

export type MobileTextKey = keyof typeof MOBILE_TEXTS;

export function mtx(key: MobileTextKey): string {
  return MOBILE_TEXTS[key];
}
