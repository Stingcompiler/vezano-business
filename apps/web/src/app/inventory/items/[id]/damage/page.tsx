import { DamageClient } from "@/features/inventory/damage-client";

/** INV-07 — هالك وحجر تالف (05-D2 ready · 40-D32 validation_error/permission_denied/success). */
export default async function DamagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DamageClient itemId={id} />;
}
