import Link from 'next/link';
import type { MyShowStanding } from '@/lib/my-shows';

/**
 * What an exhibitor's own standing at this show is, at the top of the show page.
 *
 * The page used to tell everyone "Registration is open — Sign up", including
 * people who had just signed up and come straight back to it. Telling someone
 * to do a thing they have already done reads as the thing not having worked.
 *
 * Three states, in the order they are checked:
 *
 *  1. **Cancelled.** Say so, and what happened to their classes and money,
 *     with the way back in while sign-up is open.
 *  2. **Signed up.** Say so, with the back number and class count, and offer the
 *     two things left to change. Shown whatever the show's status is — after
 *     registration closes it becomes the record of where they stand.
 *  3. **Entered by the office but never signed up.** A `show_entries` shell row
 *     with no `registered_at`. They have classes but the office has no stall or
 *     shavings numbers for them, so they still need the sign-up form.
 *
 * **Somebody with none of these has nothing of their own to say here**, so the
 * banner renders nothing and the show menu's sign-up bar is their way in — the
 * same bar a visitor with no account sees (`lib/show-hub.ts`). It used to carry
 * three more states: registration open and past the last day to sign up online
 * put a second sign-up button directly over the bar, and closed repeated what
 * the bar or the status badge already says.
 */
export default function ExhibitorStatusBanner({
  showId,
  showStatus,
  standing,
  signupOpen = true,
}: {
  showId: string;
  showStatus: string;
  standing: MyShowStanding | null;
  /** `signup_open` off the show payload: somebody not yet signed up may still
   *  sign up online. Only read while the show is published. */
  signupOpen?: boolean;
}) {
  const registrationOpen = showStatus === 'PUBLISHED';
  // A new sign-up — including signing up again after cancelling, and finishing
  // one the office started — closes on the show's last day to sign up online.
  // Somebody already signed up keeps `registrationOpen` to amend theirs.
  const canSignUp = registrationOpen && signupOpen;
  const entryCount = standing?.entry_count ?? 0;
  // Whether the show sells stalls, shavings or camping. Unknown keeps the
  // wording that mentions them.
  const offersLodging = standing?.offers_lodging !== false;
  const classesHref = `/shows/${showId}/register/classes`;

  const classesLabel = `${entryCount} class${entryCount === 1 ? '' : 'es'}`;
  const unsigned = standing?.waivers_outstanding ?? 0;

  if (standing?.cancelled_at) {
    return (
      <div
        className="mb-4 px-4 py-3 rounded border"
        style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--warning)' }}>
          Your registration for this show was cancelled
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
          {offersLodging
            ? 'Your classes, stalls and camping have been released.'
            : 'Your classes have been released.'}{' '}
          Anything you had already paid stays on your account for the show office to refund.
        </p>
        {canSignUp && (
          <div className="mt-2">
            {/* Signing up again is the same call on the same row, so a back
                number and any payment history survive it. */}
            <Link
              href={`/shows/${showId}/register`}
              className="text-sm font-medium px-3 py-1.5 rounded text-white inline-block"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Register again →
            </Link>
          </div>
        )}
      </div>
    );
  }

  if (standing?.signed_up) {
    return (
      <div
        className="mb-4 px-4 py-3 rounded border"
        style={{ backgroundColor: 'var(--success-bg)', borderColor: 'var(--success-border)' }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-medium" style={{ color: 'var(--success-strong)' }}>
            ✓ You&rsquo;re signed up for this show
          </p>
          {standing.back_number != null && (
            <span
              className="text-xs font-semibold px-2 py-1 rounded shrink-0"
              style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-strong)' }}
            >
              Back number {standing.back_number}
            </span>
          )}
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--success)' }}>
          {entryCount > 0 ? `Entered in ${classesLabel}.` : 'No classes entered yet.'}
          {/* Only while they can still do something about it. The link is the
              point of the sentence — telling someone to enter a number
              without saying where is worse than saying nothing. */}
          {standing.back_number == null && registrationOpen && (
            <>
              {' '}
              <Link
                href={classesHref}
                className="underline"
                style={{ color: 'var(--success)' }}
              >
                Ensure you enter your preferred back number
              </Link>{' '}
              or one will be assigned to you.
            </>
          )}
        </p>
        {/* Signing is on the sign-up screen, so this is a nudge with a
            destination rather than a second place to do it. Only required
            waivers count — see `waivers_outstanding`. */}
        {unsigned > 0 && (
          <p className="text-xs mt-1 font-medium" style={{ color: 'var(--warning)' }}>
            {unsigned === 1 ? '1 release still to sign' : `${unsigned} releases still to sign`} —
            you can also sign a paper copy at the show office.
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm font-medium">
          {registrationOpen && (
            <>
              <Link href={classesHref} className="hover:underline" style={{ color: 'var(--accent)' }}>
                {entryCount > 0 ? 'Add or remove classes →' : 'Pick your classes →'}
              </Link>
              {/* `/signup` is where releases are signed as well as where stalls
                  are changed, so a show selling no stalls still links it while
                  a release is outstanding — and only then. */}
              {(offersLodging || unsigned > 0) && (
                <Link href={`/shows/${showId}/signup`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                  {!offersLodging
                    ? 'Sign releases →'
                    : unsigned > 0
                      ? 'Sign releases, change stalls →'
                      : 'Change stalls, shavings or camping →'}
                </Link>
              )}
            </>
          )}
          <Link href="/my-shows" className="hover:underline" style={{ color: 'var(--accent)' }}>
            All my shows →
          </Link>
        </div>
      </div>
    );
  }

  if (entryCount > 0) {
    return (
      <div
        className="mb-4 px-4 py-3 rounded border"
        style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--warning-border)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--warning)' }}>
          The show office has entered you in {classesLabel}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>
          {offersLodging
            ? 'You haven’t completed sign-up, so the office has no stall, shavings or camping numbers for you.'
            : 'You haven’t completed sign-up for this show yet.'}
        </p>
        {canSignUp && (
          <div className="mt-2">
            <Link
              href={`/shows/${showId}/register`}
              className="text-sm font-medium px-3 py-1.5 rounded text-white inline-block"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Complete sign-up →
            </Link>
          </div>
        )}
      </div>
    );
  }

  return null;
}
