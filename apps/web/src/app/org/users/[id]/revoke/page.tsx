import { RevokeClient } from "@/features/org/revoke-client";

/** ORG-05 — سحب مستخدم أو نطاق أو جهاز (39-D31 ready/permission_denied/success · 20-D15 validation_error · 07-D3 pending_sync). */
export default async function OrgRevokePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RevokeClient userId={id} />;
}
