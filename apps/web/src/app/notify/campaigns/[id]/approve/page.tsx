import { CampaignApproveClient } from "@/features/notify/campaign-approve-client";

/** NOT-05 — معاينة واعتماد وجدولة (36-D28 ready/saving/expired/success · 17-D12 validation_error). */
export default async function CampaignApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignApproveClient id={id} />;
}
