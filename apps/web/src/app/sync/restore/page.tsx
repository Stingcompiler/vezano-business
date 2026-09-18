import { RestoreClient } from "@/features/sys/restore-client";

/** SYS-06 — استعادة نسخة ومعاينتها (16-D11 ready/validation_error/conflict/partial/success/server_error). */
export default function RestorePage() {
  return <RestoreClient />;
}
