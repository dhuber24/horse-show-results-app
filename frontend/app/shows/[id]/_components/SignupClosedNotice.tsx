import Link from 'next/link';
import { signupClosedText } from '@/lib/registration-window';
import { ENTERING_TOPIC } from '@/lib/show-signup';

/**
 * What somebody not yet signed up sees on a registration screen once the show's
 * last day to sign up online has passed (migration 159).
 *
 * A destination, not a locked form: past the deadline the show office signs
 * people up at the desk, and may still take this one, so the notice hands them
 * the contact form with the question already framed. `PUT /signup` refuses the
 * same sign-up with `SIGNUP_CLOSED`; this is only the screen saying so first.
 */
export default function SignupClosedNotice({
  showId,
  deadline,
}: {
  showId: string;
  /** The last day to sign up online, `YYYY-MM-DD`, or null. */
  deadline: string | null;
}) {
  return (
    <div
      className="mt-4 rounded-lg border p-4 text-sm flex flex-wrap items-center justify-between gap-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
    >
      <span>{signupClosedText(deadline)} The show office can still sign you up.</span>
      <Link
        href={`/shows/${showId}/contact?about=${ENTERING_TOPIC}`}
        className="text-sm font-medium px-3 py-1.5 rounded text-white shrink-0"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        Message the show office →
      </Link>
    </div>
  );
}
