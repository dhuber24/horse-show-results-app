'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  formatDateRange,
  isPastShow,
  ordinal,
  SHOW_STATUS_BADGE,
  type MyShow,
} from '@/lib/my-shows';

/**
 * Every show this exhibitor has competed in, newest first, each linking back to
 * the show it came from. Reads the same `/my-shows` payload as the My Shows
 * page — one source for "which shows was I part of".
 */
export default function ShowHistoryPanel({ shows }: { shows: MyShow[] }) {
  const [filter, setFilter] = useState('');
  const [includeCurrent, setIncludeCurrent] = useState(false);

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return shows
      .filter((s) => includeCurrent || isPastShow(s))
      .filter((s) =>
        term
          ? [s.show_name, s.venue].some((v) => v?.toLowerCase().includes(term))
          : true,
      );
  }, [shows, filter, includeCurrent]);

  const pastCount = shows.filter(isPastShow).length;

  if (shows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>No show history yet</p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Shows you sign up for appear here, and stay here after the show is over.
        </p>
        <Link
          href="/"
          className="inline-block mt-3 text-xs font-medium hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          Browse upcoming shows →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {pastCount} past show{pastCount === 1 ? '' : 's'}
        </p>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          <input
            type="checkbox"
            checked={includeCurrent}
            onChange={(e) => setIncludeCurrent(e.target.checked)}
          />
          Include current &amp; upcoming
        </label>
      </div>

      {shows.length >= 4 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by show or venue"
          className="w-full border rounded px-3 py-2 text-sm"
          style={{ borderColor: 'var(--border)' }}
        />
      )}

      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {filter
            ? `No shows match “${filter}”.`
            : 'Nothing in your history yet — your current shows are still running.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((show) => {
            const badge = SHOW_STATUS_BADGE[show.show_status] ?? SHOW_STATUS_BADGE.DRAFT;
            return (
              <li
                key={show.show_id}
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/shows/${show.show_id}`}
                      className="text-sm font-medium hover:underline"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {show.show_name}
                    </Link>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                      {formatDateRange(show.start_date, show.end_date)}
                      {show.venue && <> · {show.venue}</>}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                      {show.entry_count} class{show.entry_count === 1 ? '' : 'es'}
                      {show.back_number != null && <> · back #{show.back_number}</>}
                      {show.placed_count > 0 && show.best_place != null && (
                        <>
                          {' · '}
                          <span style={{ color: 'var(--accent)' }}>
                            best {ordinal(show.best_place)}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded font-medium shrink-0"
                    style={{ backgroundColor: badge.bgColor, color: badge.textColor }}
                  >
                    {badge.label}
                  </span>
                </div>

                <div
                  className="flex flex-wrap gap-3 mt-2 pt-2 border-t"
                  style={{ borderColor: 'var(--bg-subtle)' }}
                >
                  <Link
                    href={`/shows/${show.show_id}`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Show page
                  </Link>
                  <Link
                    href={`/shows/${show.show_id}/results`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Results
                  </Link>
                  <Link
                    href={`/shows/${show.show_id}/schedule`}
                    className="text-xs font-medium hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Class schedule
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
