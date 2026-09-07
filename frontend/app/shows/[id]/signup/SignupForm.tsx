'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ReservationFields, { type SignupData } from '../_components/ReservationFields';

export type { SignupData, FeeOption } from '../_components/ReservationFields';

/**
 * Show sign-up as its own page.
 *
 * The fields are `ReservationFields`, shared with the registration screen,
 * which now folds the same editor into a section of its own — one exhibitor
 * doing one job should not have to notice that stalls and classes were built as
 * two screens. This route stays because it is the door people arrive at: the
 * show hub's **Sign Up** tile, the status banner, and the My Shows card all
 * point here, and it is where somebody who has not signed up yet is sent.
 */
export default function SignupForm({ showId, data }: { showId: string; data: SignupData }) {
  const router = useRouter();
  const { show, exhibitor, signup } = data;
  const alreadySignedUp = signup !== null;

  return (
    <div className="mt-6">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{show.name}</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
        {alreadySignedUp ? 'Update your show sign-up' : 'Sign up for this show'} — {exhibitor.full_name}
      </p>

      <div
        className="mt-4 mb-4 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
      >
        {alreadySignedUp ? (
          <>
            You&apos;re signed up for this show. Change your stall, shavings, or camping numbers here
            any time while registration is open — or alongside your classes on the registration
            screen.
          </>
        ) : (
          <>
            Sign-up tells the show office you&apos;re coming and reserves your stalls, shavings, and
            camping. Once you&apos;re signed up you can enter classes. Fees shown are informational —
            payment is collected at the show.
          </>
        )}
      </div>

      <ReservationFields
        showId={showId}
        data={data}
        submitLabel={alreadySignedUp ? 'Save changes' : 'Sign up & pick classes'}
        totalHint="Class fees are added when you enter classes."
        // Onward to the classes either way: a first-time sign-up is halfway
        // through the job, and someone editing stall numbers came from there.
        onSaved={() => {
          router.push(`/shows/${showId}/register`);
          router.refresh();
        }}
      >
        {alreadySignedUp && (
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            <Link
              href={`/shows/${showId}/register`}
              className="text-sm font-medium hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              Go to my class registration →
            </Link>
          </div>
        )}
      </ReservationFields>
    </div>
  );
}
