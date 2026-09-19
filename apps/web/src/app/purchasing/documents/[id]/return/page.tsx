import { ReturnClient } from "@/features/purchasing/return-client";

/** PUR-04 — مرتجع المشتريات على مستند (32-D24 ready/validation_error/partial/success). */
export default async function PurchaseReturnNewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReturnClient documentId={id} />;
}
