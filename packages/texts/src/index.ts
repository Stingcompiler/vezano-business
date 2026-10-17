/**
 * @sting/texts — نصوص الويب العربية بمعرّف شاشتها (0005 §١٦٥).
 *
 * الجوال لا يكتب نصاً من عنده: `tx("ACC-02", "أرسل رمز التحقق")` يقبل فقط نصاً موجوداً حرفياً في
 * شاشة الويب نفسها — النوع يرفض غيره عند الترجمة. تغيّر النص في الويب ← اختبار الانحراف يفشل حتى
 * يُعاد التوليد ← استعمال الجوال للنص القديم يفشل في `tsc`. فلا تتباعد المصطلحات بين المنصّتين.
 *
 * المفاتيح: معرّف الشاشة (`data-screen`) أو `shared:<مسار الملف>` للملفات المشتركة بلا شاشة.
 * القوالب ذات المتغيرات محفوظة أجزاءً ثابتة (الرقم يُدرج بجانبها بخط mono كما في الويب).
 */
import { TEXTS } from "./generated/texts";

export { TEXTS };

export type TextKey = keyof typeof TEXTS;
export type TextOf<K extends TextKey> = (typeof TEXTS)[K][number];

/** يعيد النص كما هو؛ قيمته في النوع: لا يُقبل إلا نصّ موجود في شاشة الويب `key`. */
export function tx<K extends TextKey, T extends TextOf<K>>(key: K, text: T): T {
  void key;
  return text;
}

/** كل نصوص شاشة (للاختبار ولأدوات المطابقة). */
export function textsOf<K extends TextKey>(key: K): readonly TextOf<K>[] {
  return TEXTS[key];
}
