/**
 * تطبيع البحث (§٧.٥): يحتفظ بالاسم الأصلي ويوحّد صور الألف والياء ويزيل التشكيل والتطويل؛
 * توحيد التاء المربوطة وتجاهل «ال» اختياريان (أثرهما يُختبر لا يُفترض). البحث بالبادئة أولاً.
 * مرآة `backend/core/search_normalize.py` بمتجهات مشتركة في vectors/search.json.
 */
export interface NormalizeOptions {
  /** ة → ه */
  readonly unifyTaMarbuta?: boolean;
  /** تجاهل «ال» في أول كل كلمة */
  readonly stripAl?: boolean;
}

const TASHKEEL = /[ً-ٰٟـ]/g; // حركات + شدّة + ألف خنجرية + تطويل
const ARABIC_INDIC = /[٠-٩۰-۹]/g;

export function normalizeSearch(text: string, options: NormalizeOptions = {}): string {
  let s = text
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) & 0xf))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (options.unifyTaMarbuta) s = s.replace(/ة/g, "ه");
  if (options.stripAl) s = s.replace(/(^| )ال(?=\S)/g, "$1");
  return s;
}

/** بادئة عند حدّ كلمة: «سك» تطابق «سكر أبيض» و«أبيض سكر»، و«1 لتر» تطابق «زيت 1 لتر». */
export function matchesPrefix(
  haystack: string,
  query: string,
  options?: NormalizeOptions,
): boolean {
  const q = normalizeSearch(query, options);
  if (!q) return true;
  const h = normalizeSearch(haystack, options);
  return h.startsWith(q) || h.includes(` ${q}`);
}
