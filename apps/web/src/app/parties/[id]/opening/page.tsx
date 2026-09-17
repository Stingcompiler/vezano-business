import { OpeningClient } from "@/features/parties/opening-client";

/** PTY-04 — رصيد افتتاحي (04-D2 ready · 40-D32 validation_error/permission_denied/success). */
export default async function OpeningPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpeningClient partyId={id} />;
}
