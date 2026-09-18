import { ReviewClient } from "@/features/sys/review-client";

/** SYS-03 — تعارض وحجر ومراجعة مالك (07-D3 ready/conflict/permission_denied/success). */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; op?: string }>;
}) {
  const { id, op } = await searchParams;
  return <ReviewClient selectedId={id ?? ""} operationId={op ?? ""} />;
}
