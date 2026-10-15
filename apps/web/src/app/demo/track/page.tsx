import { DemoTrackClient } from "@/features/public/demo-track-client";
import { pageMetadata } from "@/features/public/site";

export const metadata = pageMetadata(
  "متابعة طلب الجولة",
  "تابع حالة طلب الجولة وتعليقات فريق فيزانو برمز يصل إلى بريدك.",
  "/demo/track",
);

/** PUB-06 — متابعة طلب الجولة برمز إلى بريد الطلب (بأمر المالك 2026-10-02؛ 0005 §١٤٧). */
export default function DemoTrackPage() {
  return <DemoTrackClient />;
}
