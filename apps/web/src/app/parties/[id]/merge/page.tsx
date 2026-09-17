import { MergeClient } from "@/features/parties/merge-client";

/** PTY-07 — دمج أطراف (04-D2 ready · 40-D32 validation_error/permission_denied/conflict/success). */
export default async function MergePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ target?: string }>;
}) {
  const { id } = await params;
  const { target } = await searchParams;
  return <MergeClient sourceId={id} targetId={target ?? ""} />;
}
