import { Suspense } from "react";

import { InviteOpenClient } from "@/features/market/share-client";

/** MP-07 — رابط مشاركة/دعوة مفتوح (عام). */
export default async function InviteOpenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Suspense fallback={null}>
      <InviteOpenClient token={token} />
    </Suspense>
  );
}
