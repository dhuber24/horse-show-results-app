'use client';

import { useId } from 'react';
import type { BackNumberPer } from '@/lib/back-numbers';

export type { BackNumberPer };

const OPTIONS: { value: BackNumberPer; label: string; hint: string }[] = [
  {
    value: 'exhibitor',
    label: 'One per exhibitor',
    hint: 'Back number is only assigned to the exhibitor, never the horse. A rider, showing two different horses, keeps the same back number for each horse.',
  },
  {
    value: 'horse',
    label: 'One per horse',
    hint: 'Only the horse carries the back number, never the exhibitor. Two riders of the same horse would use the same back number.',
  },
  {
    value: 'pair',
    label: 'One per exhibitor and horse',
    hint: 'Every back number is a rider and horse combo. One rider, showing multiple horses, needs a different back number for each horse.',
  },
];

/** What saving a switch hands out, and what it keeps, by kind. */
const HANDED_OUT: Record<BackNumberPer, string> = {
  exhibitor: 'every exhibitor on the roster a number',
  horse: 'every entered horse a number',
  pair: 'every exhibitor a number for each horse they have entered',
};
const KEPT: Record<BackNumberPer, string> = {
  exhibitor: 'exhibitors’ numbers are',
  horse: 'horses’ numbers are',
  pair: 'numbers per exhibitor and horse are',
};

/**
 * Who a back number belongs to at this show (`shows.back_number_per`,
 * migrations 161 and 178).
 *
 * Controlled, with no save of its own, like `RegistrationQuestions`: it sits in
 * the new-show form and the Step 1 form and is saved with the rest of the show.
 * Switching an existing show numbers everyone of the new kind straight away
 * and keeps the old numbers, unread, so switching back restores them — which
 * is why the warning below only asks for care once numbers are on backs.
 */
export default function BackNumberQuestion({
  value,
  onChange,
  showStatus,
  savedValue,
}: {
  value: BackNumberPer;
  onChange: (value: BackNumberPer) => void;
  /** The show's status, for the warning about switching once it is running. */
  showStatus?: string;
  /** What is saved, so the warning appears only for an actual change. */
  savedValue?: BackNumberPer;
}) {
  const group = useId();
  const switchingLive =
    savedValue !== undefined &&
    value !== savedValue &&
    (showStatus === 'ACTIVE' || showStatus === 'COMPLETED');

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
        Back numbers
      </legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="flex items-start gap-2">
          <input
            type="radio"
            name={group}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-1"
          />
          <span className="text-sm" style={{ color: 'var(--foreground)' }}>
            {option.label}
            <span className="block text-xs" style={{ color: 'var(--muted)' }}>
              {option.hint}
            </span>
          </span>
        </label>
      ))}
      {savedValue !== undefined && value !== savedValue && (
        <p className="text-xs" style={{ color: switchingLive ? 'var(--warning)' : 'var(--muted)' }}>
          {switchingLive
            ? 'This show is under way: the numbers on backs and on the judges’ cards will change. '
            : ''}
          Saving gives {HANDED_OUT[value]} now. The {KEPT[savedValue]} kept, so switching back
          restores them.
        </p>
      )}
    </fieldset>
  );
}
