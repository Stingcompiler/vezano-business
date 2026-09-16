/**
 * C-TIMELIST — خط زمني لطلب، سجل حركات، قائمة إشعارات، سجل تدقيق (مالك فقط — R-04).
 * الحالات: ready, loading, empty, stale, partial. الخط عمودي بمحور على البداية؛ الأحدث أولاً.
 * قائمة دلالية مع وقت مقروء نصاً كاملاً في العنوان (لا «منذ ٣د» فقط). Enter يفتح التفصيل.
 */
import type { ReactNode } from "react";

export interface TimeEntry {
  readonly id: string;
  /** ISO 8601 — يُعرض بالنص الكامل. */
  readonly at: string;
  /** النص المعروض للوقت (يُنسَّق في التطبيق بحسب اللغة؛ mono للأرقام). */
  readonly atLabel: string;
  readonly title: string;
  readonly detail?: ReactNode;
  /** الفاعل باسمه (R-04). */
  readonly actor?: string | undefined;
  readonly badge?: ReactNode;
}

export interface TimeListProps {
  readonly label: string;
  readonly entries: readonly TimeEntry[];
  readonly onOpen?: ((entry: TimeEntry) => void) | undefined;
  readonly loading?: number | undefined;
  readonly empty?: ReactNode;
}

export function TimeList({ label, entries, onOpen, loading, empty }: TimeListProps) {
  if (loading) {
    return (
      <ol className="c-timelist" aria-label={label} aria-busy="true">
        {Array.from({ length: loading }, (_, i) => (
          <li key={i} className="c-timelist__item c-table__skeleton" aria-hidden="true">
            <span className="c-table__bone" />
          </li>
        ))}
      </ol>
    );
  }
  if (entries.length === 0) return <div className="c-timelist__empty">{empty}</div>;
  return (
    <ol className="c-timelist" aria-label={label}>
      {entries.map((e) => {
        const content = (
          <>
            <time dateTime={e.at} title={e.at} className="c-timelist__time sting-mono">
              {e.atLabel}
            </time>
            <div className="c-timelist__body">
              <p className="c-timelist__title">
                {e.title}
                {e.badge ? <> {e.badge}</> : null}
              </p>
              {e.actor ? <p className="c-timelist__actor">{e.actor}</p> : null}
              {e.detail ? <div className="c-timelist__detail">{e.detail}</div> : null}
            </div>
          </>
        );
        return (
          <li key={e.id} className="c-timelist__item">
            {onOpen ? (
              <button type="button" className="c-timelist__open" onClick={() => onOpen(e)}>
                {content}
              </button>
            ) : (
              <div className="c-timelist__open">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
