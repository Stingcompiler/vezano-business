import { Suspense } from "react";

import { LegalClient } from "@/features/public/legal-client";

/** PUB-02 — الخصوصية وشروط السوق والمساعدة (ready/loading/phase_locked). */
export default function LegalPage() {
  return (
    <Suspense fallback={null}>
      <LegalClient />
    </Suspense>
  );
}
