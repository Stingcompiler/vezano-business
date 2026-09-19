import { OrdersClient } from "@/features/purchasing/orders-client";

/** PUR-01 — أوامر الشراء الداخلية (32-D24 ready/loading/empty/permission_denied). */
export default function PurchaseOrdersPage() {
  return <OrdersClient />;
}
