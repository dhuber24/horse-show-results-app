import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import { canActAsExhibitor } from '@/lib/exhibitor-access';
import { fetchShow } from '@/lib/api';
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

/**
 * Whether a 403 from the preview is about the caller having no exhibitor
 * record. The preview refuses on the show's status first, so while the show is
 * not taking sign-ups at all the refusal is the status, and setting up an
 * exhibitor profile would only lead back to it.
 */
async function lacksExhibitorRecord(showId: string): Promise<boolean> {
  const [show, isExhibitor] = await Promise.all([
    fetchShow(showId).catch(() => null),
    canActAsExhibitor(),
  ]);
  return !isExhibitor && (show?.status === 'PUBLISHED' || show?.status === 'ACTIVE');
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

  const [{ status, data, error }, signupData, futurities] = await Promise.all([
    loadPreview(id),
    loadSignup(id),
    loadFuturities(id),
  ]);

  // Entering a show takes an exhibitor record, and the show menu offers its
  // sign-up bar to everybody — it is the public's page, and the office opens it
  // to see what the public sees. Somebody refused for want of a record is told
  // how to get one, not shown the backend's 403. Asked only after a 403, so a
  // backend that is down still reads as down rather than as "no record".
  const needsExhibitorRecord = !data && status === 403 && (await lacksExhibitorRecord(id));

  // Once the show is running only the class doors are open
  // (`backend/self_entry.py`), and those are the class page. Details, stalls
  // and futurities are the office's from here on.
  if (data?.show.status === 'ACTIVE') redirect(classesHref);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/shows/${id}`} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Show
      </Link>

      {needsExhibitorRecord ? (
        <div
          className="mt-6 rounded-lg border p-4 text-sm"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
        >
          <p className="font-medium" style={{ color: 'var(--foreground)' }}>
            This account isn&rsquo;t set up to enter shows
          </p>
          <p className="mt-1">
            Entering a show takes an exhibitor profile. If you compete as well, tick{' '}
            <strong>I also compete</strong> and you&rsquo;ll come straight back here to sign up.
          </p>
          <Link
            href={`/welcome?next=${encodeURIComponent(`/shows/${id}/register`)}`}
            className="mt-3 inline-block text-sm font-medium px-4 py-2 rounded text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Set up an exhibitor profile →
          </Link>
        </div>
      ) : !data ? (
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
