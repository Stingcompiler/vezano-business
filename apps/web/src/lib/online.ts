"use client";

import { useEffect, useState } from "react";

/** «هناك شبكة» بحسب المتصفح — لا يعني نجاح الوصول للخادم (§١٣.٦)؛ ذاك يُفحص بـ /api/health. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
