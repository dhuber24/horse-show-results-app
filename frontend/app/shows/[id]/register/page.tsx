import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import RegisterShowForm from './RegisterShowForm';
import type { PreviewData } from './types';
import type { SignupData } from '../_components/ReservationFields';
import type { ExhibitorFuturity } from './FuturityEntry';

async function loadPreview(showId: string): Promise<{ status: number; data: PreviewData | null; error?: string }> {
  const headers = await getAuthHeaders();
  if (!headers) return { status: 401, data: null };
  const res = await fetch(`${API_URL}/shows/${showId}/register/preview`, { headers, cache: 'no-store' });
  const json = await readJsonBody(res);
  if (!res.ok || json === null) return { status: res.status, data: null, error: json?.detail || json?.error || 'Unable to load registration form' };
  return { status: 200, data: json };
}

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

export default async function RegisterShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session) redirect(`/login?next=/shows/${id}/register`);

  const [{ data, error }, signupData, futurities] = await Promise.all([
    loadPreview(id),
    loadSignup(id),
    loadFuturities(id),
  ]);

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
          {error ?? 'Registration is not available for this show right now.'}
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
