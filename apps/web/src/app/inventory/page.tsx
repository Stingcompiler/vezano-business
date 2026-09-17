import { StockClient } from "@/features/inventory/stock-client";

/** INV-01 — أرصدة المخزون (05-D2 pending_sync · 40-D32 ready/loading/empty/stale/offline · 14-D9 partial). */
export default function InventoryPage() {
  return <StockClient />;
}
