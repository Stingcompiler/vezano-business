/**
 * C-FILTER — شريط مرشّحات، وسوم مطبّقة، ترقيم صفحات، تحميل المزيد.
 * الوسوم تتراكم من البداية؛ «مسح الكل» في الطرف النهائي؛ Backspace على وسم يحذفه؛
 * كل تغيير يُعلن عدد النتائج الجديد؛ الفلتر النشط معروض مع عدد ما أخفاه (R-10).
 */
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "./Button";

export interface FilterChip {
  readonly key: string;
  readonly label: string;
}

export interface FilterBarProps {
  readonly children?: ReactNode;
  readonly chips: readonly FilterChip[];
  readonly onRemove: (key: string) => void;
  readonly onClearAll: () => void;
  /** عدد النتائج بعد الترشيح — يُعلن في live region. */
  readonly resultCount: number;
  /** عدد ما أخفاه الفلتر — يُعرض مع الفلتر النشط (R-10). */
  readonly hiddenCount?: number | undefined;
  /** نص العدّ من الإطار (يُمرَّر لأن الصياغة العربية للعدد تتبع المعدود). */
  readonly countLabel: (n: number, hidden: number | undefined) => string;
}

export function FilterBar({
  children,
  chips,
  onRemove,
  onClearAll,
  resultCount,
  hiddenCount,
  countLabel,
}: FilterBarProps) {
  return (
    <div className="c-filter">
      {children ? <div className="c-filter__controls">{children}</div> : null}
      {chips.length > 0 ? (
        <ul className="c-filter__chips" aria-label="المرشّحات المطبّقة">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                className="c-filter__chip"
                aria-label={`إزالة المرشّح ${chip.label}`}
                onClick={() => onRemove(chip.key)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" || e.key === "Delete") {
                    e.preventDefault();
                    onRemove(chip.key);
                  }
                }}
              >
                {chip.label}
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
          <li className="c-filter__clear">
            <Button variant="quiet" onClick={onClearAll}>
              مسح الكل
            </Button>
          </li>
        </ul>
      ) : null}
      <p className="c-filter__count" role="status" aria-live="polite">
        {countLabel(resultCount, chips.length ? hiddenCount : undefined)}
      </p>
    </div>
  );
}

export interface PaginationProps {
  readonly page: number;
  readonly pageCount: number;
  readonly onPage: (page: number) => void;
}

export function Pagination({ page, pageCount, onPage }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav className="c-filter__pagination" aria-label="ترقيم الصفحات">
      <Button
        variant="secondary"
        onClick={() => onPage(page - 1)}
        disabledReason={page <= 1 ? "هذه الصفحة الأولى" : undefined}
      >
        السابقة
      </Button>
      <span aria-current="page">
        <span className="sting-mono">{page}</span> / <span className="sting-mono">{pageCount}</span>
      </span>
      <Button
        variant="secondary"
        onClick={() => onPage(page + 1)}
        disabledReason={page >= pageCount ? "هذه الصفحة الأخيرة" : undefined}
      >
        التالية
      </Button>
    </nav>
  );
}

export interface LoadMoreProps {
  readonly onLoadMore: () => void;
  readonly loading?: boolean | undefined;
  readonly remaining?: number | undefined;
  readonly label?: string;
}

export function LoadMore({
  onLoadMore,
  loading,
  remaining,
  label = "تحميل المزيد",
}: LoadMoreProps) {
  if (remaining === 0) return null;
  return (
    <div className="c-filter__more">
      <Button variant="secondary" onClick={onLoadMore} loading={loading}>
        {label}
        {remaining !== undefined ? (
          <>
            {" "}
            (<span className="sting-mono">{remaining}</span>)
          </>
        ) : null}
      </Button>
    </div>
  );
}
