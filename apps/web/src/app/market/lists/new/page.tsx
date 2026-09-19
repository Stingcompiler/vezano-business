import { PriceListsClient } from "@/features/market/lists-client";

/** MP-12 — قائمة خاصة جديدة على عرض (`?offer=`). */
export default async function MarketListNewPage({
  searchParams,
}: {
  searchParams: Promise<{ offer?: string }>;
}) {
  const { offer } = await searchParams;
  return <PriceListsClient offerId={offer ?? ""} />;
}
