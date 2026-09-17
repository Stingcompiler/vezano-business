import { PaymentClient } from "@/features/parties/payment-client";

/** PTY-06 — تسجيل سداد أو رد مبلغ (04-D2 ready · 33-D25 validation_error/saving/saved_local/success/permission_denied). */
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentClient partyId={id} />;
}
