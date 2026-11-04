'use client';

import { useEffect, useState } from 'react';

const PRESETS = [
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** A day counted from `from` (a `YYYY-MM-DD`, or today), in the reader's own calendar. */
export function daysFrom(days: number, from?: string): string {
  const d = from ? new Date(`${from}T00:00:00`) : new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * How long a comp or trial runs: a length, a date, or, for a comp, no end. Says
 * up to its parent as the end date, null for no end, or '' while a date is still
 * to be typed. A length counts from `from`, or from today in the browser: the
 * server renders in UTC, which is tomorrow for every US evening.
 */
export default function GrantTermPicker({
  allowNoEnd,
  from,
  onChange,
  idPrefix,
}: {
  allowNoEnd: boolean;
  from?: string;
  onChange: (endsOn: string | null) => void;
  idPrefix: string;
}) {
  const [choice, setChoice] = useState('30');
  const [typed, setTyped] = useState('');

  // A trial has an end, so its picker can't be left on "no end".
  const effective = !allowNoEnd && choice === 'none' ? '30' : choice;
  useEffect(() => {
    if (effective === 'none') onChange(null);
    else if (effective === 'date') onChange(typed);
    else onChange(daysFrom(Number(effective), from));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effective, typed, from]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={`${idPrefix}-length`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
          For how long
        </label>
        <select
          id={`${idPrefix}-length`}
          value={effective}
          onChange={(e) => setChoice(e.target.value)}
          className="border rounded px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
          <option value="date">Until a date…</option>
          {allowNoEnd && <option value="none">No end date</option>}
        </select>
      </div>
      {effective === 'date' && (
        <div>
          <label htmlFor={`${idPrefix}-until`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
            Last day
          </label>
          <input
            id={`${idPrefix}-until`}
            type="date"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
          />
        </div>
      )}
    </div>
  );
}
