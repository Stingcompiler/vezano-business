import { TransferNewClient } from "@/features/inventory/transfer-new-client";

/** INV-09 — إنشاء وإرسال تحويل (28-D21 ready/validation_error/success · 40-D32 saving/saved_local · 14-D9 partial). */
export default async function TransferNewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <TransferNewClient viewId={id ?? ""} />;
}
