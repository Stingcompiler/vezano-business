import { Suspense } from "react";

import { CurrentShiftClient } from "@/features/shifts/current-client";

/** SHIFT-02 — الوردية الحالية (06-D2 pending_sync · 38-D30 ready/loading/offline · 15-D10 stale). */
export default function CurrentShiftPage() {
  return (
    <Suspense fallback={null}>
      <CurrentShiftClient />
    </Suspense>
  );
}
