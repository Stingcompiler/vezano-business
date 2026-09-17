import { DuplicatesClient } from "@/features/pos/duplicates-client";

/** POS-12 — مراجعة تكرار تجاري أو تصحيح (03-D2 conflict · 42-D34 ready/empty/permission_denied). */
export default function DuplicatesPage() {
  return <DuplicatesClient />;
}
