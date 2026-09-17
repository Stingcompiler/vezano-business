import { MovementsClient } from "@/features/inventory/movements-client";

/** INV-02 — سجل حركة الصنف (28-D21 ready/pending_sync/stale · 40-D32 loading/empty). */
export default async function ItemMovementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ branch?: string; range?: string }>;
}) {
  const { id } = await params;
  const { branch, range } = await searchParams;
  return (
    <MovementsClient itemId={id} branchId={branch ?? ""} range={range === "all" ? "all" : "30"} />
  );
}
