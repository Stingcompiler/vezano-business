import { ProblemClient } from "@/features/pos/problem-client";

/** POS-11 — فشل الحفظ أو الطباعة (33-D25 offline/saved_local/validation_error/server_error). */
export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProblemClient saleId={id} />;
}
