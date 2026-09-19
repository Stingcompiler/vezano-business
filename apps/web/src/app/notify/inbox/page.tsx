import { InboxClient } from "@/features/notify/inbox-client";

/** NOT-01 — صندوق الوارد (17-D12 ready · 36-D28 loading/empty/expired/permission_denied). */
export default function InboxPage() {
  return <InboxClient />;
}
