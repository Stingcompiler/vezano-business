import { TenantDetailClient } from "@/features/platform/tenant-detail-client";

/** PLT-02/detail — تفاصيل الاستحقاق. */
export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TenantDetailClient id={id} />;
}
