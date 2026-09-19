import { AuditClient } from "@/features/org/audit-client";

/** ORG-10 — سجل التدقيق (20-D15 ready/permission_denied · 39-D31 loading/empty). */
export default function OrgAuditPage() {
  return <AuditClient />;
}
