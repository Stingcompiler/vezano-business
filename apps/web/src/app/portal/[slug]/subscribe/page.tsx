import { SubscribeClient } from "@/features/portal/subscribe-client";

/** CUS-02 — اشتراك وإذن تنبيه (ready/validation_error/permission_denied/success). */
export default async function PortalSubscribePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <SubscribeClient slug={slug} />;
}
