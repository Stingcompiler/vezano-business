import { CorrectionClient } from "@/features/parties/correction-client";

/** PTY-09 — تصحيح تاريخ الأعمال (04-D2 ready · 40-D32 validation_error/permission_denied/success). */
export default async function CorrectionPage({
  params,
}: {
  params: Promise<{ receiptId: string }>;
}) {
  const { receiptId } = await params;
  return <CorrectionClient receiptId={receiptId} />;
}
