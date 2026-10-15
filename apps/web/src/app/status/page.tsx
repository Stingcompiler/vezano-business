import { StatusClient } from "@/features/public/status-client";
import { pageMetadata } from "@/features/public/site";

export const metadata = pageMetadata(
  "حالة الخدمة",
  "حالة خدمات فيزانو بلص الآن، وما يعمل عندك بلا اتصال حتى أثناء أي تعطّل.",
  "/status",
);

/** PUB-03 — حالة الخدمة والصيانة (ready/stale/server_error). */
export default function StatusPage() {
  return <StatusClient />;
}
