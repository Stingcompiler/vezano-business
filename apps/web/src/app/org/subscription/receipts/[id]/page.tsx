import { ReceiptClient } from "@/features/org/receipt-client";

/** إيصال اشتراك للطباعة (0005 §١١١). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptClient id={id} />;
}
