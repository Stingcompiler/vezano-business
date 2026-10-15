import { MarketHomeClient } from "@/features/market/home-client";
import { pageMetadata } from "@/features/public/site";

export const metadata = pageMetadata(
  "السوق",
  "سوق فيزانو بلص: عروض الموردين والموزّعين للمحلات.",
  "/market",
);

/** MP-01 — رئيسية السوق (بلا حساب). */
export default function MarketHomePage() {
  return <MarketHomeClient />;
}
