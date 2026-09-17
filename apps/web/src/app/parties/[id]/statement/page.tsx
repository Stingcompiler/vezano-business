import { StatementClient } from "@/features/parties/statement-client";

/** PTY-05 — كشف الحساب (04-D2 pending_sync · 40-D32 ready/loading/empty/stale/offline/permission_denied). */
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StatementClient partyId={id} />;
}
