import { TransfersClient } from "@/features/inventory/transfers-client";

/** INV-08 — قائمة التحويلات (40-D32 ready/loading/empty/partial · 14-D9 pending_sync). */
export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <TransfersClient selectedId={id ?? ""} />;
}
