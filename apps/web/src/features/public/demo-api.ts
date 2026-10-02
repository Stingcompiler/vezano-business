"use client";

/**
 * طلب الجولة ومتابعته — نداءات الواجهة العامة (0005 §١٤٧). بلا جلسة: كل نداء JSON مباشر.
 * `devCodeFor`: بيئة التطوير وحدها (حارس السيناريو يعيد آخر رمز؛ في الإنتاج 404 فلا يظهر شيء).
 */
import { apiBaseUrl } from "@/lib/api";

export interface CodeSent {
  sent_to: string;
  code_length: number;
  resend_after_seconds: number;
  resends_left: number;
}

export interface TrackRequest {
  reference: string;
  name: string;
  channel_label: string;
  status: "new" | "contacted" | "converted" | "closed";
  status_label: string;
  status_note: string;
  created_at: string;
  updated_at: string;
  email: string;
  comments: { body: string; author: string; at: string }[];
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  body: T & { detail?: string; attempts_left?: number; retry_after?: number };
}

export async function postJson<T>(path: string, data: unknown): Promise<ApiResult<T>> {
  const r = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = (await r.json().catch(() => ({}))) as ApiResult<T>["body"];
  return { ok: r.ok, status: r.status, body };
}

export async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const r = await fetch(`${apiBaseUrl()}${path}`);
  const body = (await r.json().catch(() => ({}))) as ApiResult<T>["body"];
  return { ok: r.ok, status: r.status, body };
}

export async function devCodeFor(email: string): Promise<string | null> {
  try {
    const r = await fetch(
      `${apiBaseUrl()}/api/scenario/verification-code?identifier=${encodeURIComponent(email)}`,
    );
    if (!r.ok) return null;
    const b = (await r.json()) as { code?: string };
    return b.code ?? null;
  } catch {
    return null;
  }
}

/** نصّ واحد لكل رفض — ما الخطأ وماذا يفعل الزائر. */
export const DEMO_ERRORS: Record<string, string> = {
  name_required: "اكتب اسمك.",
  whatsapp_invalid: "رقم الواتساب غير مكتمل.",
  email_required: "البريد مطلوب — نرسل إليه رمز تأكيد ثم نتابع طلبك به.",
  email_invalid: "البريد غير صالح.",
  channel_invalid: "اختر طريقة التواصل.",
  too_many: "طلبات كثيرة من هذا الجهاز — حاول بعد ساعة.",
  resend_too_soon: "أُرسل رمز قبل قليل — انتظر قليلاً ثم اطلب رمزاً جديداً.",
  resend_limit: "بلغت حدّ إعادة الإرسال — حاول بعد عشر دقائق.",
  send_failed: "تعذّر إرسال الرمز الآن. حاول بعد قليل.",
  code_required: "أدخل الرمز.",
  code_invalid: "الرمز غير صحيح.",
  code_expired: "انتهى الرمز — اطلب رمزاً جديداً.",
  not_found: "لا طلب جولة بهذه البيانات. جرّب البريد أو رقم الهاتف الذي سجّلت به.",
  no_email: "هذا طلب قديم بلا بريد — تابعه مع الدعم على plus@vezano.app.",
  token_expired: "انتهت جلسة المتابعة — أدخل بياناتك مرة أخرى.",
  token_invalid: "انتهت جلسة المتابعة — أدخل بياناتك مرة أخرى.",
};

export const errorText = (code: string | undefined) =>
  (code && DEMO_ERRORS[code]) || "تعذّر الإكمال الآن. جرّب مرة أخرى.";
