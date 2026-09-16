import { RootClient } from "./root-client";

/** الجذر: الرئيسية (HOME-01/02) لمن له جلسة داخل منشأة؛ وإلا صفحة عامة تقود إلى الترحيب. */
export default function RootPage() {
  return <RootClient />;
}
