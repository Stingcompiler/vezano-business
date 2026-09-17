import { PartyCardClient } from "@/features/parties/party-card-client";

/** PTY-03 — بطاقة طرف (04-D2 ready · 40-D32 validation_error/saving/success/permission_denied · 15-D10 conflict). */
export default async function PartyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PartyCardClient partyId={id} />;
}
