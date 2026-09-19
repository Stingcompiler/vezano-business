import { Suspense } from "react";

import { InboxClient } from "@/features/portal/inbox-client";

/** CUS-03 — رسائل المحل وتفاصيلها (`?m=` رسالة، `?t=` رمز من رابط). */
export default async function PortalInboxPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <Suspense fallback={null}>
      <InboxClient slug={slug} />
    </Suspense>
  );
}
