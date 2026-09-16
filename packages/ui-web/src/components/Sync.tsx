/**
 * C-SYNC — مؤشر مصغّر في الهيكل، لوحة تفصيل الطابور، عدّاد تعارضات، زر مزامنة يدوية.
 * الحالات: offline, saving, saved_local, pending_sync, synced, conflict, server_error.
 * لا رقم مالي بلا بيان تغطيته الزمنية؛ الصيغة الموحدة: «آخر تحديث خادمي [وقت] + عمليات هذا الجهاز
 * المعلقة». تغيّر الحالة يُعلن عبر live region مهذّب؛ «محفوظ محلياً» لا يُعلن «تم» (23-Handoff).
 */
import { type StateCode, stateLabel } from "@sting/design";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "./Button";
import { Status } from "./Status";

export type SyncState = Extract<
  StateCode,
  "offline" | "saving" | "saved_local" | "pending_sync" | "synced" | "conflict" | "server_error"
>;

export interface SyncIndicatorProps {
  readonly state: SyncState;
  /** «10:30» — وقت آخر تأكيد خادمي؛ null إن لم يحدث بعد. */
  readonly lastServerAt: string | null;
  readonly pendingCount: number;
  readonly conflictCount?: number;
  readonly onOpen?: (() => void) | undefined;
  readonly onSyncNow?: (() => void) | undefined;
  readonly syncing?: boolean | undefined;
  /** الصياغة العربية للعدد تتبع المعدود — يُمرَّر النص من الإطار. */
  readonly pendingLabel: (n: number) => string;
}

/** الصيغة الموحدة (§١٤.١): «آخر تحديث خادمي 10:30 — يشمل عمليات هذا الجهاز المعلقة». */
export function coverageText(
  lastServerAt: string | null,
  pendingCount: number,
  pendingLabel: (n: number) => string,
): string {
  const base = lastServerAt ? `آخر تحديث خادمي ${lastServerAt}` : "لم يتأكد شيء خادمياً بعد";
  return pendingCount > 0 ? `${base} — يشمل ${pendingLabel(pendingCount)}` : base;
}

export function SyncIndicator({
  state,
  lastServerAt,
  pendingCount,
  conflictCount = 0,
  onOpen,
  onSyncNow,
  syncing,
  pendingLabel,
}: SyncIndicatorProps) {
  const [live, setLive] = useState("");
  useEffect(() => {
    // «محفوظ محلياً» لا يُعلن «تم»
    setLive(
      state === "synced"
        ? "مؤكد خادمياً"
        : state === "saved_local"
          ? "محفوظ محلياً — لم يصل الخادم بعد"
          : stateLabel[state],
    );
  }, [state]);
  const summary = (
    <>
      <Status state={state} />
      <span className="c-sync__coverage">
        {lastServerAt ? (
          <>
            آخر تحديث <span className="sting-mono">{lastServerAt}</span>
          </>
        ) : (
          "لم يتأكد شيء خادمياً بعد"
        )}
      </span>
      {pendingCount > 0 ? (
        <span className="c-sync__pending">{pendingLabel(pendingCount)}</span>
      ) : null}
      {conflictCount > 0 ? (
        <span className="c-sync__conflicts">
          <span className="sting-mono">{conflictCount}</span> تعارض يحتاج مراجعة المالك
        </span>
      ) : null}
    </>
  );
  return (
    <div className="c-sync" data-state={state}>
      {onOpen ? (
        <button type="button" className="c-sync__button" onClick={onOpen} aria-haspopup="dialog">
          {summary}
        </button>
      ) : (
        <div className="c-sync__button">{summary}</div>
      )}
      {onSyncNow ? (
        <Button
          variant="icon"
          iconLabel="مزامنة الآن"
          icon={<RefreshCw size={18} />}
          onClick={onSyncNow}
          loading={syncing}
          disabledReason={state === "offline" ? "بلا اتصال — تُرفع عند العودة" : undefined}
        />
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {live}
      </span>
    </div>
  );
}

export interface QueueItem {
  readonly id: string;
  readonly title: string;
  readonly state: Extract<
    StateCode,
    "saved_local" | "pending_sync" | "synced" | "conflict" | "server_error"
  >;
  readonly atLabel: string;
  readonly amountLabel?: string | undefined;
}

export interface SyncQueueProps {
  readonly items: readonly QueueItem[];
  readonly empty: string;
}

export function SyncQueue({ items, empty }: SyncQueueProps) {
  if (items.length === 0) return <p className="c-field__hint">{empty}</p>;
  return (
    <ul className="c-sync__queue" aria-label="طابور المزامنة">
      {items.map((it) => (
        <li key={it.id} className="c-sync__item">
          <span className="c-sync__item-title">{it.title}</span>
          <span className="sting-mono c-sync__item-at">{it.atLabel}</span>
          {it.amountLabel ? <span className="sting-mono">{it.amountLabel}</span> : null}
          <Status state={it.state} />
        </li>
      ))}
    </ul>
  );
}
