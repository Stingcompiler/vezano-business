"use client";

import { agoParts } from "@/features/home/format";

/** «قبل 14 دقيقة» — الرقم داخل mono والمعدود عربي (الإطار: «قبل ٤٠ ثانية»، «قبل 14 دقيقة»). */
export function Ago({ iso }: { iso: string }) {
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  if (ms < 60_000) {
    return (
      <>
        <span className="sting-mono">{Math.max(1, Math.floor(ms / 1000))}</span> ثانية
      </>
    );
  }
  const { n, unit } = agoParts(iso);
  const word = unit === "minute" ? "دقيقة" : unit === "hour" ? "ساعة" : "يوماً";
  return (
    <>
      <span className="sting-mono">{n}</span> {word}
    </>
  );
}

/** «ERR-SYNC-409 · op 8f31c2 · dev POS-1» — سطر واحد للدعم بلا JSON ولا أثر مكدّس. */
export function supportLine(parts: {
  status?: number | string | undefined;
  operationId?: string | undefined;
  devicePrefix?: string | undefined;
}): string {
  const code = parts.status ? String(parts.status) : "0000";
  const bits = [`ERR-SYNC-${code}`];
  if (parts.operationId) bits.push(`op ${parts.operationId.replace(/-/g, "").slice(0, 6)}`);
  if (parts.devicePrefix) bits.push(`dev ${parts.devicePrefix}`);
  return bits.join(" · ");
}
