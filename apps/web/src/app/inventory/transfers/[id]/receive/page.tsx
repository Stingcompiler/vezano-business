import { TransferReceiveClient } from "@/features/inventory/transfer-receive-client";

/** INV-10 — استلام تحويل جزئي ومراجعة فرق (05-D2 partial · 40-D32 ready/validation_error/conflict/success). */
export default async function TransferReceivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferReceiveClient transferId={id} />;
}
