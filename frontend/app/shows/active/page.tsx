import Link from 'next/link';
import { fetchShows } from '@/lib/api';

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

interface Show {
  id: string;
  name: string;
  venue?: string | null;
  start_date: string;
  end_date: string;
  status: string;
  show_type_code?: string | null;
}

export default async function ActiveShowsPage() {
  const result = await Promise.allSettled([fetchShows()]);
  const shows: Show[] = result[0].status === 'fulfilled' ? result[0].value : [];
  const loadError = result[0].status === 'rejected';
  const active = shows.filter((s) => s.status === 'ACTIVE');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to Home
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
          <span className="mr-2">🟢</span>Active Shows
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Shows happening now — view schedules, results, and standings live
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border p-3 mb-4 text-sm"
          style={{ borderColor: '#fbbf24', backgroundColor: '#fffbeb', color: '#92400e' }}>
          Shows are temporarily unavailable while the server finishes starting. Refresh in a moment.
        </div>
      )}

      {active.length === 0 ? (
        <div className="rounded-lg border p-6 text-center" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
          <p className="text-base font-medium" style={{ color: '#2c1810' }}>No active shows right now</p>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            Check the <Link href="/" className="underline" style={{ color: '#8b4513' }}>upcoming shows</Link> for events opening soon.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {active.map((show) => (
            <li key={show.id}>
              <Link href={`/shows/${show.id}/live`}
                className="block p-4 rounded-lg border transition hover:shadow-md"
                style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg" style={{ color: '#2c1810' }}>{show.name}</span>
                  {show.show_type_code && (
                    <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                      {show.show_type_code}
                    </span>
                  )}
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                    In Progress
                  </span>
                </div>
                <div className="text-sm mt-1" style={{ color: '#8b7355' }}>
                  {show.venue ? <>📍 {show.venue} &nbsp;·&nbsp; </> : null}
                  📅 {formatDate(show.start_date)} – {formatDate(show.end_date)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
