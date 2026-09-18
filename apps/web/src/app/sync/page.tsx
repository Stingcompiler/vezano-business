import { SyncCenterClient } from "@/features/sys/sync-center-client";

/** SYS-01 — مركز الاتصال والمزامنة (07-D3 ready/synced/stale/server_error · 16-D11 pending_sync/offline). */
export default function SyncPage() {
  return <SyncCenterClient />;
}
