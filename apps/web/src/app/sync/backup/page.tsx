import { BackupClient } from "@/features/sys/backup-client";

/** SYS-05 — تصدير نسخة محلية (16-D11 ready/saving/validation_error/success/server_error). */
export default function BackupPage() {
  return <BackupClient />;
}
