import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

type EntryRow = {
  entry_id: string;
  back_number: number | null;
  status: string;
  is_disqualified: boolean;
  entry_created_at: string | null;
  show_name: string;
  show_id: string;
  show_status: string;
  show_start_date: string;
  show_end_date: string;
  show_venue: string | null;
  class_number: number;
  class_name: string;
  class_id: string;
  class_date: string;
  horse_name: string | null;
  place: number | null;
  is_tie: boolean;
};

type ShowGroup = {
  show_id: string;
  show_name: string;
  show_status: string;
  show_start_date: string;
  show_end_date: string;
  show_venue: string | null;
  entries: EntryRow[];
};

const STATUS_BADGE: Record<string, { label: string; bgColor: string; textColor: string }> = {
  ACTIVE:    { label: 'In Progress',           bgColor: '#fef3c7', textColor: '#92400e' },
  PUBLISHED: { label: 'Open for Registration', bgColor: '#dbeafe', textColor: '#1e40af' },
  COMPLETED: { label: 'Completed',             bgColor: '#f3f4f6', textColor: '#6b7280' },
  DRAFT:     { label: 'Draft',                 bgColor: '#f3f4f6', textColor: '#6b7280' },
};

const SHOW_ORDER: Record<string, number> = { ACTIVE: 0, PUBLISHED: 1, DRAFT: 2, COMPLETED: 3 };

function ordinal(n: number) {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'];
  return n + (suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]);
}

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const yr = e.getFullYear();
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (s.toDateString() === e.toDateString()) return `${mo(s)}, ${yr}`;
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear())
    return `${mo(s)}–${e.getDate()}, ${yr}`;
  return `${mo(s)} – ${mo(e)}, ${yr}`;
}

async function getDashboard(userId: string) {
  const headers = await getAuthHeaders();
  if (!headers) return { exhibitor: null, entries: [] };
  const res = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, { headers, cache: 'no-store' });
  return res.json();
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/login');
  const userId = (session.user as any).id;
  const data = await getDashboard(userId);

  const hasEntries = data.exhibitor && data.entries?.length > 0;

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>My Show Entries</h1>
        {data.exhibitor && (
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{data.exhibitor.full_name}</p>
        )}
      </div>

      {!hasEntries ? (
        <div className="rounded-lg border p-6 text-center" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
          <p className="text-lg mb-1" style={{ color: '#2c1810' }}>No entries yet</p>
          <p className="text-sm" style={{ color: '#8b7355' }}>
            Contact the show secretary to be added to classes.
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
        <ShowGroups entries={data.entries} />
      )}
    </main>
  );
}

function ShowGroups({ entries }: { entries: EntryRow[] }) {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Group entries by show
  const showMap = new Map<string, ShowGroup>();
  for (const entry of entries) {
    if (!showMap.has(entry.show_id)) {
      showMap.set(entry.show_id, {
        show_id: entry.show_id,
        show_name: entry.show_name,
        show_status: entry.show_status,
        show_start_date: entry.show_start_date,
        show_end_date: entry.show_end_date,
        show_venue: entry.show_venue,
        entries: [],
      });
    }
    showMap.get(entry.show_id)!.entries.push(entry);
  }

  const showGroups = Array.from(showMap.values()).sort((a, b) => {
    const ao = SHOW_ORDER[a.show_status] ?? 2;
    const bo = SHOW_ORDER[b.show_status] ?? 2;
    if (ao !== bo) return ao - bo;
    return b.show_start_date.localeCompare(a.show_start_date);
  });

  const upcoming = showGroups.filter((s) => ['ACTIVE', 'PUBLISHED'].includes(s.show_status));
  const past = showGroups.filter((s) => !['ACTIVE', 'PUBLISHED'].includes(s.show_status));

  const newCount = entries.filter(
    (e) => !e.place && !e.is_disqualified && e.entry_created_at && new Date(e.entry_created_at) > sevenDaysAgo
  ).length;

  return (
    <div className="space-y-8">
      {newCount > 0 && (
        <div className="rounded-lg border px-4 py-3 flex items-center gap-3" style={{ borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }}>
          <span className="text-blue-600 text-lg">📋</span>
          <p className="text-sm" style={{ color: '#1e40af' }}>
            You have been added to {newCount} new class{newCount > 1 ? 'es' : ''} in the past week.
          </p>
        </div>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#8b7355' }}>
            Active &amp; Upcoming
          </h2>
          <ShowList groups={upcoming} sevenDaysAgo={sevenDaysAgo} />
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#8b7355' }}>
            Past Shows
          </h2>
          <ShowList groups={past} sevenDaysAgo={sevenDaysAgo} />
        </section>
      )}
    </div>
  );
}

function ShowList({ groups, sevenDaysAgo }: { groups: ShowGroup[]; sevenDaysAgo: Date }) {
  return (
    <div className="space-y-4">
      {groups.map((show) => (
        <ShowCard key={show.show_id} show={show} sevenDaysAgo={sevenDaysAgo} />
      ))}
    </div>
  );
}

function ShowCard({ show, sevenDaysAgo }: { show: ShowGroup; sevenDaysAgo: Date }) {
  const badge = STATUS_BADGE[show.show_status] ?? STATUS_BADGE.DRAFT;
  const sorted = [...show.entries].sort((a, b) => (a.class_number ?? 0) - (b.class_number ?? 0));

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#d4b896' }}>
      {/* Show header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3" style={{ backgroundColor: '#faf4ec' }}>
        <div className="min-w-0">
          <Link
            href={`/shows/${show.show_id}`}
            className="font-semibold hover:underline leading-snug block"
            style={{ color: '#2c1810' }}
          >
            {show.show_name}
          </Link>
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            {formatDateRange(show.show_start_date, show.show_end_date)}
            {show.show_venue && <> · {show.show_venue}</>}
          </p>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded font-medium shrink-0 mt-0.5"
          style={{ backgroundColor: badge.bgColor, color: badge.textColor }}
        >
          {badge.label}
        </span>
      </div>

      {/* Entry rows */}
      <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
        {sorted.map((entry) => (
          <EntryRow key={entry.entry_id} entry={entry} sevenDaysAgo={sevenDaysAgo} />
        ))}
      </ul>
    </div>
  );
}

function EntryRow({ entry, sevenDaysAgo }: { entry: EntryRow; sevenDaysAgo: Date }) {
  const isNew =
    entry.place == null &&
    !entry.is_disqualified &&
    !!entry.entry_created_at &&
    new Date(entry.entry_created_at) > sevenDaysAgo;

  return (
    <li>
      <Link
        href={`/shows/${entry.show_id}/classes/${entry.class_id}`}
        className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-amber-50"
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium" style={{ color: '#2c1810' }}>
            {entry.class_number} — {entry.class_name}
          </div>
          <div className="text-xs mt-0.5 flex items-center flex-wrap gap-x-2 gap-y-1" style={{ color: '#8b7355' }}>
            {entry.horse_name && <span>🐴 {entry.horse_name}</span>}
            {entry.back_number != null ? (
              <span>#{entry.back_number}</span>
            ) : (
              <span className="italic">No back # yet</span>
            )}
            {isNew && (
              <span
                className="px-1.5 py-0.5 rounded text-xs font-medium"
                style={{ backgroundColor: '#dbeafe', color: '#1e40af' }}
              >
                New
              </span>
            )}
          </div>
        </div>
        <div className="ml-4 text-right shrink-0">
          {entry.is_disqualified ? (
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}
            >
              DQ
            </span>
          ) : entry.place != null ? (
            <div>
              <div className="text-2xl font-bold leading-none" style={{ color: '#8b4513' }}>
                {ordinal(entry.place)}{entry.is_tie ? 'T' : ''}
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>place</div>
            </div>
          ) : (
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: '#f5f5f4', color: '#78716c' }}
            >
              Pending
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
