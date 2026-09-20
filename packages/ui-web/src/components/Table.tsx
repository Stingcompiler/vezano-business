/**
 * C-TABLE — جدول كثيف ≥834px ← بطاقة صف <834px بنفس التسميات (02-Design-System):
 * ممنوع التمرير الأفقي لقراءة بيانات مالية؛ لا يُحذف عمود يحمل قراراً.
 * table دلالي مع scope على الرؤوس؛ الترتيب aria-sort؛ أعمدة المال mono محاذاة بداية؛
 * الحالات: ready, loading (هياكل صفوف), empty, stale, server_error, partial.
 * أسهم بين الخلايا، Home/End للصف، Enter يفتح الصف (23-Handoff).
 */
import { type KeyboardEvent, type ReactNode, useRef } from "react";

export interface Column<Row> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: Row) => ReactNode;
  /** مال/كمية/معرّف: mono + LTR (القاعدة 2). */
  readonly mono?: boolean;
  readonly sortable?: boolean;
  readonly width?: string;
}

export type SortDir = "ascending" | "descending";

export interface TableProps<Row> {
  readonly caption: string;
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  readonly sort?: { readonly key: string; readonly dir: SortDir } | undefined;
  readonly onSort?: ((key: string) => void) | undefined;
  readonly onOpenRow?: ((row: Row) => void) | undefined;
  /** loading: هياكل صفوف بعددها؛ لا دوّارة مفرغة. */
  readonly loading?: number | undefined;
  /** الحالة الفارغة تُمرَّر كعنصر C-NOTICE بفعلها (R-10). */
  readonly empty?: ReactNode;
  /** stale/partial/server_error: شريط فوق الجدول من C-NOTICE. */
  readonly notice?: ReactNode;
  /** يُجبر البطاقات (للاختبار وللأسطح الضيقة). */
  readonly forceCards?: boolean | undefined;
}

export function Table<Row>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  onOpenRow,
  loading,
  empty,
  notice,
  forceCards,
}: TableProps<Row>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLTableCellElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("td,th");
    if (!cell || !bodyRef.current) return;
    const tr = cell.parentElement as HTMLTableRowElement;
    const cells = [...tr.querySelectorAll<HTMLElement>("td,th")];
    const rowsEl = [...bodyRef.current.querySelectorAll<HTMLTableRowElement>("tr")];
    const ci = cells.indexOf(cell);
    const ri = rowsEl.indexOf(tr);
    const focusCell = (r: number, c: number) => {
      const target = rowsEl[r]?.querySelectorAll<HTMLElement>("td,th")[c];
      target?.focus();
    };
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusCell(ri, ci - 1); // RTL: يمين = السابق
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusCell(ri, ci + 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(ri + 1, ci);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(ri - 1, ci);
        break;
      case "Home":
        e.preventDefault();
        focusCell(ri, 0);
        break;
      case "End":
        e.preventDefault();
        focusCell(ri, cells.length - 1);
        break;
      case "PageDown":
        e.preventDefault();
        focusCell(Math.min(rowsEl.length - 1, ri + 10), ci);
        break;
      case "PageUp":
        e.preventDefault();
        focusCell(Math.max(0, ri - 10), ci);
        break;
      case "Enter":
        if (onOpenRow && rows[ri] !== undefined) {
          e.preventDefault();
          onOpenRow(rows[ri]);
        }
        break;
      default:
    }
  };

  const showEmpty = !loading && rows.length === 0;
  return (
    <div
      className={`c-table${forceCards ? " c-table--cards" : ""}`}
      data-loading={loading ? "true" : undefined}
    >
      {notice ? <div className="c-table__notice">{notice}</div> : null}
      <table className="c-table__table" role="grid">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const sorted = sort?.key === c.key ? sort.dir : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={c.sortable ? (sorted ?? "none") : undefined}
                  style={c.width ? { inlineSize: c.width } : undefined}
                  className={c.mono ? "c-table__num" : undefined}
                >
                  {c.sortable && onSort ? (
                    <button type="button" className="c-table__sort" onClick={() => onSort(c.key)}>
                      {c.header}
                      <span aria-hidden="true">
                        {sorted === "ascending" ? " ▲" : sorted === "descending" ? " ▼" : ""}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {loading
            ? Array.from({ length: loading }, (_, i) => (
                <tr key={`skeleton-${i}`} className="c-table__skeleton" aria-hidden="true">
                  {columns.map((c) => (
                    <td key={c.key}>
                      <span className="c-table__bone" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={onOpenRow ? "c-table__row--openable" : undefined}
                  onDoubleClick={onOpenRow ? () => onOpenRow(row) : undefined}
                >
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      tabIndex={i === 0 ? 0 : -1}
                      role="gridcell"
                      onKeyDown={onKeyDown}
                      data-label={c.header}
                      className={c.mono ? "c-table__num" : undefined}
                    >
                      {/* mono على القيمة لا الخلية: تسمية البطاقة (::before) عربية ولا تدخل mono */}
                      {c.mono ? <span className="sting-mono">{c.render(row)}</span> : c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {loading ? (
        <p className="visually-hidden" role="status">
          جارٍ الجلب
        </p>
      ) : null}
      {showEmpty ? <div className="c-table__empty">{empty}</div> : null}
    </div>
  );
}
