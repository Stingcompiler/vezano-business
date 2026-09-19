import { StatusClient } from "@/features/public/status-client";

/** PUB-03 — حالة الخدمة والصيانة (ready/stale/server_error). */
export default function StatusPage() {
  return <StatusClient />;
}
