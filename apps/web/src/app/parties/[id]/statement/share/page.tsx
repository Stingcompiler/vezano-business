import { ShareClient } from "@/features/parties/share-client";

/** PTY-08 — طباعة وتصدير ومشاركة الكشف (04-D2 ready · 40-D32 loading/permission_denied/success/server_error). */
export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const { range } = await searchParams;
  return <ShareClient partyId={id} range={range === "all" ? "all" : "30"} />;
}
