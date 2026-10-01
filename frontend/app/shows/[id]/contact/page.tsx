import Link from 'next/link';
import { auth } from '@/auth';
import { canActAsExhibitor } from '@/lib/exhibitor-access';
import { fetchShow, fetchMyShowStanding } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import type { MyShowStanding } from '@/lib/my-shows';
import { ENTERING_TOPIC } from '@/lib/show-signup';
import { signupClosedText } from '@/lib/registration-window';
import { showHubBack } from '../_components/showHubBack';
import ContactShowForm from './ContactShowForm';

/**
 * Message the show office.
 *
 * Built for visitors with no account and still open to them — but an entered
 * exhibitor asking about their own stalls is the commoner case, so the page
 * fills their details in and tells them the office will see who they are. They
 * had no route to the show office at all before this: the form was only linked
 * from the signed-out view, so signing in took the contact form away.
 *
 * It is also where a show sends somebody who wants to enter once online sign-up
 * has closed — the show is under way, or its last day to sign up online has
 * passed (migration 159) — with `?about=entering`, from `lib/show-signup.ts`.
 * The office may still take a late entry at the counter. The page says so and
 * fills the subject in, so the message arrives already framed.
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

export default async function ContactShowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ about?: string }>;
}) {
  const { id } = await params;
  const { about } = await searchParams;
  const back = showHubBack(id);
  const session = await auth();
  const isExhibitor = session ? await canActAsExhibitor() : false;

  const headers = isExhibitor ? await getAuthHeaders() : null;
  const [show, me, standing] = await Promise.all([
    fetchShow(id),
    session ? loadMe() : Promise.resolve(null),
    isExhibitor
      ? (fetchMyShowStanding(id, headers || undefined) as Promise<MyShowStanding | null>)
      : Promise.resolve(null),
  ]);
  // Somebody asking to enter once online sign-up has closed: the show is under
  // way, or published and past its last day to sign up online (migration 159).
  const lateEntry =
    about === ENTERING_TOPIC &&
    (show.status === 'ACTIVE' || (show.status === 'PUBLISHED' && show.signup_open === false));

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={back.backHref} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← {back.backLabel}
      </Link>

      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Contact the show office</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{show.name}</p>
      </div>

      {/* Only while sign-up is actually closed and the show not over: an old
          link to a show that has since finished should not promise a late
          entry. */}
      {lateEntry && (
        <div
          className="mb-4 rounded-lg border p-3 text-sm"
          style={{ backgroundColor: 'var(--warning-bg)', borderColor: 'var(--border)', color: 'var(--warning)' }}
        >
          {show.status === 'ACTIVE' ? (
            <>
              <strong>This show is already under way</strong>, so online sign-up has closed.
            </>
          ) : (
            <strong>{signupClosedText(show.entry_deadline)}</strong>
          )}{' '}
          Send the office a message and ask whether they are still taking entries — say which
          classes and which horse you have in mind.
        </div>
      )}

      <div
        className="mb-6 rounded-lg border p-3 text-sm"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
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
        defaultSubject={lateEntry ? 'Entering the show' : ''}
      />
    </main>
  );
}
