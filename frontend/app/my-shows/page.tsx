import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import StartedRegistrationCard from './StartedRegistrationCard';
import { formatDateRange, isPastShow, type MyShow, type MyShowsData } from '@/lib/my-shows';

async function loadMyShows(): Promise<MyShowsData> {
  const headers = await getAuthHeaders();
  if (!headers) return { exhibitor: null, shows: [], started: [] };
  const res = await fetch(`${API_URL}/my-shows/`, { headers, cache: 'no-store' });
  if (!res.ok) return { exhibitor: null, shows: [], started: [] };
  return res.json();
}

export default async function MyShowsPage() {
  const session = await auth();
  if (!session) redirect('/login?next=/my-shows');

  const data = await loadMyShows();
  const upcoming = data.shows.filter((s) => !isPastShow(s));
  const past = data.shows.filter(isPastShow);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>My Shows</h1>
          {data.exhibitor && (
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{data.exhibitor.full_name}</p>
          )}
        </div>
        <Link
          href="/dashboard"
          className="text-sm font-medium px-3 py-2 rounded border"
          style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
        >
          My entries &amp; results →
        </Link>
      </div>

      {data.shows.length === 0 && data.started.length === 0 ? (
        <div
          className="rounded-lg border p-6 text-center"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
        >
          <p className="text-lg mb-1" style={{ color: 'var(--foreground)' }}>No shows yet</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Sign up for a show to reserve stalls and enter classes.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 text-sm font-medium hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Browse upcoming shows →
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* No roll-up across shows here. A total spanning four weekends is
              not a figure anyone is ever asked for — the office collects per
              show, against a back number — so each show's bill is its What I
              Owe page, on the show menu behind its button below. */}
          {/* Above the shows, because it is the only thing on this page that
              is waiting on the exhibitor. Everything below is a record of what
              they have already done; this is the show they meant to finish. */}
          {data.started.length > 0 && (
            <section>
              <h2
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: 'var(--muted)' }}
              >
                Started — not finished
              </h2>
              <div className="space-y-4">
                {data.started.map((show) => (
                  <StartedRegistrationCard key={show.show_id} show={show} />
                ))}
              </div>
            </section>
          )}

          {upcoming.length > 0 && (
            <section>
              <h2
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: 'var(--muted)' }}
              >
                Active &amp; Upcoming
              </h2>
              <div className="space-y-2">
                {upcoming.map((show) => <ShowButton key={show.show_id} show={show} />)}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: 'var(--muted)' }}
              >
                Past Shows
              </h2>
              <div className="space-y-2">
                {past.map((show) => <ShowButton key={show.show_id} show={show} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

/**
 * One show, as a button: its name, its dates and where it is. It opens the
 * show's own menu (`/shows/[id]`), which already carries everything the old
 * card did — the signed-up banner with the back number and class count (and a
 * prompt when no class is entered yet), Add/Drop Classes, My Registration, What I
 * Owe, the schedule and the show office. A page of full cards put the second
 * show a screen and a half down a phone, under the first show's bill.
 */
function ShowButton({ show }: { show: MyShow }) {
  const place = [show.venue, show.location].filter(Boolean).join(' · ');
  return (
    <Link
      href={`/shows/${show.show_id}`}
      className="flex items-center gap-3 px-4 py-3 rounded-lg border transition hover:shadow-md"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold leading-snug" style={{ color: 'var(--foreground)' }}>
          {show.show_name}
        </div>
        <div className="text-sm mt-0.5" style={{ color: 'var(--text-deep)' }}>
          {formatDateRange(show.start_date, show.end_date)}
        </div>
        {place && (
          <div className="text-sm" style={{ color: 'var(--muted)' }}>
            {place}
          </div>
        )}
      </div>
      <span aria-hidden="true" className="text-2xl leading-none shrink-0" style={{ color: 'var(--muted)' }}>
        ›
      </span>
    </Link>
  );
}
