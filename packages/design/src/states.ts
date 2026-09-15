/**
 * مفردات الحالات السبع عشرة — الرسالة المعتمدة والإجراء التالي، حرفاً من 02-Design-System §٣.
 * «الشاشة التي تعرض حالة بلا إجراء تالٍ تُرفض في المراجعة.» لا تُعاد صياغة هذه النصوص.
 */
import { stateLabel, type StateCode } from "./generated/tokens";

export interface StateSpec {
  /** الشارة كما تُعرض (من tokens.json). */
  readonly label: string;
  /** الرسالة المعتمدة. */
  readonly message: string;
  /** الإجراء التالي الواحد. */
  readonly action: string;
}

const spec = (code: StateCode, message: string, action: string): StateSpec => ({
  label: stateLabel[code],
  message,
  action,
});

export const states: Readonly<Record<StateCode, StateSpec>> = {
  ready: spec("ready", "المحتوى محمّل وقابل للعمل.", "لا شيء — الشاشة في وضعها الطبيعي."),
  loading: spec(
    "loading",
    "جارٍ الجلب — يُعرض هيكل لا دوّارة مفرغة.",
    "انتظار، مع إمكان الإلغاء بعد ٥ ثوانٍ.",
  ),
  empty: spec("empty", "لا سجلات بعد، مع سبب أو فعل إنشاء.", "زر إنشاء أو تعديل المرشح."),
  validation_error: spec(
    "validation_error",
    "نص يقول ما الخطأ وكيف يُصلح، عند الحقل نفسه.",
    "تصحيح الحقل المعلّم.",
  ),
  permission_denied: spec(
    "permission_denied",
    "لا صلاحية لهذا الإجراء في هذا النطاق.",
    "طلب الصلاحية من المالك، دون كشف البيانات.",
  ),
  offline: spec(
    "offline",
    "يعمل محلياً — يُذكر ما لا يعمل بلا اتصال.",
    "المتابعة محلياً؛ الرفع عند العودة.",
  ),
  stale: spec("stale", "آخر تحديث خادمي [وقت] — قد تتغير.", "تحديث يدوي أو انتظار المزامنة."),
  saving: spec("saving", "الحفظ جارٍ — لا رسالة نجاح قبل اكتماله.", "انتظار؛ الزر معطّل مؤقتاً."),
  saved_local: spec(
    "saved_local",
    "مسجَّل على هذا الجهاز ولم يصل الخادم بعد.",
    "المتابعة؛ الرفع تلقائي.",
  ),
  pending_sync: spec(
    "pending_sync",
    "ينتظر التأكيد الخادمي، ويدخل في الأرصدة.",
    "لا شيء؛ يُتابع من مركز المزامنة.",
  ),
  synced: spec("synced", "أكّده الخادم وصار مرجعياً.", "لا شيء."),
  conflict: spec(
    "conflict",
    "نسختان متعارضتان — الأصل لم يُكتب فوقه.",
    "مراجعة المالك: قبول أو رفض بسبب.",
  ),
  server_error: spec(
    "server_error",
    "تعذّر الوصول — مع معرّف للدعم بلا JSON.",
    "إعادة محاولة للعابر، حجر للدائم.",
  ),
  expired: spec("expired", "انتهت صلاحية السعر أو الرابط أو الجلسة.", "طلب تجديد أو تأكيد جديد."),
  partial: spec(
    "partial",
    "نجح بعضه — تُعرض الكميات الأربع منفصلة.",
    "إكمال المتبقي أو إلغاؤه بفعل صريح.",
  ),
  success: spec("success", "اكتمل العمل — يُذكر ما اكتمل بالضبط.", "الخطوة التالية أو العودة."),
  phase_locked: spec(
    "phase_locked",
    "مصمَّمة وتُفعَّل في M3/M4 أو بعد عقدها.",
    "عرض ما تشمله المرحلة؛ لا محاولة تنفيذ.",
  ),
};

/** `saved_local` للنماذج و`pending_sync` للقوائم — لا تُخلطان (القاعدة 4 من الأمر). */
export const FORM_LOCAL_STATE: StateCode = "saved_local";
export const LIST_PENDING_STATE: StateCode = "pending_sync";
