import { OperationClient } from "@/features/sys/operation-client";

/** SYS-02 — تفاصيل عملية متعثرة (16-D11 ready/empty/server_error/conflict/pending_sync). */
export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperationClient operationId={id} />;
}
