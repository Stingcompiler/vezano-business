import { InvoiceDetailClient } from "@/features/pos/invoice-detail-client";

/** POS-09 (تفاصيل) — الفاتورة بسطورها ووضع مزامنتها وجودة تاريخها. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetailClient saleId={id} />;
}
