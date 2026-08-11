import Link from 'next/link';
import type { MyShowStanding } from '@/lib/my-shows';

/**
 * What an exhibitor's own standing at this show is, at the top of the show page.
 *
 * The page used to tell everyone "Registration is open — Sign up", including
 * people who had just signed up and come straight back to it. Telling someone
 * to do a thing they have already done reads as the thing not having worked.
 *
 * Four states, in the order they are checked:
 *
 *  1. **Signed up.** Say so, with the back number and class count, and offer the
 *     two things left to change. Shown whatever the show's status is — after
 *     registration closes it becomes the record of where they stand.
 *  2. **Entered by the office but never signed up.** A `show_entries` shell row
 *     with no `registered_at`. They have classes but the office has no stall or
 *     shavings numbers for them, so they still need the sign-up form.
 *  3. **Nothing yet, registration open.** The original invitation.
 *  4. **Nothing yet, registration closed.** Point at the secretary.
 */
export default function ExhibitorStatusBanner({
  showId,
  showStatus,
  standing,
}: {
  showId: string;
  showStatus: string;
  standing: MyShowStanding | null;
}) {
  const registrationOpen = showStatus === 'PUBLISHED';
  const entryCount = standing?.entry_count ?? 0;

  const classesLabel = `${entryCount} class${entryCount === 1 ? '' : 'es'}`;

  if (standing?.signed_up) {
    return (
      <div
        className="mb-4 px-4 py-3 rounded border"
        style={{ backgroundColor: '#f0fdf4', borderColor: '#86efac' }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-medium" style={{ color: '#065f46' }}>
            ✓ You&rsquo;re signed up for this show
          </p>
          {standing.back_number != null && (
            <span
              className="text-xs font-semibold px-2 py-1 rounded shrink-0"
              style={{ backgroundColor: '#dcfce7', color: '#065f46' }}
            >
              Back number {standing.back_number}
            </span>
          )}
        </div>
        <p className="text-xs mt-1" style={{ color: '#15803d' }}>
          {entryCount > 0 ? `Entered in ${classesLabel}.` : 'No classes entered yet.'}
          {standing.back_number == null && registrationOpen && (
            <> The secretary assigns your back number once the show begins.</>
          )}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm font-medium">
          {registrationOpen && (
            <>
              <Link href={`/shows/${showId}/register`} className="hover:underline" style={{ color: '#8b4513' }}>
                {entryCount > 0 ? 'Add or remove classes →' : 'Pick your classes →'}
              </Link>
              <Link href={`/shows/${showId}/signup`} className="hover:underline" style={{ color: '#8b4513' }}>
                Change stalls, shavings or camping →
              </Link>
            </>
          )}
          <Link href="/my-shows" className="hover:underline" style={{ color: '#8b4513' }}>
            My shows &amp; bill →
          </Link>
        </div>
      </div>
    );
  }

  if (entryCount > 0) {
    return (
      <div
        className="mb-4 px-4 py-3 rounded border"
        style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a' }}
      >
        <p className="text-sm font-medium" style={{ color: '#92400e' }}>
          The show office has entered you in {classesLabel}
        </p>
        <p className="text-xs mt-1" style={{ color: '#92400e' }}>
          You haven&rsquo;t completed sign-up, so the office has no stall, shavings or camping
          numbers for you.
        </p>
        {registrationOpen && (
          <div className="mt-2">
            <Link
              href={`/shows/${showId}/signup`}
              className="text-sm font-medium px-3 py-1.5 rounded text-white inline-block"
              style={{ backgroundColor: '#8b4513' }}
            >
              Complete sign-up →
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (registrationOpen) {
    return (
      <div
        className="mb-4 px-4 py-3 rounded border flex items-center justify-between gap-3"
        style={{ backgroundColor: '#f0e8d8', borderColor: '#d4b896' }}
      >
        <div className="text-sm" style={{ color: '#5d4a37' }}>
          Registration is open. Sign up for the show — stalls, shavings and camping — then pick
          your classes.
        </div>
        {/* Sign-up is the single entry point: it is required before classes,
            and it forwards anyone already signed up straight to the class
            picker rather than making them re-enter the same numbers. */}
        <Link
          href={`/shows/${showId}/signup`}
          className="text-sm font-medium px-3 py-1.5 rounded text-white shrink-0"
          style={{ backgroundColor: '#8b4513' }}
        >
          Sign up →
        </Link>
      </div>
    );
  }

  if (showStatus !== 'DRAFT') {
    return (
      <div
        className="mb-4 px-4 py-3 rounded border text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        Online registration is closed. Contact the show secretary to be added to classes.
      </div>
    );
  }

  return null;
}
