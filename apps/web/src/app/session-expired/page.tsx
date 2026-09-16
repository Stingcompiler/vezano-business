import { Suspense } from "react";

import { SessionExpiredClient } from "./session-expired-client";

/** ACC-08 — انتهاء الجلسة وإعادة المصادقة (06-D2 expired · 34-D26 offline/saved_local/pending_sync/success). */
export default function SessionExpiredPage() {
  return (
    <Suspense fallback={null}>
      <SessionExpiredClient />
    </Suspense>
  );
}
