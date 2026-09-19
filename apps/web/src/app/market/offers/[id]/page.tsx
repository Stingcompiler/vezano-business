import { OfferEditClient } from "@/features/market/offer-edit-client";

/** MP-11 — تحرير عرض قائم. */
export default async function MarketOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OfferEditClient id={id} />;
}
