/**
 * ترقيم الفواتير المرئي (§٨.٢): `INV-<فرع>-<جهاز>-<سنة>-<تسلسل>` مثل INV-KRT-A2-26-000001.
 * التسلسل محمي داخل المعاملة ومتزايد لكل جهاز ولا يُعاد تعيينه بساعة محلية غير موثوقة:
 * السنة من تاريخ الأعمال للعرض فقط، والعدّاد لا يعود إلى الصفر بتغيّرها.
 * UUID هو الهوية التقنية؛ الرقم للعرض والمراجع الورقية.
 */

import type { StorageTransaction } from "@sting/platform";

const KEY = "invoice_seq";
const CODE = /^[A-Z0-9]{1,6}$/;

export interface InvoiceNumberParts {
  readonly branchCode: string;
  readonly devicePrefix: string;
  /** سنة تاريخ الأعمال بخانتين، مثل "26". */
  readonly yearTwoDigits: string;
}

export async function nextInvoiceNumber(
  tx: StorageTransaction,
  parts: InvoiceNumberParts,
): Promise<string> {
  if (
    !CODE.test(parts.branchCode) ||
    !CODE.test(parts.devicePrefix) ||
    !/^[0-9]{2}$/.test(parts.yearTwoDigits)
  ) {
    throw new Error("invalid invoice number parts");
  }
  const current = Number((await tx.getMeta(KEY)) ?? "0");
  const next = current + 1;
  await tx.putMeta(KEY, String(next));
  return `INV-${parts.branchCode}-${parts.devicePrefix}-${parts.yearTwoDigits}-${String(next).padStart(6, "0")}`;
}
