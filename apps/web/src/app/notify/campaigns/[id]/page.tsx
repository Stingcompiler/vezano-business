import { CampaignResultsClient } from "@/features/notify/campaign-results-client";

/** NOT-06 — نتائج حملة وإلغاؤها (36-D28 ready/empty/server_error/success · 07-D3 partial). */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignResultsClient id={id} />;
}
