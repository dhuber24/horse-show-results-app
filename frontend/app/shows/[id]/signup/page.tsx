import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import SignupForm, { type SignupData } from './SignupForm';

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
      ) : (
        <SignupForm showId={id} data={data} />
      )}
    </main>
  );
}
