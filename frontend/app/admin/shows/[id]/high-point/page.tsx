import Link from 'next/link';
import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import { fetchAssociations, fetchPointSystems, fetchShow, fetchShowLeaderboard } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import { formatPoints } from '@/lib/high-point';
import ShowPointChart, { type AssociationOption } from './ShowPointChart';

/**
 * The show's high point (migration 147): the chart its public leaderboard
 * scores by, and which season circuits it counts toward. The standings
 * themselves are the public leaderboard — derived from posted placings on
 * every read, so there is nothing here to recalculate or publish.
 *
 * The chart is chosen from a template and kept as the show's own (migration
 * 153) — see `ShowPointChart`.
 */
export default async function ShowHighPointPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'ADMIN';
  const headers = await getAuthHeaders();
  const [show, systems, board, associations] = await Promise.all([
    fetchShow(id),
    fetchPointSystems(headers),
    fetchShowLeaderboard(id),
    fetchAssociations(headers ?? undefined).catch(() => [] as AssociationOption[]),
  ]);
  const leaders = (board?.divisions ?? []).map((d) => ({ division: d.name, top: d.standings[0] }));

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'High Point' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>High Point</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{show.name}</p>
      </div>

      <section className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Points chart</h2>
        <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
          Every class adds to the public leaderboard as soon as its placings are posted, scored by
          the chart set here. Start from an association&apos;s chart or from scratch, and change any
          number for this show. Each judge&apos;s card counts on its own.
        </p>
        <ShowPointChart
          showId={id}
          showName={show.name}
          templates={systems}
          current={board?.point_system ?? null}
          associations={(associations as AssociationOption[]).map((a) => ({ id: a.id, code: a.code, name: a.name }))}
          isAdmin={isAdmin}
        />
      </section>

      <section className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Leaders</h2>
          <Link href={`/shows/${id}/leaderboard`} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
            Public leaderboard →
          </Link>
        </div>
        {!board?.point_system ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Choose a points system to see standings.</p>
        ) : leaders.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No points yet — {board.posted_class_count}{' '}
            {board.posted_class_count === 1 ? 'class has' : 'classes have'} been posted.
          </p>
        ) : (
          <ul className="text-sm space-y-1" style={{ color: 'var(--text-deep)' }}>
            {leaders.map(({ division, top }) => (
              <li key={division}>
                <span className="font-medium" style={{ color: 'var(--foreground)' }}>{division}:</span>{' '}
                {top
                  ? `${top.exhibitor_name}${top.horse_name ? ` on ${top.horse_name}` : ''} — ${formatPoints(top.points)} pts`
                  : '—'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border rounded-lg p-4 space-y-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>Season circuits</h2>
        {board && board.circuits.length > 0 ? (
          <ul className="text-sm space-y-1">
            {board.circuits.map((c) => (
              <li key={c.id}>
                <Link href={`/circuits/${c.id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                  {c.name}{c.season ? ` (${c.season})` : ''}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>This show is not part of a season circuit.</p>
        )}
        <Link href="/admin/circuits" className="inline-block text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          Manage season circuits →
        </Link>
      </section>
    </main>
  );
}
