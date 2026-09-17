import { PayClient } from "@/features/pos/pay-client";

/** POS-05 — الدفع النقدي (03-D2 ready · 14-D9 validation_error · 42-D34 saving/saved_local/success) + خط حفظ البيع. */
export default function PayPage() {
  return <PayClient />;
}
