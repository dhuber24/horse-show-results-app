import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import ShowBillBreakdown from '@/components/ShowBillBreakdown';
import {
  formatDateRange,
  isPastShow,
  ordinal,
  SHOW_STATUS_BADGE,
  type MyShow,
  type MyShowsData,
} from '@/lib/my-shows';

async function loadMyShows(): Promise<MyShowsData> {
  const headers = await getAuthHeaders();
  if (!headers) return { exhibitor: null, shows: [] };
  const res = await fetch(`${API_URL}/my-shows/`, { headers, cache: 'no-store' });
  if (!res.ok) return { exhibitor: null, shows: [] };
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

      {data.shows.length === 0 ? (
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
          {/* No roll-up across shows here any more. A total spanning four
              weekends is not a figure anyone is ever asked for — the office
              collects per show, against a back number — so "Due at this show"
              moved onto the show itself, where the dates and the venue it is
              owed for already are. Each card below still totals its own. */}
          {upcoming.length > 0 && (
            <section>
              <h2
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: 'var(--muted)' }}
              >
                Active &amp; Upcoming
              </h2>
              <div className="space-y-4">
                {upcoming.map((show) => <ShowBillCard key={show.show_id} show={show} />)}
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
              <div className="space-y-4">
                {past.map((show) => <ShowBillCard key={show.show_id} show={show} />)}
              </div>
            </section>
          )}

          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Totals are what the show office will collect — this app does not take payment. If a
            number looks wrong, the show secretary is the one who can change it.
          </p>
        </div>
      )}
    </main>
  );
}

function ShowBillCard({ show }: { show: MyShow }) {
  const badge = SHOW_STATUS_BADGE[show.show_status] ?? SHOW_STATUS_BADGE.DRAFT;
  const { bill } = show;

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
      <div
        className="px-4 py-3 flex items-start justify-between gap-3"
        style={{ backgroundColor: 'var(--background)' }}
      >
        <div className="min-w-0">
          <Link
            href={`/shows/${show.show_id}`}
            className="font-semibold hover:underline leading-snug block"
            style={{ color: 'var(--foreground)' }}
          >
            {show.show_name}
          </Link>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {formatDateRange(show.start_date, show.end_date)}
            {show.venue && <> · {show.venue}</>}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {show.back_number != null ? `Back #${show.back_number}` : 'No back # yet'}
            {' · '}
            {show.entry_count} class{show.entry_count === 1 ? '' : 'es'}
            {show.placed_count > 0 && show.best_place != null && (
              <> · best {ordinal(show.best_place)}</>
            )}
          </p>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded font-medium shrink-0 mt-0.5"
          style={{ backgroundColor: badge.bgColor, color: badge.textColor }}
        >
          {badge.label}
        </span>
      </div>

      <div className="px-4 py-3">
        <ShowBillBreakdown bill={bill} />

        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--bg-subtle)' }}>
          {/* The details page itself, not the show menu — the show name at the
              top of this card is already the link to the menu, and it is the
              details page that carries what you owe here. */}
          <Link
            href={`/shows/${show.show_id}/details`}
            className="text-xs font-medium px-2.5 py-1 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
          >
            Show details
          </Link>
          <Link
            href={`/shows/${show.show_id}/schedule`}
            className="text-xs font-medium px-2.5 py-1 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
          >
            Full class schedule
          </Link>
          {/* The show office, reachable from the screen where somebody is
              looking at a number they want to query. Offered on past shows
              too — "you charged me for four stalls" is a question that arrives
              after the weekend, not during it. */}
          <Link
            href={`/shows/${show.show_id}/contact`}
            className="text-xs font-medium px-2.5 py-1 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
          >
            Message the office
          </Link>
          {show.show_status === 'PUBLISHED' && (
            <>
              <Link
                href={`/shows/${show.show_id}/signup`}
                className="text-xs font-medium px-2.5 py-1 rounded border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-deep)', backgroundColor: 'var(--surface)' }}
              >
                Stalls &amp; camping
              </Link>
              <Link
                href={`/shows/${show.show_id}/register`}
                className="text-xs font-medium px-2.5 py-1 rounded"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
              >
                Manage registration
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
