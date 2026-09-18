import { RecoveryClient } from "@/features/sys/recovery-client";

/** SYS-07 — استرداد جهاز مسحوب (19-D14 ready/permission_denied/conflict/success · 16-D11 pending_sync). */
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <RecoveryClient selectedId={id ?? ""} />;
}
