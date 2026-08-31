import { formatReportCell, type Report } from '@/lib/reports';

/**
 * A report, drawn from whatever columns and rows the backend sent.
 *
 * There is no per-report component and there must not be one: two backend
 * registries produce this shape (`financial_reports.py` and `show_reports.py`),
 * and a report added to either is reachable here immediately. A component per
 * report is how the two would start to disagree about what a money column looks
 * like.
 */
export default function ReportTable({ report }: { report: Report }) {
  const hasTotals = Object.keys(report.totals).length > 0;

  if (report.rows.length === 0) {
    return (
      <>
        <div
          className="rounded-lg border border-dashed p-6 text-center"
          style={{ borderColor: '#d4b896' }}
        >
          <p className="text-sm font-medium" style={{ color: '#2c1810' }}>
            Nothing to report yet
          </p>
          {report.notes.length > 0 && (
            <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
              {report.notes[0]}
            </p>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Wide reports scroll inside their own container rather than pushing the
          page sideways. Several of these carry a dozen columns. */}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#d4b896' }}>
        <table className="w-full text-sm" style={{ backgroundColor: '#ffffff' }}>
          <thead>
            <tr style={{ backgroundColor: '#faf7f2' }}>
              {report.columns.map((column) => (
                <th
                  key={column.key}
                  className={`px-3 py-2 font-semibold whitespace-nowrap ${
                    column.align === 'right' ? 'text-right' : 'text-left'
                  }`}
                  style={{ color: '#5d4a37' }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: '#f0e4d0' }}>
            {report.rows.map((row, index) => (
              <tr key={index}>
                {report.columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-3 py-2 ${column.align === 'right' ? 'text-right' : 'text-left'} ${
                      column.is_money ? 'tabular-nums' : ''
                    }`}
                    style={{ color: column.is_money ? '#2c1810' : '#5d4a37' }}
                  >
                    {formatReportCell(row[column.key], column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr style={{ backgroundColor: '#faf7f2' }}>
                {report.columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-3 py-2.5 font-semibold ${
                      column.align === 'right' ? 'text-right' : 'text-left'
                    } ${column.is_money ? 'tabular-nums' : ''}`}
                    style={{ color: '#2c1810' }}
                  >
                    {report.totals[column.key] === undefined
                      ? ''
                      : formatReportCell(report.totals[column.key], column)}
                  </th>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {report.notes.length > 0 && (
        <div
          className="mt-4 rounded border px-4 py-3 text-sm space-y-1.5"
          style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
        >
          {report.notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
        </div>
      )}
    </>
  );
}
