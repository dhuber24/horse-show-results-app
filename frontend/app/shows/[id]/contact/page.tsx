import Link from 'next/link';
import { auth } from '@/auth';
import { fetchShow, fetchMyShowStanding } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import type { MyShowStanding } from '@/lib/my-shows';
import ContactShowForm from './ContactShowForm';

/**
 * Message the show office.
 *
 * Built for visitors with no account and still open to them — but an entered
 * exhibitor asking about their own stalls is the commoner case, so the page
 * fills their details in and tells them the office will see who they are. They
 * had no route to the show office at all before this: the form was only linked
 * from the signed-out view, so signing in took the contact form away.
 */
async function loadMe(): Promise<{ full_name: string; email: string } | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API_URL}/users/me`, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    const user = await res.json();
    return { full_name: user.full_name ?? '', email: user.email ?? '' };
  } catch {
    // Prefilling is a convenience. If it fails the form still works — the
    // fields are simply empty, which is how it behaved before.
    return null;
  }
}

export default async function ContactShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const isExhibitor = (session?.user as { role?: string } | undefined)?.role === 'EXHIBITOR';

  const headers = isExhibitor ? await getAuthHeaders() : null;
  const [show, me, standing] = await Promise.all([
    fetchShow(id),
    session ? loadMe() : Promise.resolve(null),
    isExhibitor
      ? (fetchMyShowStanding(id, headers || undefined) as Promise<MyShowStanding | null>)
      : Promise.resolve(null),
  ]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to Show
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Contact the show office</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{show.name}</p>
      </div>

      <div
        className="mb-6 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        {session ? (
          <>
            Your message goes to this show&rsquo;s secretary and manager, and they&rsquo;ll see
            it&rsquo;s from you
            {standing?.back_number != null && (
              <> — back number <strong>{standing.back_number}</strong></>
            )}
            {standing?.back_number == null && standing?.signed_up && <> — signed up for this show</>}
            . They will reply to the email address below.
          </>
        ) : (
          <>
            Your message goes to this show&rsquo;s secretary and manager. You don&rsquo;t need an
            account to send one — leave an email address and they will reply there.
          </>
        )}
      </div>

      <ContactShowForm
        showId={id}
        showName={show.name}
        defaultName={me?.full_name ?? ''}
        defaultEmail={me?.email ?? ''}
      />
    </main>
  );
}
