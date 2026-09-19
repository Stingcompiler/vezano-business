import { DocumentClient } from "@/features/purchasing/document-client";

/** PUR-03 — مستند الشراء واعتماده (32-D24 ready/validation_error/permission_denied/success). */
export default async function PurchaseDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DocumentClient documentId={id} />;
}
