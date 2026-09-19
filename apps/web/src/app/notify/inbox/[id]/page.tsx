import { InboxClient } from "@/features/notify/inbox-client";

/** NOT-01 — الرابط العميق إلى إشعار بعينه: يُعاد فحص التخويل على الخادم (ACC-113). */
export default async function InboxItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InboxClient initialId={id} />;
}
