"use client";

import { HomeClient } from "@/features/home/home-client";
import { AboutClient } from "@/features/public/about-client";
import { useApp } from "@/lib/app-context";

/** الجذر: الرئيسية (HOME-01/02) لمن له جلسة داخل منشأة؛ وإلا PUB-01 تعريف Sting والباقات. */
export function RootClient() {
  const app = useApp();
  if (app.tokens && app.session.tenantId) return <HomeClient />;
  return <AboutClient />;
}
