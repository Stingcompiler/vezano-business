/**
 * C-LISTING — بطاقة عرض منشور/منشأة/مقارنة/عرض ممول (موسومة صراحة). الحالات: ready, loading,
 * empty, expired, permission_denied, stale. الصورة في البداية والنص بعدها. البطاقة كلها هدف تنقل
 * واحد؛ Enter يفتح. الوسم «ممول» جزء من النص المُعلن؛ السعر الخاص لا يُكشف في معاينة عامة.
 * المقارنة بوحدة واحدة مؤكدة (§٦.٥، ACC-122)؛ «الأرخص» ممنوعة عند اختلاف الوحدة أو غياب الرسوم.
 */
import { BadgeCheck, Clock } from "lucide-react";
import type { ReactNode } from "react";

import { formatMinor } from "./format";
import { Status } from "./Status";

export interface ListingProps {
  readonly title: string;
  readonly seller: string;
  readonly verified?: boolean;
  readonly image?: ReactNode;
  /** سعر الوحدة بالوحدة الصغرى؛ null = «اطلب السعر». */
  readonly priceMinor: string | null;
  readonly currency: string;
  /** «كرتونة 12 حبة» — الوحدة والحجم والعدد داخل العبوة (§١٤.٥). */
  readonly unitLabel: string;
  readonly minOrderLabel?: string | undefined;
  readonly deliveryLabel?: string | undefined;
  /** «آخر تحديث للسعر 14 سبتمبر» — حداثة العرض (§٦.٦). */
  readonly freshnessLabel: string;
  readonly expired?: boolean | undefined;
  readonly stale?: boolean | undefined;
  readonly sponsored?: boolean | undefined;
  /** سعر خاص مقيد الجمهور — يُعرض «سعر خاص» دون الرقم في المعاينة العامة. */
  readonly privatePrice?: boolean | undefined;
  readonly href: string;
  readonly onOpen?: (() => void) | undefined;
  /** الرسوم غير المحسومة تظهر صراحة قبل التأكيد. */
  readonly feesNote?: string | undefined;
}

export function Listing({
  title,
  seller,
  verified,
  image,
  priceMinor,
  currency,
  unitLabel,
  minOrderLabel,
  deliveryLabel,
  freshnessLabel,
  expired,
  stale,
  sponsored,
  privatePrice,
  href,
  onOpen,
  feesNote,
}: ListingProps) {
  const announced = `${sponsored ? "إعلان ممول: " : ""}${title} من ${seller}${verified ? " — منشأة موثّقة الهوية" : ""}`;
  return (
    <article
      className={`c-listing${expired ? " c-listing--expired" : ""}`}
      data-sponsored={sponsored || undefined}
    >
      <a
        className="c-listing__link"
        href={href}
        aria-label={announced}
        onClick={(e) => {
          if (onOpen) {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="c-listing__image" aria-hidden="true">
          {image}
        </div>
        <div className="c-listing__body">
          {sponsored ? <span className="c-listing__sponsored">إعلان ممول</span> : null}
          <h3 className="c-listing__title">{title}</h3>
          <p className="c-listing__seller">
            {seller}
            {verified ? (
              <span className="c-listing__verified">
                <BadgeCheck size={14} aria-hidden="true" /> موثّقة الهوية
              </span>
            ) : null}
          </p>
          <p className="c-listing__price">
            {privatePrice ? (
              <span>سعر خاص — يتطلب تسجيل الدخول</span>
            ) : priceMinor === null ? (
              <span>اطلب السعر</span>
            ) : (
              <>
                <span className="sting-mono">{formatMinor(priceMinor)}</span>{" "}
                <span className="c-money__currency">{currency}</span> / {unitLabel}
              </>
            )}
          </p>
          <ul className="c-listing__meta">
            {minOrderLabel ? <li>{minOrderLabel}</li> : null}
            {deliveryLabel ? <li>{deliveryLabel}</li> : null}
            {feesNote ? <li className="c-listing__fees">{feesNote}</li> : null}
          </ul>
          <p className="c-listing__fresh">
            <Clock size={12} aria-hidden="true" /> {freshnessLabel}
            {expired ? (
              <>
                {" "}
                <Status state="expired" label="يحتاج تأكيد السعر والتوفر" />
              </>
            ) : stale ? (
              <>
                {" "}
                <Status state="stale" />
              </>
            ) : null}
          </p>
        </div>
      </a>
    </article>
  );
}

export interface CompareRow {
  readonly seller: string;
  /** السعر بعد التوحيد إلى الوحدة المؤكدة؛ null = لا يمكن التوحيد. */
  readonly unitPriceMinor: string | null;
  readonly feesIncluded: boolean;
  readonly note?: string | undefined;
}

export interface CompareProps {
  readonly unitLabel: string;
  readonly currency: string;
  readonly rows: readonly CompareRow[];
}

/** مقارنة بوحدة واحدة: لا «الأرخص» إن اختلفت الوحدة أو غابت الرسوم (ACC-122). */
export function Compare({ unitLabel, currency, rows }: CompareProps) {
  const comparable = rows.every((r) => r.unitPriceMinor !== null && r.feesIncluded);
  let cheapest: string | null = null;
  if (comparable) {
    let min: bigint | null = null;
    for (const r of rows) {
      const v = BigInt(r.unitPriceMinor!);
      if (min === null || v < min) {
        min = v;
        cheapest = r.seller;
      }
    }
  }
  return (
    <table className="c-ledline c-compare">
      <caption className="c-field__label">المقارنة بـ{unitLabel}</caption>
      <thead>
        <tr>
          <th scope="col">المورد</th>
          <th scope="col" className="c-table__num">
            السعر / {unitLabel}
          </th>
          <th scope="col">الرسوم</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.seller} data-cheapest={cheapest === r.seller || undefined}>
            <td data-label="المورد">
              {r.seller}
              {cheapest === r.seller ? (
                <span className="c-listing__cheapest"> — الأقل سعراً</span>
              ) : null}
            </td>
            <td data-label="السعر" className="c-table__num">
              {r.unitPriceMinor === null ? (
                <span>لا يمكن التوحيد — الوحدة مختلفة</span>
              ) : (
                <span className="sting-mono">{formatMinor(r.unitPriceMinor)}</span>
              )}{" "}
              {r.unitPriceMinor !== null ? (
                <span className="c-money__currency">{currency}</span>
              ) : null}
            </td>
            <td data-label="الرسوم">
              {r.feesIncluded ? "مشمولة" : "غير محسومة — تظهر قبل التأكيد"}
            </td>
          </tr>
        ))}
      </tbody>
      {!comparable ? (
        <tfoot>
          <tr>
            <td colSpan={3} className="c-field__hint">
              لا تُعرض «الأقل سعراً» عند اختلاف الوحدة أو غياب الرسوم.
            </td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
