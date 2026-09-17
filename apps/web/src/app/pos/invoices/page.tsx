import { InvoicesClient } from "@/features/pos/invoices-client";

/** POS-09 — قائمة الفواتير وتفاصيلها (03-D2 ready · 42-D34 loading/empty/offline/stale/pending_sync/permission_denied). */
export default function InvoicesPage() {
  return <InvoicesClient />;
}
