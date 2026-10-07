'use client';

/**
 * The results filters — Name, Back #, Horse, Class, and *My classes* — as the
 * public Results page and the Show Results report both draw them, so somebody
 * who learns one has learned the other. Matching is `lib/results-filter.ts`;
 * this is only the controls.
 *
 * Two across on a phone, four across from `sm` up. A field per question rather
 * than one search box: every field filled in has to match the same placing, and
 * a back number is matched whole, neither of which one box could say.
 */

export type FilterField = {
  key: string;
  label: string;
  placeholder?: string;
  /** Brings up the number pad on a phone. */
  numeric?: boolean;
};

export default function ResultsFilterBar({
  idPrefix,
  fields,
  values,
  onChange,
  mine,
  onClear,
  summary,
}: {
  idPrefix: string;
  fields: FilterField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  /** *My classes*, for a signed-in exhibitor; null offers no toggle — anybody
   *  else has no classes of their own, so it would be permanently dead. */
  mine: { on: boolean; count: number; onToggle: () => void } | null;
  /** Shown while anything is filtered. */
  onClear: (() => void) | null;
  summary: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {fields.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`${idPrefix}-${field.key}`}
              className="block text-xs font-medium mb-0.5"
              style={{ color: 'var(--muted)' }}
            >
              {field.label}
            </label>
            <input
              id={`${idPrefix}-${field.key}`}
              type="search"
              inputMode={field.numeric ? 'numeric' : undefined}
              autoComplete="off"
              value={values[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {mine && (
            <button
              type="button"
              onClick={mine.onToggle}
              aria-pressed={mine.on}
              disabled={mine.count === 0 && !mine.on}
              title={mine.count === 0
                ? "You're not entered in any classes at this show"
                : mine.on ? 'Show every class' : "Show only the classes you're entered in"}
              className="text-sm font-medium px-3 py-1.5 rounded-full border transition disabled:opacity-50"
              style={mine.on
                ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--surface)' }
                : { backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--accent)' }}
            >
              🐴 My classes{mine.count > 0 ? ` (${mine.count})` : ''}
            </button>
          )}
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-sm font-medium px-2 py-1.5 hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              Clear filters
            </button>
          )}
        </div>
        {summary && (
          <p className="text-xs" style={{ color: 'var(--muted)' }} aria-live="polite">
            {summary}
          </p>
        )}
      </div>
    </div>
  );
}
