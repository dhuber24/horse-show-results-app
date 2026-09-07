import Link from 'next/link';
import Image from 'next/image';
import { fetchShows } from '@/lib/api';

export default async function Home() {
  const showsResult = await Promise.allSettled([fetchShows()]);
  const shows = showsResult[0].status === 'fulfilled' ? showsResult[0].value : [];
  const loadError = showsResult[0].status === 'rejected';
  const activeCount = Array.isArray(shows) ? shows.filter((s: any) => s.status === 'ACTIVE').length : 0;
  const upcomingCount = Array.isArray(shows) ? shows.filter((s: any) => s.status === 'PUBLISHED').length : 0;

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      {/* The stacked lockup, 180px wide against the brand sheet's 140px
          minimum. The name is on screen twice as a result — the navbar carries
          it too — so this is alt-texted decorative. */}
      <Image
        src="/brand/gaitdesk-stacked-800w.png"
        alt=""
        aria-hidden="true"
        width={800}
        height={930}
        priority
        className="h-auto w-[180px] mx-auto mt-6 mb-10"
      />

      <div className="mb-6">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Welcome</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Follow shows live or browse what&apos;s coming up</p>
      </div>

      {loadError && (
        <div className="rounded-lg border p-3 mb-4 text-sm" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
          Shows are temporarily unavailable while the server finishes starting. Refresh in a moment.
        </div>
      )}

      <div className="space-y-3">
        <Link
          href="/shows/active"
          className="flex items-center justify-between gap-3 p-4 rounded-lg border transition hover:shadow-md"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🟢</span>
            <div>
              <div className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>Active Shows</div>
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                {activeCount > 0
                  ? `${activeCount} show${activeCount === 1 ? '' : 's'} happening now — view live schedules & results`
                  : 'View schedules, results, and standings for shows happening now'}
              </div>
            </div>
          </div>
          <span className="text-xl shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true">→</span>
        </Link>

        <Link
          href="/shows/upcoming"
          className="flex items-center justify-between gap-3 p-4 rounded-lg border transition hover:shadow-md"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">📅</span>
            <div>
              <div className="font-semibold text-lg" style={{ color: 'var(--foreground)' }}>Upcoming Shows</div>
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                {upcomingCount > 0
                  ? `${upcomingCount} show${upcomingCount === 1 ? '' : 's'} open for registration — browse & search all shows`
                  : 'Browse and search all shows by name, type, or date'}
              </div>
            </div>
          </div>
          <span className="text-xl shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true">→</span>
        </Link>
      </div>
    </main>
  );
}
