import { InviteClient } from "./invite-client";

/** ACC-06 — قبول دعوة موظف أو منشأة سوق (28-D21 ready/expired · 34-D26 permission_denied/success/server_error). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteClient token={token} />;
}
