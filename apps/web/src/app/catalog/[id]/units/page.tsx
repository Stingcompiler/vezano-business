import { UnitsClient } from "@/features/catalog/units-client";

/** CAT-03 — وحدات وتحويلات وباركود (05-D2 ready · 38-D30 validation_error/success). */
export default async function ItemUnitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UnitsClient itemId={id} />;
}
