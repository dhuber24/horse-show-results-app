import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import RegisterShowForm from './RegisterShowForm';
import SignupClosedNotice from '../_components/SignupClosedNotice';
import { loadPreview } from './load-preview';
import type { SignupData } from '../_components/ReservationFields';
import type { ExhibitorFuturity } from './FuturityEntry';

/**
 * The fee catalogue with this exhibitor's own rates on it — what the stalls,
 * shavings and camping half of the screen edits.
 *
 * A second call rather than a wider preview payload, because it is the exact
 * payload `/shows/[id]/signup` already reads, and both screens now render the
 * same editor over it. Failure is null, not a throw: the classes half of the
 * page is unaffected by the fee list being unavailable and should still work.
 */
async function loadSignup(showId: string): Promise<SignupData | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/shows/${showId}/register/signup`, {
    headers,
    cache: 'no-store',
  });
  const json = await readJsonBody(res);
  if (!res.ok || json === null) return null;
  return json;
}

/**
 * The show's futurities, with this exhibitor's own enrollments marked.
 *
 * Empty on failure rather than null: a show with no futurity and a futurity
 * call that failed both render nothing, and the rest of the registration screen
 * has no business breaking over either.
 */
async function loadFuturities(showId: string): Promise<ExhibitorFuturity[]> {
  const headers = await getAuthHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/shows/${showId}/register/futurities`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return (await readJsonBody(res)) ?? [];
}

export default async function RegisterShowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;
  const session = await auth();
  if (!session) redirect(`/login?next=/shows/${id}/register`);

  // Classes left the wizard for a page of their own. A link written before
  // that still asks for the step, and it means the class page.
  const classesHref = `/shows/${id}/register/classes`;
  if (step === 'classes') redirect(classesHref);

  const [{ data, error }, signupData, futurities] = await Promise.all([
    loadPreview(id),
    loadSignup(id),
    loadFuturities(id),
  ]);

  // Once the show is running only the class doors are open
  // (`backend/self_entry.py`), and those are the class page. Details, stalls
  // and futurities are the office's from here on.
  if (data?.show.status === 'ACTIVE') redirect(classesHref);

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
          {error ?? 'Registration is not available for this show right now.'}
        </div>
      ) : !data.signup && data.registration?.signup_open === false ? (
        // Past the last day to sign up online (migration 159), and not signed
        // up — cancelled, or never started. Somebody already signed up still
        // gets the form: they are amending a registration, not making one.
        <div className="mt-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{data.show.name}</h1>
          <SignupClosedNotice showId={id} deadline={data.registration.signup_deadline} />
        </div>
      ) : (
        <RegisterShowForm
          showId={id}
          preview={data}
          futurities={futurities}
          signupData={signupData}
        />
      )}
    </main>
  );
}
