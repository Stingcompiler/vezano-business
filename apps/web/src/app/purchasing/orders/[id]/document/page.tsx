import { DocumentClient } from "@/features/purchasing/document-client";

/** PUR-03 من أمر: يبدأ المستند من الأمر (أو يعيد مسوّدته القائمة). */
export default async function OrderDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentClient orderId={id} />;
}
