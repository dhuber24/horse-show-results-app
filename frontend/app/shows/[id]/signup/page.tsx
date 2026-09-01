import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import SignupForm, { type SignupData } from './SignupForm';
import WaiverSignatures from './WaiverSignatures';
import ProfileStep from '../register/ProfileStep';

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
      <Link href={`/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to Show
      </Link>

      {!data ? (
        <div
          className="mt-6 rounded-lg border p-4 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          {error ?? 'Sign-up is not available for this show right now.'}
        </div>
      ) : data.profile && !data.profile.complete ? (
        /* Step one, enforced on the direct URL as well as in the flow. `PUT
           /signup` refuses while the profile is short, so rendering the stall
           picker here would be offering a form the save is going to turn away.
           The same component the registration screen uses, so somebody who
           arrived by this door fills the gaps in and carries straight on. */
        <div className="mt-6">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{data.show.name}</h1>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            First, your profile — {data.exhibitor.full_name}
          </p>
          <div
            className="mt-4 mb-4 rounded-lg border p-3 text-sm"
            style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
          >
            The show office needs your details before it can hold a stall for you. Fill these in
            and stalls, shavings and camping open up.
          </div>
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <ProfileStep profile={data.profile} />
          </div>
          <div className="mt-4 text-sm font-medium">
            <Link
              href={`/shows/${id}/register`}
              className="hover:underline"
              style={{ color: '#8b4513' }}
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
