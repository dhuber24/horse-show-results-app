import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import type { BoardPayload } from '@/lib/show-board';
import { showHubBack } from '../_components/showHubBack';
import DiscussionBoard from './DiscussionBoard';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

/**
 * A show's discussion board (migration 183): questions, callouts, updates and
 * lost-and-found, from anybody at the show — the office, exhibitors, trainers,
 * spectators — and readable by anybody, account or not.
 *
 * Rendered with the first page already in it, then kept current by the board
 * itself polling from the browser. The show office moderates on this same
 * page: the backend sends a moderator the posts it has hidden, marked, and the
 * screen offers them the controls. There is no separate office screen.
 */
/** The board, `'missing'` for a show with none to read (a draft, or no such
 *  show), or null when it could not be loaded. */
async function loadBoard(showId: string): Promise<BoardPayload | 'missing' | null> {
  const headers = (await getAuthHeaders()) ?? {
    'Content-Type': 'application/json',
    'X-API-Key': INTERNAL_API_KEY,
  };
  try {
    const res = await fetch(`${API_URL}/shows/${showId}/board`, { headers, cache: 'no-store' });
    if (res.status === 404) return 'missing';
    if (!res.ok) return null;
    return (await readJsonBody(res)) as BoardPayload | null;
  } catch {
    return null;
  }
}

export default async function ShowBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = showHubBack(id);
  const [show, board] = await Promise.all([fetchShow(id).catch(() => null), loadBoard(id)]);
  if (!show || board === 'missing') notFound();

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={back.backHref} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← {back.backLabel}
      </Link>

      <div className="mt-4 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Discussion Board</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {show.name} — questions, callouts, show updates and lost &amp; found, for everybody at the show.
        </p>
      </div>

      {board ? (
        <DiscussionBoard showId={id} initial={board} />
      ) : (
        <div
          className="rounded-lg border p-4 text-sm"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error)' }}
        >
          The board couldn&rsquo;t be loaded just now. Refresh the page to try again.
        </div>
      )}
    </main>
  );
}
