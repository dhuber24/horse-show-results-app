import Link from 'next/link';
import { fetchShow, fetchShowLeaderboard } from '@/lib/api';
import AutoRefresh from '@/components/AutoRefresh';
import HighPointStandings from '@/components/HighPointStandings';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';
import BackToShow from '../_components/BackToShow';

/**
 * The show's high-point standings (migration 147).
 *
 * This was a "coming soon" card that computed nothing, so it never moved
 * however many classes were posted. Now every posted class adds points under
 * the points system the show office chose; see `backend/high_point.py` for the
 * rules. It refreshes itself while the show runs, because the whole point of
 * opening it at the rail is to see the class that was just posted.
 *
 * A show with no points system says so rather than guessing a chart: each
 * association scores differently, and a number computed on the wrong chart is
 * worse than none.
 */
function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-8 text-center" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
      <div className="text-4xl mb-3" aria-hidden="true">⭐</div>
      <p className="text-base font-medium" style={{ color: 'var(--foreground)' }}>{title}</p>
      <p className="text-sm mt-2 max-w-md mx-auto" style={{ color: 'var(--muted)' }}>{children}</p>
    </div>
  );
}

export default async function ShowLeaderboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = showHubBack(id);
  const [show, board] = await Promise.all([fetchShow(id), fetchShowLeaderboard(id)]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      {show.status === 'ACTIVE' && <AutoRefresh />}
      <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />

      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Leaderboard</h2>
        {board?.point_system && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {board.point_system.name} · {board.posted_class_count}{' '}
            {board.posted_class_count === 1 ? 'class' : 'classes'} posted
          </span>
        )}
      </div>

      {!board ? (
        <Notice title="The standings could not be loaded">Refresh in a moment.</Notice>
      ) : !board.point_system ? (
        <Notice title="No high point at this show yet">
          The show office has not chosen a points system for this show. Class-by-class placings
          are on the <Link href={`/shows/${id}/results`} className="underline" style={{ color: 'var(--accent)' }}>Results</Link> page.
        </Notice>
      ) : board.divisions.length === 0 ? (
        <Notice title="No points yet">
          Standings appear here as soon as the first class is judged and its placings are posted.
        </Notice>
      ) : (
        <HighPointStandings divisions={board.divisions} pointSystem={board.point_system} />
      )}

      {board && board.circuits.length > 0 && (
        <div className="mt-6 rounded-lg border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
            This show counts toward {board.circuits.length === 1 ? 'a season circuit' : 'these season circuits'}
          </p>
          <ul className="mt-2 space-y-1">
            {board.circuits.map((c) => (
              <li key={c.id}>
                <Link href={`/circuits/${c.id}`} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
                  {c.name}{c.season ? ` (${c.season})` : ''} — season standings →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <BackToShow showId={id} />
    </main>
  );
}
