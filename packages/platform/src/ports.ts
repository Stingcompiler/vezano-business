/**
 * منافذ المنصة (§٤.٦ بند ١ و٨): النواة تعتمد على هذه العقود، وكل منصة تقدّم محوّلها.
 * الساعة وتوليد الهوية والنقل منافذ قابلة للاستبدال في الاختبار — ضمن أدوات الاختبار فقط.
 */

export interface Clock {
  /** وقت الجهاز — لا يُعامل مرجع ترتيب موثوقاً (§٥.٢). */
  now(): Date;
}

export interface IdGenerator {
  /** UUIDv7 يولَّد محلياً دون انتظار الخادم (§٥.٢). */
  uuid7(): string;
}

export interface SecretsPort {
  /** أسرار صغيرة (رموز تجديد، اعتماد تسجيل): SecureStore/مخزن نظام — لا بيانات أعمال (§٩.٤). */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PrintJob {
  /** raster أحادي اللون جاهز (§١٢.٣)؛ التشكيل العربي يسبق هذا المنفذ. */
  readonly rasterPng: Uint8Array;
  readonly copies: number;
  /** «نسخة» تُطبع على المخرج عند إعادة الطباعة بنفس الرقم. */
  readonly isReprint: boolean;
}

export type PrintOutcome = "printed" | "failed" | "unknown";

export interface PrinterPort {
  /** فشل الطباعة لا يلغي بيعاً؛ «unknown» بعد انقطاع الإرسال لا يعاد تلقائياً (§١٢.٣). */
  print(job: PrintJob): Promise<PrintOutcome>;
}

export interface NotificationsPort {
  /** تنبيه محلي فقط؛ صندوق الوارد الخادمي هو مصدر الحقيقة (§١١.٦). */
  notify(title: string, body: string): Promise<void>;
}

export const systemClock: Clock = { now: () => new Date() };
