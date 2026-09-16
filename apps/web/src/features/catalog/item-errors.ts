/**
 * صياغة أخطاء بطاقة الصنف (CAT-02 validation_error، 31-D23): لكل خطأ حقلٌ ورسالة وسبب ومخرج.
 * النصان المرسومان: «لم تُحدَّد» (الوحدة الأساسية) و«مستخدم في صنف آخر» (الباركود).
 * حدود الطول والقيمة (ACC-25) بلا إطار مرسوم — نصوصها هنا في مكان واحد حتى تُرسم (0005 §١٢)؛
 * الأرقام من استجابة الخادم (`limit`/`actual`) لا من ثوابت مكرّرة.
 */

export interface ServerFieldError {
  readonly field: string;
  readonly code: string;
  readonly limit?: number | string | undefined;
  readonly actual?: number | string | undefined;
  readonly barcode?: string | undefined;
  readonly owner_item_id?: string | undefined;
  readonly owner_item_name?: string | undefined;
  readonly owner_unit_name?: string | undefined;
}

export interface ItemFieldError {
  /** مفتاح الحقل في النموذج. */
  readonly key: string;
  /** اسم الحقل كما في الإطار. */
  readonly field: string;
  readonly msg: string;
  /** السبب — يُعرض حين يكون هو الرسالة؛ الأرقام داخله تُعرض في mono من `numbers`. */
  readonly why: string;
  readonly fix: string;
  readonly link?: { readonly href: string; readonly label: string } | undefined;
}

export const FIELD_LABELS: Record<string, string> = {
  name: "اسم الصنف",
  base_unit_id: "الوحدة الأساسية",
  units: "وحدة أكبر وتحويلها",
  factor_milli: "المعامل",
  unit_id: "الوحدة",
  barcode: "الباركود",
  sale_price_minor: "سعر البيع",
  image_data_url: "صورة الصنف",
};

const n = (v: number | string | undefined) => String(v ?? "");

export function describeError(e: ServerFieldError): ItemFieldError {
  const field = FIELD_LABELS[e.field] ?? e.field;
  const base = { key: e.field, field };
  switch (e.code) {
    case "required":
      if (e.field === "base_unit_id")
        return {
          ...base,
          msg: "لم تُحدَّد",
          why: "بلا وحدة أساسية لا يعرف النظام معنى «5» في المخزون ولا في الفاتورة: خمسة أكياس أم خمسة كراتين أم خمسة كيلوات. وهي الحقل الوحيد الذي لا يُعدَّل بعد أول حركة، لأن تعديلها يعيد تفسير كل رصيد وكل فاتورة مضت.",
          fix: "اختر الوحدة التي يُعدّ بها الصنف في الرفّ، لا التي يُشترى بها من المورد.",
        };
      return { ...base, msg: "لم يُحدَّد", why: "", fix: `اكتب ${field}.` };
    case "barcode_taken":
      return {
        ...base,
        msg: "مستخدم في صنف آخر",
        why: `الرقم ${n(e.barcode)} مسجّل على «${e.owner_item_name ?? ""}». مسحُه على الميزان سيفتح ذاك لا هذا، والفرق يظهر في الجرد بعد شهر لا في البيع الآن.`,
        fix: "افتح الصنف الآخر وتحقّق، أو اترك الباركود فارغاً — الصنف يُباع بالبحث بالاسم ريثما يُضبط.",
        link: e.owner_item_id
          ? { href: `/catalog/${e.owner_item_id}`, label: e.owner_item_name ?? "" }
          : undefined,
      };
    case "too_long":
      return {
        ...base,
        msg: "أطول من الحدّ",
        why: `الحدّ ${n(e.limit)} حرفاً وما كتبتَه ${n(e.actual)}.`,
        fix: "اختصر النص ليقع ضمن الحدّ.",
      };
    case "out_of_range":
      return {
        ...base,
        msg: "خارج الحدّ",
        why: `القيمة ${n(e.actual)} والحدّ ${n(e.limit)}.`,
        fix: "اكتب قيمة ضمن الحدّ.",
      };
    case "not_a_number":
      return {
        ...base,
        msg: "ليس رقماً مقبولاً",
        why: "",
        fix: "اكتب رقماً صحيحاً موجباً بأرقام لاتينية.",
      };
    case "same_as_base":
      return {
        ...base,
        msg: "هي الوحدة الأساسية نفسها",
        why: "",
        fix: "اختر وحدة أكبر غير الوحدة الأساسية.",
      };
    case "duplicate_unit":
      return { ...base, msg: "مكرّرة", why: "", fix: "هذه الوحدة مسجّلة للصنف من قبل." };
    case "same_as_unit":
      return {
        ...base,
        msg: "مسجّلة وحدةً أكبر لهذا الصنف",
        why: "",
        fix: "احذف الوحدة الأكبر أولاً أو اختر وحدة أساسية أخرى.",
      };
    case "locked_after_movement":
      return {
        ...base,
        msg: "لا تتغيّر بعد أول حركة",
        why: `للصنف ${n(e.actual)} حركة مسجّلة.`,
        fix: "أنشئ صنفاً جديداً بالوحدة المطلوبة.",
      };
    case "not_an_image":
      return { ...base, msg: "ليس صورة", why: "", fix: "اختر ملف صورة." };
    case "unit_not_found":
      return { ...base, msg: "غير موجودة", why: "", fix: "اختر وحدة من القائمة." };
    default:
      return { ...base, msg: e.code, why: "", fix: "" };
  }
}

/** عنوان لوحة الأخطاء بالعدد: الإطار يرسم «خطآن يمنعان الحفظ»؛ المفرد والجمع افتراضٌ مسجَّل (0005 §١٢). */
export function errorsTitle(count: number): string {
  if (count === 2) return "خطآن يمنعان الحفظ";
  if (count === 1) return "خطأ يمنع الحفظ";
  return "أخطاء تمنع الحفظ";
}
