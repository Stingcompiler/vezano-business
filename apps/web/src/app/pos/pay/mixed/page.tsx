import { MixedClient } from "@/features/pos/mixed-client";

/** POS-07 — الدفع المختلط والتحويل (03-D2 ready · 42-D34 validation_error/saving/saved_local/success/server_error · 14-D9 partial). */
export default function MixedPayPage() {
  return <MixedClient />;
}
