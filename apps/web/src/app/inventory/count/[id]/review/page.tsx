import { ReviewClient } from "@/features/inventory/review-client";

/** INV-06 — مراجعة فروق الجرد وتسوية (28-D21 ready/validation_error/permission_denied/success). */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewClient sessionId={id} />;
}
