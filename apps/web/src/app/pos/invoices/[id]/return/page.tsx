import { ReturnClient } from "@/features/pos/return-client";

/** POS-10 — مرتجع كلي أو جزئي (03-D2 partial · 42-D34 ready/validation_error/permission_denied/saved_local/success). */
export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnClient saleId={id} />;
}
