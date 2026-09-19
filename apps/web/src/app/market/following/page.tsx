import { Suspense } from "react";

import { FollowingClient } from "@/features/market/following-client";

/** MP-06 — متابعة مورد (`?follow=` من زر «تابع هذا المورد» في MP-03). */
export default function MarketFollowingPage() {
  return (
    <Suspense fallback={null}>
      <FollowingClient />
    </Suspense>
  );
}
