/**
 * The findings from an association readiness check.
 *
 * `GET /shows/{id}/aqha-validation` and `GET /shows/{id}/apha-validation` return
 * the same shape, so one component draws both — the same reasoning that gives
 * the two report registries a single `ReportTable`. Two copies of this would
 * eventually disagree about what a warning looks like, on the one screen whose
 * whole job is telling an office what is wrong before somebody else does.
 *
 * A pure render with no hooks, so it stays a server component and the dashboard
 * does not ship it to the browser.
 */

export type ValidationIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  class_id?: string;
  class_code?: string;
  entry_id?: string;
};

export type ValidationResult = {
  error_count: number;
  warning_count: number;
  issues: ValidationIssue[];
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#e8d5b7',
  bg: '#fffaf3',
  ok: '#2f6b3f',
  error: '#b42318',
  warning: '#92400e',
} as const;

export default function ValidationIssues({
  label,
  data,
  limit = 6,
}: {
  label: string;
  data: ValidationResult;
  /** Errors are shown first, so a truncated list never hides the worst of it. */
  limit?: number;
}) {
  // Sorted rather than filtered: the count above always reports the whole set,
  // and a panel that silently dropped a finding to fit would be worse than one
  // that says how many it is not showing.
  const ordered = [...data.issues].sort(
    (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'),
  );
  const shown = ordered.slice(0, limit);

  return (
    <div
      className="rounded border p-3 text-sm space-y-2"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium" style={{ color: COLORS.text }}>
          {label}
        </p>
        <span className="text-xs" style={{ color: COLORS.muted }}>
          {data.error_count} error{data.error_count === 1 ? '' : 's'} ·{' '}
          {data.warning_count} warning{data.warning_count === 1 ? '' : 's'}
        </span>
      </div>

      {data.issues.length === 0 ? (
        <p style={{ color: COLORS.ok }}>Nothing outstanding.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((issue, index) => (
            <li
              key={`${issue.code}-${index}`}
              style={{ color: issue.severity === 'error' ? COLORS.error : COLORS.warning }}
            >
              <span className="font-mono text-xs uppercase mr-1">{issue.severity}</span>
              {issue.class_code && (
                <span className="font-mono text-xs mr-1">[{issue.class_code}]</span>
              )}
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {data.issues.length > limit && (
        <p className="text-xs" style={{ color: COLORS.muted }}>
          Showing {limit} of {data.issues.length}.
        </p>
      )}
    </div>
  );
}
