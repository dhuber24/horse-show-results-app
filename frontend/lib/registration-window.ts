/**
 * The two questions the show office answers for every show about what an
 * exhibitor may do online, and until when (migration 159), and the sentences
 * that state the answers.
 *
 *   1. **The last day to sign up online** — `shows.entry_deadline`, inclusive.
 *      After it, somebody not yet signed up is signed up by the office at the
 *      desk. It closes new sign-ups only: somebody already signed up keeps their
 *      registration to amend until the show starts.
 *   2. **How late exhibitors enter and scratch their own classes** —
 *      `shows.self_entry_closes`: until each class starts, or until the show
 *      starts. Unanswered reads as until each class starts, which is what every
 *      show did before the question was asked.
 *
 * Asked on setup Step 1 and on the new-show form, and required to publish. The
 * rules are `backend/self_entry.py`; this file only words them, so a screen
 * never decides for itself whether a door is open — it reads `signup_open` /
 * `class_entry_open` off the payload.
 */

export type SelfEntryCloses = 'class_start' | 'show_start';

export const SELF_ENTRY_OPTIONS: { value: SelfEntryCloses; label: string; hint: string }[] = [
  {
    value: 'class_start',
    label: 'Until each class starts',
    hint:
      'Exhibitors keep adding and dropping classes from their phone while the show runs. ' +
      'A horse can still be scratched from a class under way until it has gone.',
  },
  {
    value: 'show_start',
    label: 'Until the show starts',
    hint: 'From the first day, the show office makes every class change.',
  },
];

/** `registration` on the preview and sign-up payloads (`self_entry.registration_window`). */
export type RegistrationWindow = {
  /** Somebody not yet signed up may sign up online today. */
  signup_open: boolean;
  /** The last day to sign up online, `YYYY-MM-DD`; null when not answered. */
  signup_deadline: string | null;
  /** The class doors are open at all; each class's own state still applies. */
  class_entry_open: boolean;
  /** The answer, with an unanswered show read as `class_start`. */
  class_entry_closes: SelfEntryCloses;
  /** Both questions answered. */
  answered: boolean;
};

/** Both questions answered — what setup Step 1 ticks on and publishing needs. */
export function registrationAnswered(show: {
  entry_deadline?: string | null;
  self_entry_closes?: string | null;
}): boolean {
  return Boolean(show.entry_deadline && show.self_entry_closes);
}

/** "Wed, Oct 1". Parsed as a calendar day, so no time zone moves it. */
export function formatDeadline(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** The sign-up deadline in a sentence, or null when there is none to state. */
export function signupDeadlineText(deadline: string | null | undefined): string | null {
  return deadline ? `Sign up online by ${formatDeadline(deadline)}.` : null;
}

/** How late classes may be changed online, in a sentence. */
export function classEntryText(closes: string | null | undefined): string {
  return closes === 'show_start'
    ? 'Classes can be entered and scratched online until the show starts.'
    : 'Classes can be entered and scratched online until each class starts.';
}

/** Why somebody not yet signed up is being sent to the office. */
export function signupClosedText(deadline: string | null | undefined): string {
  return deadline
    ? `Online sign-up closed after ${formatDeadline(deadline)}.`
    : 'Online sign-up has closed.';
}
