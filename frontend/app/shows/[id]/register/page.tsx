import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import RegisterShowForm, { type PreviewData } from './RegisterShowForm';

async function loadPreview(showId: string): Promise<{ status: number; data: PreviewData | null; error?: string }> {
  const headers = await getAuthHeaders();
  if (!headers) return { status: 401, data: null };
  const res = await fetch(`${API_URL}/shows/${showId}/register/preview`, { headers, cache: 'no-store' });
  const json = await res.json();
  if (!res.ok) return { status: res.status, data: null, error: json?.detail || json?.error || 'Unable to load registration form' };
  return { status: 200, data: json };
}

export default async function RegisterShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session) redirect(`/login?next=/shows/${id}/register`);

  const { data, error } = await loadPreview(id);

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
        <RegisterShowForm showId={id} preview={data} />
      )}
    </main>
  );
}
