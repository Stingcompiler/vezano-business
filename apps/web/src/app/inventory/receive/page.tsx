import { ReceiveClient } from "@/features/inventory/receive-client";

/** INV-04 — استلام بضاعة (28-D21 ready/saved_local · 40-D32 validation_error/saving/success). */
export default function ReceivePage() {
  return <ReceiveClient />;
}
