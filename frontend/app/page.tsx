import Link from 'next/link';
import { fetchShows } from '@/lib/api';

export default async function Home() {
  const showsResult = await Promise.allSettled([fetchShows()]);
  const shows = showsResult[0].status === 'fulfilled' ? showsResult[0].value : [];
  const loadError = showsResult[0].status === 'rejected';
  const activeCount = Array.isArray(shows) ? shows.filter((s: any) => s.status === 'ACTIVE').length : 0;
  const upcomingCount = Array.isArray(shows) ? shows.filter((s: any) => s.status === 'PUBLISHED').length : 0;

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6 mt-2">
        <h2 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Welcome</h2>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>Follow shows live or browse what&apos;s coming up</p>
      </div>

      {loadError && (
        <div className="rounded-lg border p-3 mb-4 text-sm" style={{ borderColor: '#fbbf24', backgroundColor: '#fffbeb', color: '#92400e' }}>
          Shows are temporarily unavailable while the server finishes starting. Refresh in a moment.
        </div>
      )}

      <div className="space-y-3">
        <Link
          href="/shows/active"
          className="flex items-center justify-between gap-3 p-4 rounded-lg border transition hover:shadow-md"
          style={{ backgroundColor: '#f0e8d8', borderColor: '#d4b896' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🟢</span>
            <div>
              <div className="font-semibold text-lg" style={{ color: '#2c1810' }}>Active Shows</div>
              <div className="text-sm" style={{ color: '#8b7355' }}>
                {activeCount > 0
                  ? `${activeCount} show${activeCount === 1 ? '' : 's'} happening now — view live schedules & results`
                  : 'View schedules, results, and standings for shows happening now'}
              </div>
            </div>
          </div>
          <span className="text-xl shrink-0" style={{ color: '#8b4513' }} aria-hidden="true">→</span>
        </Link>

        <Link
          href="/shows/upcoming"
          className="flex items-center justify-between gap-3 p-4 rounded-lg border transition hover:shadow-md"
          style={{ backgroundColor: '#f0e8d8', borderColor: '#d4b896' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">📅</span>
            <div>
              <div className="font-semibold text-lg" style={{ color: '#2c1810' }}>Upcoming Shows</div>
              <div className="text-sm" style={{ color: '#8b7355' }}>
                {upcomingCount > 0
                  ? `${upcomingCount} show${upcomingCount === 1 ? '' : 's'} open for registration — browse & search all shows`
                  : 'Browse and search all shows by name, type, or date'}
              </div>
            </div>
          </div>
          <span className="text-xl shrink-0" style={{ color: '#8b4513' }} aria-hidden="true">→</span>
        </Link>
      </div>
    </main>
  );
}
