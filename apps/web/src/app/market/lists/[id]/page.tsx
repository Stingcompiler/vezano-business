import { PriceListsClient } from "@/features/market/lists-client";

/** MP-12 — قائمة خاصة بعينها؛ غير أهلها يرى «الرابط لم يعد صالحاً». */
export default async function MarketListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PriceListsClient listId={id} />;
}
