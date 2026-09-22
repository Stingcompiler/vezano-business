import { Suspense } from "react";

import { RenewClient } from "@/features/org/renew-client";

/** ORG-07 — إثبات تحويل الاشتراك ومراجعته (27-D20 ready/validation_error/success · 21-D16 saving · 39-D31 server_error). */
export default function OrgRenewPage() {
  return (
    <Suspense fallback={null}>
      <RenewClient />
    </Suspense>
  );
}
