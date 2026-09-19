import { ReturnClient } from "@/features/purchasing/return-client";

/** PUR-04 — مرتجع مسجَّل وردّ المورد عليه (partial). */
export default async function PurchaseReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnClient returnId={id} />;
}
