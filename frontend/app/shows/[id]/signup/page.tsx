import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import SignupForm, { type SignupData } from './SignupForm';
import WaiverSignatures from './WaiverSignatures';
import ProfileStep from '../register/ProfileStep';
import SignupClosedNotice from '../_components/SignupClosedNotice';

async function loadSignup(
  showId: string,
): Promise<{ data: SignupData | null; error?: string }> {
  const headers = await getAuthHeaders();
  if (!headers) return { data: null };
  const res = await fetch(`${API_URL}/shows/${showId}/register/signup`, {
    headers,
    cache: 'no-store',
  });
  const json = await readJsonBody(res);
  if (!res.ok || json === null) {
    return {
      data: null,
      error: json?.detail?.message || json?.detail || json?.error || 'Sign-up is not available for this show.',
    };
  }
  return { data: json };
}

export default async function ShowSignupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session) redirect(`/login?next=/shows/${id}/signup`);

  const { data, error } = await loadSignup(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/shows/${id}`} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Show
      </Link>

      {!data ? (
        <div
          className="mt-6 rounded-lg border p-4 text-sm"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
        >
          {error ?? 'Sign-up is not available for this show right now.'}
        </div>
      ) : !data.signup && data.registration?.signup_open === false ? (
        // Past the last day to sign up online (migration 159): the stall picker
        // would be a form the save turns away.
        <div className="mt-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{data.show.name}</h1>
          <SignupClosedNotice showId={id} deadline={data.registration.signup_deadline} />
        </div>
      ) : data.profile && !data.profile.complete ? (
        /* Step one, enforced on the direct URL as well as in the flow. `PUT
           /signup` refuses while the profile is short, so rendering the stall
           picker here would be offering a form the save is going to turn away.
           The same component the registration screen uses, so somebody who
           arrived by this door fills the gaps in and carries straight on. */
        <div className="mt-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{data.show.name}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            First, your profile — {data.exhibitor.full_name}
          </p>
          <div
            className="mt-4 mb-4 rounded-lg border p-3 text-sm"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
          >
            {data.fee_options.length > 0
              ? 'The show office needs your details before it can hold a stall for you. Fill these in and stalls, shavings and camping open up.'
              : 'The show office needs your details before you can sign up. Fill these in and sign-up opens up.'}
          </div>
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <ProfileStep profile={data.profile} showId={id} asOf={data.show.start_date} />
          </div>
          <div className="mt-4 text-sm font-medium">
            <Link
              href={`/shows/${id}/register`}
              className="hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              Or do the whole thing on one screen →
            </Link>
          </div>
        </div>
      ) : (
        <>
          <SignupForm showId={id} data={data} />
          {/* Only once they are on the roster. Signing is scoped to people
              competing at this show, and the roster row is what sign-up
              creates — offering the form first would just 403. */}
          {data.signup && (
            <WaiverSignatures showId={id} exhibitorName={data.exhibitor.full_name} />
          )}
        </>
      )}
    </main>
  );
}
