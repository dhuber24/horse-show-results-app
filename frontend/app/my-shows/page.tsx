import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import ShowBillBreakdown from '@/components/ShowBillBreakdown';
import {
  formatDateRange,
  formatMoney,
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
  const outstanding = upcoming.reduce((sum, s) => sum + s.bill.total_cents, 0);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>My Shows</h1>
          {data.exhibitor && (
            <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{data.exhibitor.full_name}</p>
          )}
        </div>
        <Link
          href="/dashboard"
          className="text-sm font-medium px-3 py-2 rounded border"
          style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
        >
          My entries &amp; results →
        </Link>
      </div>

      {data.shows.length === 0 ? (
        <div
          className="rounded-lg border p-6 text-center"
          style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}
        >
          <p className="text-lg mb-1" style={{ color: '#2c1810' }}>No shows yet</p>
          <p className="text-sm" style={{ color: '#8b7355' }}>
            Sign up for a show to reserve stalls and enter classes.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 text-sm font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            Browse upcoming shows →
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {outstanding > 0 && (
            <div
              className="rounded-lg border px-4 py-3 flex items-center justify-between gap-3"
              style={{ borderColor: '#d4b896', backgroundColor: '#faf4ec' }}
            >
              <div className="text-sm" style={{ color: '#5d4a37' }}>
                Due at {upcoming.length === 1 ? 'this show' : 'these shows'}
              </div>
              <div className="text-xl font-bold" style={{ color: '#2c1810' }}>
                {formatMoney(outstanding)}
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <section>
              <h2
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: '#8b7355' }}
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
                style={{ color: '#8b7355' }}
              >
                Past Shows
              </h2>
              <div className="space-y-4">
                {past.map((show) => <ShowBillCard key={show.show_id} show={show} />)}
              </div>
            </section>
          )}

          <p className="text-xs" style={{ color: '#8b7355' }}>
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
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#d4b896' }}>
      <div
        className="px-4 py-3 flex items-start justify-between gap-3"
        style={{ backgroundColor: '#faf4ec' }}
      >
        <div className="min-w-0">
          <Link
            href={`/shows/${show.show_id}`}
            className="font-semibold hover:underline leading-snug block"
            style={{ color: '#2c1810' }}
          >
            {show.show_name}
          </Link>
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            {formatDateRange(show.start_date, show.end_date)}
            {show.venue && <> · {show.venue}</>}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
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

        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t" style={{ borderColor: '#f0e4d0' }}>
          <Link
            href={`/shows/${show.show_id}`}
            className="text-xs font-medium px-2.5 py-1 rounded border"
            style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
          >
            Show details
          </Link>
          <Link
            href={`/shows/${show.show_id}/schedule`}
            className="text-xs font-medium px-2.5 py-1 rounded border"
            style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
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
            style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
          >
            Message the office
          </Link>
          {show.show_status === 'PUBLISHED' && (
            <>
              <Link
                href={`/shows/${show.show_id}/signup`}
                className="text-xs font-medium px-2.5 py-1 rounded border"
                style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
              >
                Stalls &amp; camping
              </Link>
              <Link
                href={`/shows/${show.show_id}/register`}
                className="text-xs font-medium px-2.5 py-1 rounded"
                style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
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
