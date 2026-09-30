'use client';

import { useId, useState } from 'react';

/**
 * How late an exhibitor may cancel their own registration, as the show company
 * chooses it (`show_companies.self_cancel_days_before`, migration 157).
 *
 * Two answers, because that is the whole of the question: until the show
 * starts, or until a number of days before its first day. From then on the
 * show office cancels from the desk, which is never on a clock. Stored as one
 * number — 0 is "until the show starts" — so there is no second field that
 * could disagree with it.
 *
 * Rendered on My Company (the company's own managers and secretaries) and on
 * the company's admin page (a GaitDesk admin); both save through `onSave`.
 */

/** The column's CHECK: further out than this is not taking online
 *  cancellations at all. Mirrors `cancellations.MAX_SELF_CANCEL_DAYS_BEFORE`. */
export const MAX_SELF_CANCEL_DAYS_BEFORE = 90;

/** The policy in a sentence, for anywhere that states it without editing it. */
export function selfCancelPolicyText(daysBefore: number): string {
  return daysBefore > 0
    ? `Exhibitors can cancel their own registration until ${daysBefore} ${
        daysBefore === 1 ? 'day' : 'days'
      } before the show.`
    : 'Exhibitors can cancel their own registration until the show starts.';
}

export default function SelfCancelPolicy({
  value,
  onSave,
}: {
  /** The saved cut-off in days; 0 is until the show starts. */
  value: number;
  /** Save the new cut-off. Resolves to an error to show, or null. */
  onSave: (daysBefore: number) => Promise<string | null>;
}) {
  // One radio group per company: My Company can list several on one page.
  const group = useId();
  const [mode, setMode] = useState<'start' | 'days'>(value > 0 ? 'days' : 'start');
  // A string, so the box can be cleared while somebody types a new number.
  const [days, setDays] = useState(String(value > 0 ? value : 14));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = Number(days);
  const daysValid =
    days.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_SELF_CANCEL_DAYS_BEFORE;
  const next = mode === 'start' ? 0 : parsed;
  const dirty = mode === 'start' ? value !== 0 : !daysValid || parsed !== value;
  const invalid = mode === 'days' && !daysValid;

  const save = async () => {
    if (invalid || !dirty) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const problem = await onSave(next);
    setSaving(false);
    if (problem) setError(problem);
    else setSaved(true);
  };

  const radioLabel = 'flex items-center gap-2 text-sm';

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
        Exhibitor cancellations
      </h3>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        How late an exhibitor can cancel their own registration, at every show this company runs.
        After that, the show office cancels from the desk.
      </p>
      <fieldset className="space-y-1.5">
        <legend className="sr-only">When exhibitors can cancel their own registration</legend>
        <label className={radioLabel} style={{ color: 'var(--foreground)' }}>
          <input
            type="radio"
            name={group}
            checked={mode === 'start'}
            onChange={() => {
              setMode('start');
              setSaved(false);
            }}
          />
          Until the show starts
        </label>
        <label className={`${radioLabel} flex-wrap`} style={{ color: 'var(--foreground)' }}>
          <input
            type="radio"
            name={group}
            checked={mode === 'days'}
            onChange={() => {
              setMode('days');
              setSaved(false);
            }}
          />
          Until
          <input
            type="number"
            min={1}
            max={MAX_SELF_CANCEL_DAYS_BEFORE}
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setMode('days');
              setSaved(false);
            }}
            aria-label="Days before the show"
            aria-invalid={invalid || undefined}
            className="w-16 border rounded px-2 py-1 text-sm text-center"
            style={{
              borderColor: invalid ? 'var(--error)' : 'var(--border)',
              backgroundColor: 'var(--background)',
            }}
          />
          days before the show&apos;s first day
        </label>
      </fieldset>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={save}
          disabled={saving || invalid || !dirty}
          title={
            invalid
              ? `A whole number of days from 1 to ${MAX_SELF_CANCEL_DAYS_BEFORE}`
              : !dirty
                ? 'Nothing has changed'
                : undefined
          }
          className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {invalid && (
          <span className="text-xs" style={{ color: 'var(--error)' }}>
            A whole number of days from 1 to {MAX_SELF_CANCEL_DAYS_BEFORE}.
          </span>
        )}
        {saved && !dirty && (
          <span className="text-xs" style={{ color: 'var(--success-strong)' }}>
            Saved — {selfCancelPolicyText(value).toLowerCase()}
          </span>
        )}
        {error && (
          <span className="text-xs" role="alert" style={{ color: 'var(--error)' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
