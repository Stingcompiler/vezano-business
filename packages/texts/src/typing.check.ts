/* فحص أنواع يُترجَم مع `tsc` (لا يُشغَّل): النص الموجود في الشاشة يُقبل، وغيره يُرفض. */
import { tx } from "./index";

export const ok = tx("ACC-02", "أرسل رمز التحقق");

// @ts-expect-error — نص غير موجود في شاشة ACC-02 حرفياً
export const bad = tx("ACC-02", "أرسل الرمز");
