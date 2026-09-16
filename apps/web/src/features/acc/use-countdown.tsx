"use client";

import { useCallback, useEffect, useState } from "react";

/** عدّاد تنازلي معلن بالثواني — للتأخير التصاعدي (D26) ولإعادة الإرسال (D8). */
export function useCountdown(): { remaining: number; startFrom: (seconds: number) => void } {
  const [until, setUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setUntil(null);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [until]);
  const startFrom = useCallback((seconds: number) => {
    setUntil(seconds > 0 ? Date.now() + seconds * 1000 : null);
    setRemaining(Math.max(0, seconds));
  }, []);
  return { remaining, startFrom };
}
