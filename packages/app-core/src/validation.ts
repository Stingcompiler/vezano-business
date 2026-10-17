/**
 * قواعد التحقق في الواجهة — نسخة مطابقة لقواعد الخادم (الخادم يبقى الحَكَم ويعيد رموز الأخطاء نفسها).
 * المتجهات في `vectors/contact-phone.json` يقرؤها Vitest وpytest معاً، فلا تتباعد القاعدتان.
 * (خطة الجوال M0 — §٢.١؛ 0005 §١٦٤)
 */
import { latinDigits } from "./format";

/** الحدّ الأدنى لكلمة المرور (ACC-02). */
export const PASSWORD_MIN = 8;

/** يكفي «@» في الواجهة؛ الخادم يتحقق من الصيغة ويرسل الرمز. */
export function isEmailLike(text: string): boolean {
  return text.trim().includes("@");
}

/**
 * رقم التواصل عند التسجيل (§١٥٠) — مطابق لـ`core.contact.normalize_contact_phone`: محلي سوداني أو
 * دولي إلى `+249…`، أو `null` إن لم يُقبل.
 */
export function normalizeContactPhone(raw: string): string | null {
  let digits = latinDigits(raw.trim()).replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = "+" + digits.slice(2);
  const bare = digits.replace(/^\++/, "");
  if (!/^\d+$/.test(bare) || bare.length < 9 || bare.length > 15) return null;
  if (digits.startsWith("+")) return digits;
  if (bare.startsWith("249")) return "+" + bare;
  if (bare.startsWith("0") && bare.length === 10) return "+249" + bare.slice(1);
  if (bare.length === 9) return "+249" + bare;
  return "+" + bare;
}

/**
 * واتساب طلب الجولة (§١٤٧) — مطابق لـ`stingops.demo_public`: ثمانية أرقام على الأقل بعد حذف «+»،
 * والأرقام العربية مقبولة. (قاعدة الخادم هنا أرخى من رقم التسجيل — انظر 0005 §١٦٤.)
 */
export function isValidDemoWhatsapp(raw: string): boolean {
  const kept = [...latinDigits(raw)].filter((ch) => /\d/.test(ch) || ch === "+").join("");
  return kept.replace(/^\++/, "").length >= 8;
}
