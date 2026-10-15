import { Suspense } from "react";

import { LegalClient } from "@/features/public/legal-client";
import { pageMetadata } from "@/features/public/site";

export const metadata = pageMetadata(
  "الشروط وسياسة الخصوصية",
  "شروط استخدام فيزانو بلص وسياسة الخصوصية: بياناتك ملكك، وتصديرها متاح في أي وقت، ولا نبيعها.",
  "/legal",
);

/** PUB-02 — الخصوصية وشروط السوق والمساعدة (ready/loading/phase_locked). */
export default function LegalPage() {
  return (
    <Suspense fallback={null}>
      <LegalClient />
    </Suspense>
  );
}
