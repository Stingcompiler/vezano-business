import { PlansClient } from "@/features/public/plans-client";
import { pageMetadata } from "@/features/public/site";

export const metadata = pageMetadata(
  "الباقات والأسعار",
  "أسعار فيزانو بلص معلنة قبل التسجيل: باقات شهرية وربعية وسنوية، وتجربة 30 يوماً بلا بطاقة.",
  "/plans",
);

/** PUB-05 — الباقات والمقارنة (بأمر المالك 2026-09-21؛ ready/loading/offline). */
export default function PlansPage() {
  return <PlansClient />;
}
