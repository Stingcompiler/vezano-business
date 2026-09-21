import { Suspense } from "react";

import { TenantsClient } from "@/features/platform/tenants-client";

/** PLT-02 — المستأجرون. */
export default function PlatformTenantsPage() {
  return (
    <Suspense fallback={null}>
      <TenantsClient />
    </Suspense>
  );
}
