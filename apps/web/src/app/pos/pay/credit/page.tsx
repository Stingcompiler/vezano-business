import { CreditClient } from "@/features/pos/credit-client";

/** POS-06 — الدفع الآجل (42-D34 ready/validation_error/permission_denied/saved_local · 03-D2 stale). */
export default function CreditPayPage() {
  return <CreditClient />;
}
