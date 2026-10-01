'use client';

import { useId } from 'react';
import { SELF_ENTRY_OPTIONS, type SelfEntryCloses } from '@/lib/registration-window';

/**
 * The two registration questions every show answers (migration 159): the last
 * day to sign up online, and how late exhibitors enter and scratch their own
 * classes. See `lib/registration-window.ts`.
 *
 * Controlled, with no save of its own: it sits inside the new-show form and the
 * Step 1 form, and each saves it with the rest of the show. Required to publish
 * rather than to save, because a show is built over several sittings — so an
 * unanswered question says so in place rather than refusing the form.
 */
export default function RegistrationQuestions({
  entryDeadline,
  selfEntryCloses,
  startDate,
  onEntryDeadline,
  onSelfEntryCloses,
  unansweredNote = 'Both are needed before the show can be published.',
}: {
  /** `YYYY-MM-DD`, or '' while unanswered. */
  entryDeadline: string;
  selfEntryCloses: SelfEntryCloses | '';
  /** The show's first day, `YYYY-MM-DD` or ''. The deadline may not pass it. */
  startDate: string;
  onEntryDeadline: (value: string) => void;
  onSelfEntryCloses: (value: SelfEntryCloses) => void;
  /** Said under the questions while either is blank; null says nothing (the
   *  new-show form, which refuses to create the show without them). */
  unansweredNote?: string | null;
}) {
  // One radio group per form: the name must not collide with another on the page.
  const group = useId();
  // Sign-up closes when the show opens whatever the date says, so a later day
  // is a deadline the app would never keep. The backend refuses it too.
  const afterStart = Boolean(entryDeadline && startDate && entryDeadline > startDate);
  const unanswered = !entryDeadline || !selfEntryCloses;

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
          Exhibitor registration
        </h3>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          What exhibitors can do online, and until when. After that, the show office does it at the desk.
        </p>
      </div>

      <label className="block">
        <span className="block text-sm mb-1" style={{ color: 'var(--foreground)' }}>
          What is the last day exhibitors can sign up for the show online? *
        </span>
        <input
          type="date"
          value={entryDeadline}
          max={startDate || undefined}
          onChange={(e) => onEntryDeadline(e.target.value)}
          aria-invalid={afterStart || undefined}
          className="w-full sm:w-56 border rounded px-3 py-2"
          style={{ borderColor: afterStart ? 'var(--error)' : 'var(--border)' }}
        />
        <span className="block text-xs mt-1" style={{ color: afterStart ? 'var(--error)' : 'var(--muted)' }}>
          {afterStart
            ? 'This can be no later than the show’s first day.'
            : 'Exhibitors can sign up through the end of this day. Anyone later is signed up by the show office.'}
        </span>
      </label>

      <fieldset className="space-y-1.5">
        <legend className="text-sm mb-1" style={{ color: 'var(--foreground)' }}>
          Until when can exhibitors enter and scratch their own classes? *
        </legend>
        {SELF_ENTRY_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-start gap-2">
            <input
              type="radio"
              name={group}
              value={option.value}
              checked={selfEntryCloses === option.value}
              onChange={() => onSelfEntryCloses(option.value)}
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
      </fieldset>

      {unanswered && unansweredNote && (
        <p className="text-xs" style={{ color: 'var(--warning)' }}>
          {unansweredNote}
        </p>
      )}
    </div>
  );
}
