"use client";

import { useEffect, useState } from "react";

/** يطابق استعلام وسائط في المتصفح؛ على الخادم false (CSR) — لتبديل سطح التابلت S-01 (46-D37). */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
