import { ReceiptClient } from "@/features/pos/receipt-client";

/** POS-08 — نجاح البيع والإيصال (03-D2 saved_local/synced · 42-D34 pending_sync/success/server_error). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptClient saleId={id} />;
}
