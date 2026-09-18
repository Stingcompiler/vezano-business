import { UpdateClient } from "@/features/sys/update-client";

/** SYS-09 — تحديث التطبيق مع عمليات معلقة (19-D14 ready/pending_sync/success/server_error · 16-D11 validation_error). */
export default async function UpdatePage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string }>;
}) {
  const { updated } = await searchParams;
  return <UpdateClient updated={updated ?? ""} />;
}
