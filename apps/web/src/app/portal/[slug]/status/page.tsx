import { PortalStatusClient } from "@/features/portal/status-client";

/** CUS-05 — إذن مرفوض أو اشتراك منتهٍ. */
export default async function PortalStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PortalStatusClient slug={slug} />;
}
