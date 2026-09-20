/**
 * C-LEDLINE — بند كشف حساب: مدين/دائن/تسوية/معلّق المزامنة؛ صف وبطاقة.
 * الوصف في البداية والمبلغ والرصيد في النهاية؛ المدين والدائن عمودان ثابتا الترتيب.
 * البند المعلّق يظهر في الرصيد ويُوسَم ولا يُخفى حتى التأكيد. المدين/الدائن نص صريح لا لون؛
 * الرصيد الجاري يُعلن مع كل بند. Enter يفتح المستند المصدر (23-Handoff، 02-Design-System).
 */
import type { StateCode } from "@sting/design";

import { formatMinor } from "./format";
import { Status } from "./Status";

export interface LedgerEntryRow {
  readonly id: string;
  readonly dateLabel: string;
  readonly document: string;
  readonly direction: "debit" | "credit";
  readonly amountMinor: string;
  readonly runningBalanceMinor: string;
  readonly state?: Extract<StateCode, "pending_sync" | "synced" | "conflict" | "stale"> | undefined;
}

export interface LedgerLinesProps {
  readonly caption: string;
  readonly rows: readonly LedgerEntryRow[];
  readonly currency: string;
  readonly exponent?: number;
  readonly onOpen?: ((row: LedgerEntryRow) => void) | undefined;
  readonly closingLabel?: string;
}

export function LedgerLines({
  caption,
  rows,
  currency,
  exponent = 2,
  onOpen,
  closingLabel = "الرصيد الحالي",
}: LedgerLinesProps) {
  const f = (m: string) => formatMinor(m, exponent);
  const last = rows[rows.length - 1];
  return (
    <table className="c-ledline">
      <caption className="visually-hidden">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">التاريخ والمستند</th>
          <th scope="col" className="c-table__num">
            مدين
          </th>
          <th scope="col" className="c-table__num">
            دائن
          </th>
          <th scope="col" className="c-table__num">
            الرصيد
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const cells = (
            <>
              <td data-label="التاريخ والمستند">
                <span className="c-ledline__date">{r.dateLabel}</span> · {r.document}
                {r.state && r.state !== "synced" ? (
                  <>
                    {" "}
                    <Status state={r.state} />
                  </>
                ) : null}
              </td>
              <td data-label="مدين" className="c-table__num">
                <span className="sting-mono">
                  {r.direction === "debit" ? f(r.amountMinor) : "—"}
                </span>
              </td>
              <td data-label="دائن" className="c-table__num">
                <span className="sting-mono">
                  {r.direction === "credit" ? f(r.amountMinor) : "—"}
                </span>
              </td>
              <td data-label="الرصيد" className="c-table__num">
                <span className="sting-mono">{f(r.runningBalanceMinor)}</span>
                <span className="visually-hidden">{` ${currency} ${r.direction === "debit" ? "مدين" : "دائن"} ${f(r.amountMinor)}`}</span>
              </td>
            </>
          );
          return onOpen ? (
            <tr
              key={r.id}
              tabIndex={0}
              className="c-table__row--openable"
              onClick={() => onOpen(r)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onOpen(r);
                }
              }}
            >
              {cells}
            </tr>
          ) : (
            <tr key={r.id}>{cells}</tr>
          );
        })}
      </tbody>
      {last ? (
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              {closingLabel}
            </th>
            <td className="c-table__num sting-mono">{f(last.runningBalanceMinor)}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
