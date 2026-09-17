import { PosClient } from "@/features/pos/pos-client";

/** POS-01 — نقطة البيع والسلة (03-D2 ready · 42-D34 loading/empty/offline/stale/permission_denied · 46-D37 S-01) + POS-02. */
export default function PosPage() {
  return <PosClient />;
}
