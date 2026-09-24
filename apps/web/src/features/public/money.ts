/**
 * أسعار الباقات بالجنيه الصحيح (0005 §١٢٧): «45,000» لا «45,000.00» — الكسر العشري ضجيج في سعر
 * لا قروش فيه. غير الصحيح يبقى بخانتيه. العملة «ج.س» تُكتب بجانبه في الصفحة.
 */
export function pounds(minor: string | number): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return "—";
  const whole = n % 100 === 0;
  return (n / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}
