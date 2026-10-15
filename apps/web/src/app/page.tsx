import type { Metadata } from "next";

import { RootClient } from "./root-client";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** الجذر: الرئيسية (HOME-01/02) لمن له جلسة داخل منشأة؛ وإلا صفحة عامة تقود إلى الترحيب. */
export default function RootPage() {
  return <RootClient />;
}
