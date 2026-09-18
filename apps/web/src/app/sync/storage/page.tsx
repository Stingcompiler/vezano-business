import { StorageClient } from "@/features/sys/storage-client";

/** SYS-04 — انخفاض التخزين أو فشل استدامته (16-D11 ready/validation_error/server_error). */
export default async function StoragePage({
  searchParams,
}: {
  searchParams: Promise<{ blocked?: string }>;
}) {
  const { blocked } = await searchParams;
  return <StorageClient blocked={blocked ?? ""} />;
}
