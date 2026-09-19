import { ShopClient } from "@/features/portal/shop-client";

/** CUS-01 — صفحة محل عبر رابط أو QR (loading/ready/empty/expired). `?c=` رابط حملة مؤقت. */
export default async function PortalShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { slug } = await params;
  const { c } = await searchParams;
  return <ShopClient slug={slug} campaign={c ?? ""} />;
}
