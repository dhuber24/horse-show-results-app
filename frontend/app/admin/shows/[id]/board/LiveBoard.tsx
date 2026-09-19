'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { outcomeShort } from '@/lib/result-outcomes';

// How long each class sits on the main stage before the board advances to
// the next one.
const DWELL_MS = 10000;
// How fast the bottom ticker crawls, in pixels of travel per second. Tuned
// by eye — fast enough that nobody stands around waiting for a line to pass,
// slow enough to actually read it as it goes by.
const TICKER_PX_PER_SEC = 70;

interface ClassItem {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  ring_name?: string | null;
  discipline_name?: string | null;
  division_name?: string | null;
  results_published_at: string | null;
  entry_count?: number;
}

interface Placing {
  place: number | null;
  is_tie: boolean;
  outcome: string;
  outcome_note?: string | null;
  back_number: number | null;
  exhibitor_name: string;
  horse_name: string | null;
  judge_name: string | null;
}

interface ShowInfo {
  name: string;
  venue?: string | null;
  status: string;
}

const PLACE_COLOR: Record<number, string> = {
  1: 'var(--accent-light)',
  2: '#d9dde3',
  3: 'var(--warning)',
};

function placeOrdinal(n: number) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function rowLabel(p: Placing) {
  const who = [p.exhibitor_name, p.horse_name].filter(Boolean).join(' · ');
  return p.back_number != null ? `#${p.back_number} ${who}` : who;
}

/** Groups a class's placings by judge. A single-judge class (nearly all of
 *  them) collapses to one group with a null key so the stage renders one
 *  plain list instead of a pointless "Judge: —" header. */
function groupByJudge(rows: Placing[]): Map<string | null, Placing[]> {
  const distinctJudges = new Set(rows.map((r) => r.judge_name).filter(Boolean));
  const groups = new Map<string | null, Placing[]>();
  for (const row of rows) {
    const key = distinctJudges.size > 1 ? row.judge_name : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

function ClassStage({ cls, rows }: { cls: ClassItem; rows: Placing[] }) {
  const groups = useMemo(() => groupByJudge(rows), [rows]);
  const context = [cls.ring_name, cls.division_name, cls.discipline_name].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col animate-[board-fade-in_0.4s_ease-out]">
      <div className="mb-6">
        <div className="text-2xl font-medium tracking-wide" style={{ color: 'var(--on-slate-muted)' }}>
          {context || 'Class Results'}
        </div>
        <h1 className="text-5xl md:text-6xl font-bold mt-1" style={{ color: 'var(--on-slate)' }}>
          #{cls.class_number} · {cls.class_name}
        </h1>
      </div>

      {rows.length === 0 ? (
        <p className="text-3xl" style={{ color: 'var(--on-slate-muted)' }}>No placings recorded.</p>
      ) : (
        <div className={`grid gap-8 flex-1 ${groups.size > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {[...groups.entries()].map(([judgeName, judgeRows]) => (
            <div key={judgeName ?? 'single'} className="flex flex-col">
              {judgeName && (
                <div className="text-xl font-semibold mb-3" style={{ color: 'var(--accent-light)' }}>
                  Judge {judgeName}
                </div>
              )}
              <ul className="space-y-2.5">
                {judgeRows.slice(0, 8).map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-4 text-3xl md:text-4xl"
                    style={{ color: 'var(--on-slate)' }}
                  >
                    <span
                      className="flex-none w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold"
                      style={{
                        backgroundColor: r.place ? (PLACE_COLOR[r.place] ?? 'var(--slate-raised)') : 'var(--slate-raised)',
                        color: r.place && r.place <= 3 ? 'var(--brand-slate)' : 'var(--on-slate-muted)',
                        border: r.place ? 'none' : '2px solid var(--on-slate-muted)',
                      }}
                    >
                      {r.place ?? (outcomeShort(r.outcome) || '—')}
                    </span>
                    <span className="truncate">
                      {rowLabel(r)}
                      {r.is_tie && <span className="text-xl ml-2" style={{ color: 'var(--on-slate-muted)' }}>(tie)</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {judgeRows.length > 8 && (
                <div className="mt-2 text-xl" style={{ color: 'var(--on-slate-muted)' }}>
                  +{judgeRows.length - 8} more
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Ticker({ items }: { items: string[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(40);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const oneCopyWidth = el.scrollWidth / 2;
    setDuration(Math.max(15, oneCopyWidth / TICKER_PX_PER_SEC));
  }, [items]);

  if (items.length === 0) return null;

  const strip = items.join('      ★      ');

  return (
    <div className="overflow-hidden w-full" style={{ backgroundColor: 'var(--slate-raised)' }}>
      <div
        ref={trackRef}
        className="flex whitespace-nowrap py-4 text-2xl font-medium"
        style={{
          color: 'var(--on-slate)',
          animation: `board-marquee ${duration}s linear infinite`,
          width: 'max-content',
        }}
      >
        <span className="pr-20">{strip}</span>
        <span className="pr-20" aria-hidden="true">{strip}</span>
      </div>
    </div>
  );
}

export default function LiveBoard({
  showId,
  show,
  classes,
  resultsIndex,
}: {
  showId: string;
  show: ShowInfo;
  classes: ClassItem[];
  resultsIndex: Record<string, Placing[]>;
}) {
  const [now, setNow] = useState(() => new Date());
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    // Lobby TV, not a page the viewer scrolls — the board owns the whole
    // viewport for as long as it's mounted.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const postedToday = useMemo(() => {
    const posted = classes.filter((c) => c.results_published_at && c.status !== 'DRAFT');
    if (posted.length === 0) return [];
    const latestDate = posted.reduce((max, c) => (c.class_date > max ? c.class_date : max), posted[0].class_date);
    return posted
      .filter((c) => c.class_date === latestDate)
      .sort((a, b) => (b.results_published_at! > a.results_published_at! ? 1 : -1));
  }, [classes]);

  useEffect(() => {
    if (postedToday.length < 2) return;
    const t = setInterval(() => setActiveIndex((i) => (i + 1) % postedToday.length), DWELL_MS);
    return () => clearInterval(t);
  }, [postedToday.length]);

  const active = postedToday[activeIndex % Math.max(postedToday.length, 1)];
  const activeRows = active ? resultsIndex[active.id] ?? [] : [];

  const tickerItems = useMemo(
    () =>
      postedToday.map((c) => {
        const rows = (resultsIndex[c.id] ?? []).filter((r) => r.place != null).slice(0, 3);
        const summary = rows.map((r) => `${placeOrdinal(r.place!)} ${rowLabel(r)}`).join('  ·  ');
        return `#${c.class_number} ${c.class_name}: ${summary || 'no placings yet'}`;
      }),
    [postedToday, resultsIndex],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: 'var(--slate)' }}
    >
      <header className="flex items-center justify-between px-10 pt-6 pb-4 flex-none">
        {/* The way back out of a full-screen board with no chrome. It goes to
            the show's admin console rather than the public hub, because the
            only person who can be looking at this is the one who put it up. */}
        <Link
          href={`/admin/shows/${showId}`}
          className="text-sm opacity-30 hover:opacity-80 transition"
          style={{ color: 'var(--on-slate)' }}
        >
          GaitDesk
        </Link>
        <div className="text-center">
          <div className="text-2xl font-bold" style={{ color: 'var(--on-slate)' }}>{show.name}</div>
          {show.venue && (
            <div className="text-base" style={{ color: 'var(--on-slate-muted)' }}>{show.venue}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
              style={{ backgroundColor: 'var(--accent-light)' }}
            />
            <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: 'var(--accent-light)' }} />
          </span>
          <span className="text-sm font-semibold tracking-wider" style={{ color: 'var(--accent-light)' }}>LIVE</span>
          <span className="text-lg tabular-nums ml-2" style={{ color: 'var(--on-slate-muted)' }}>
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      </header>

      <main className="flex-1 min-h-0 px-10 pb-4 flex items-center justify-center">
        {active ? (
          <div className="w-full max-w-6xl">
            <ClassStage key={active.id} cls={active} rows={activeRows} />
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="text-4xl font-semibold" style={{ color: 'var(--on-slate)' }}>
              Waiting on results
            </div>
            <p className="text-xl mt-3 max-w-lg" style={{ color: 'var(--on-slate-muted)' }}>
              Posted placings will start rotating through here as soon as the first class of the day goes up.
            </p>
          </div>
        )}
      </main>

      <footer className="flex-none">
        <Ticker items={tickerItems} />
      </footer>
    </div>
  );
}
