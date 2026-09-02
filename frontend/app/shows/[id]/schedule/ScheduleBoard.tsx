'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type ScheduleClass = {
  id: string;
  class_number: string;
  class_name: string;
  class_date: string;
  status: string;
  gate_status: string;
  entry_count: number;
  placed_count: number;
  ring_name: string | null;
  ring_sort_order: number | null;
  discipline_name: string | null;
  division_name: string | null;
  /** Reached by placing first or second in a qualifying class rather than by
   *  entering (migration 129). Marked on the programme so somebody comparing
   *  the schedule against their entry form can see why it is not on offer. */
  entered_by_qualification?: boolean;
};

export type ProgramEntry = {
  id: string;
  back_number: number | null;
  exhibitor_name: string;
  horse_name: string | null;
  owner_name: string | null;
  sire_name: string | null;
  dam_name: string | null;
  is_disqualified: boolean;
  gate_order: number | null;
};

function formatDayLong(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function formatDayShort(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'numeric', day: 'numeric',
  });
}

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const LIVE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  in_progress: { label: '🟢 In the ring', bg: '#d1fae5', text: '#065f46' },
  up_next: { label: 'Up next', bg: '#fef3c7', text: '#92400e' },
  done: { label: 'Done', bg: '#e5e7eb', text: '#374151' },
};

/** The gate's on-deck rule, mirrored for display: within a day and ring, the
 *  first class still awaiting the gate (pending/ready) is the one up next. */
function liveStateFor(cls: ScheduleClass, upNextIds: Set<string>): string | null {
  if (cls.gate_status === 'in_progress') return 'in_progress';
  if (cls.gate_status === 'done') return 'done';
  if (upNextIds.has(cls.id)) return 'up_next';
  return null;
}

function entryText(e: ProgramEntry): string {
  return [
    e.exhibitor_name,
    e.horse_name ?? '',
    e.owner_name ?? '',
    e.sire_name ?? '',
    e.dam_name ?? '',
    e.back_number != null ? `#${e.back_number} ${e.back_number}` : '',
  ].join(' ');
}

// Favorites are per device, not per account: the schedule is a public
// spectator screen and most people reading it at the rail are not signed in.
function favoritesKey(showId: string): string {
  return `hsr:fav-classes:${showId}`;
}

export default function ScheduleBoard({
  showId,
  showStatus,
  classes,
  programIndex,
  isExhibitor = false,
  registeredClassIds = [],
}: {
  showId: string;
  showStatus: string;
  classes: ScheduleClass[];
  programIndex: Record<string, ProgramEntry[]>;
  /** Whether the viewer is a signed-in exhibitor. Spectators never see the
   *  Registered filter — there is nothing for them to be registered in. */
  isExhibitor?: boolean;
  registeredClassIds?: string[];
}) {
  const router = useRouter();
  const isLive = showStatus === 'ACTIVE';

  const registered = useMemo(() => new Set(registeredClassIds), [registeredClassIds]);

  const days = useMemo(
    () => Array.from(new Set(classes.map(c => c.class_date))).sort(),
    [classes],
  );

  const [activeDay, setActiveDay] = useState(() => {
    const today = todayIso();
    return days.includes(today) ? today : (days[0] ?? '');
  });
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [registeredOnly, setRegisteredOnly] = useState(false);
  const hydrated = useRef(false);

  // Favorites load after mount so the server and first client render agree.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(favoritesKey(showId));
      if (raw) setFavorites(new Set(JSON.parse(raw) as string[]));
    } catch {
      // A blocked or corrupt store just means no favorites — never fatal.
    }
    hydrated.current = true;
  }, [showId]);

  // Guarded so the empty pre-hydration set never overwrites what's stored.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(favoritesKey(showId), JSON.stringify([...favorites]));
    } catch {
      // Ignore quota/private-mode failures; favorites stay in memory.
    }
  }, [favorites, showId]);

  // A day can disappear from under the selection when the secretary reschedules
  // classes while the page is open.
  useEffect(() => {
    if (days.length > 0 && !days.includes(activeDay)) setActiveDay(days[0]);
  }, [days, activeDay]);

  // While the show is running, gate status is the whole point of this screen —
  // keep it current without making the spectator pull to refresh.
  useEffect(() => {
    if (!isLive) return;
    const timer = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(timer);
  }, [isLive, router]);

  const upNextIds = useMemo(() => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const c of classes) {
      if (c.gate_status !== 'pending' && c.gate_status !== 'ready') continue;
      const key = `${c.class_date}|${c.ring_name ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ids.add(c.id);
    }
    return ids;
  }, [classes]);

  // One lowercase haystack per class covering the class itself and everyone
  // entered in it, so a spectator can search by horse, exhibitor, owner or
  // pedigree without knowing which class to look in.
  const haystacks = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of classes) {
      const parts = [
        c.class_number, c.class_name, c.ring_name ?? '',
        c.discipline_name ?? '', c.division_name ?? '',
        formatDayLong(c.class_date),
      ];
      for (const e of programIndex[c.id] ?? []) parts.push(entryText(e));
      map[c.id] = parts.join('   ').toLowerCase();
    }
    return map;
  }, [classes, programIndex]);

  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = tokens.length > 0;

  function toggleFavorite(classId: string) {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }

  function toggleExpanded(classId: string) {
    setExpanded(prev => ({ ...prev, [classId]: !prev[classId] }));
  }

  function matchingEntries(classId: string): ProgramEntry[] {
    if (!searching) return [];
    return (programIndex[classId] ?? []).filter(e => {
      const hay = entryText(e).toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
  }

  // Search and both filters span the whole show — someone tracking a horse, or
  // checking what they're entered in, should not have to guess which day it
  // runs on.
  const spanAllDays = searching || favoritesOnly || registeredOnly;

  // The two filters intersect rather than replace each other: "starred *and*
  // entered" is a meaningful question on a long show day.
  const shown = useMemo(() => {
    let base = classes;
    if (favoritesOnly) base = base.filter(c => favorites.has(c.id));
    if (registeredOnly) base = base.filter(c => registered.has(c.id));
    if (searching) base = base.filter(c => tokens.every(t => (haystacks[c.id] ?? '').includes(t)));
    if (!spanAllDays) base = base.filter(c => c.class_date === activeDay);
    return base;
  }, [
    classes, favoritesOnly, favorites, registeredOnly, registered,
    searching, tokens, haystacks, spanAllDays, activeDay,
  ]);

  const dayClasses = classes.filter(c => c.class_date === activeDay);
  const dayDone = dayClasses.filter(c => c.gate_status === 'done').length;

  // Both filters can be on at once, so the summary and empty state name
  // whichever combination is actually active rather than assuming one.
  const filtering = favoritesOnly || registeredOnly;
  const filterLabel = favoritesOnly && registeredOnly
    ? 'starred and entered'
    : favoritesOnly ? 'starred' : 'entered';

  // Ring headers only earn their space when the day actually runs more than one.
  const showRingHeaders = !spanAllDays && new Set(shown.map(c => c.ring_name ?? '')).size > 1;

  const grouped = useMemo(() => {
    const order: string[] = [];
    const bucket = new Map<string, ScheduleClass[]>();
    for (const c of shown) {
      const key = spanAllDays ? c.class_date : (c.ring_name ?? 'Unassigned ring');
      if (!bucket.has(key)) { bucket.set(key, []); order.push(key); }
      bucket.get(key)!.push(c);
    }
    return order.map(key => ({ key, items: bucket.get(key)! }));
  }, [shown, spanAllDays]);

  const renderEntryTable = (entries: ProgramEntry[]) => (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr style={{ color: '#8b4513' }}>
            <th className="text-left font-semibold py-1 pr-3 whitespace-nowrap">Back #</th>
            <th className="text-left font-semibold py-1 pr-3">Exhibitor</th>
            <th className="text-left font-semibold py-1 pr-3">Horse</th>
            <th className="text-left font-semibold py-1 pr-3">Owner</th>
            <th className="text-left font-semibold py-1 pr-3">Sire</th>
            <th className="text-left font-semibold py-1">Dam</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} className="border-t" style={{ borderColor: '#f0e6d6' }}>
              <td className="py-1.5 pr-3 font-semibold whitespace-nowrap" style={{ color: '#2c1810' }}>
                {e.back_number ?? '—'}
                {e.is_disqualified && (
                  <span className="ml-1 font-normal" style={{ color: '#b91c1c' }}>DQ</span>
                )}
              </td>
              <td className="py-1.5 pr-3" style={{ color: '#5a3e2b' }}>{e.exhibitor_name}</td>
              <td className="py-1.5 pr-3" style={{ color: '#2c1810' }}>{e.horse_name || '—'}</td>
              <td className="py-1.5 pr-3" style={{ color: '#5a3e2b' }}>{e.owner_name || '—'}</td>
              <td className="py-1.5 pr-3" style={{ color: '#8b7355' }}>{e.sire_name || '—'}</td>
              <td className="py-1.5" style={{ color: '#8b7355' }}>{e.dam_name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      {!spanAllDays && days.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
          {days.map(day => (
            <button
              key={day}
              type="button"
              onClick={() => setActiveDay(day)}
              className="shrink-0 text-sm font-medium px-3 py-1.5 rounded-full border transition"
              style={day === activeDay
                ? { backgroundColor: '#8b4513', borderColor: '#8b4513', color: '#ffffff' }
                : { backgroundColor: '#ffffff', borderColor: '#d4b896', color: '#8b4513' }}
            >
              {formatDayShort(day)}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 space-y-2">
        <div className="relative">
          <label htmlFor="schedule-search" className="sr-only">Search the schedule</label>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#8b7355' }}>🔍</span>
          <input
            id="schedule-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by horse, exhibitor, owner, sire, dam, back # or class…"
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff', color: '#2c1810' }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setFavoritesOnly(v => !v)}
              aria-pressed={favoritesOnly}
              disabled={favorites.size === 0 && !favoritesOnly}
              title={favorites.size === 0
                ? 'Star a class to start tracking it'
                : favoritesOnly ? 'Show all classes' : 'Show only starred classes'}
              className="text-sm font-medium px-3 py-1.5 rounded-full border transition disabled:opacity-50"
              style={favoritesOnly
                ? { backgroundColor: '#8b4513', borderColor: '#8b4513', color: '#ffffff' }
                : { backgroundColor: '#ffffff', borderColor: '#d4b896', color: '#8b4513' }}
            >
              ★ Favorites{favorites.size > 0 ? ` (${favorites.size})` : ''}
            </button>

            {/* Only offered to exhibitors: a spectator has nothing to be
                registered in, so the control would be permanently dead. */}
            {isExhibitor && (
              <button
                type="button"
                onClick={() => setRegisteredOnly(v => !v)}
                aria-pressed={registeredOnly}
                disabled={registered.size === 0 && !registeredOnly}
                title={registered.size === 0
                  ? "You're not entered in any classes at this show yet"
                  : registeredOnly ? 'Show all classes' : "Show only classes you're entered in"}
                className="text-sm font-medium px-3 py-1.5 rounded-full border transition disabled:opacity-50"
                style={registeredOnly
                  ? { backgroundColor: '#8b4513', borderColor: '#8b4513', color: '#ffffff' }
                  : { backgroundColor: '#ffffff', borderColor: '#d4b896', color: '#8b4513' }}
              >
                🐴 Registered{registered.size > 0 ? ` (${registered.size})` : ''}
              </button>
            )}
          </div>

          <p className="text-xs" style={{ color: '#8b7355' }}>
            {searching
              ? (shown.length === 0
                ? 'No matches.'
                : `${shown.length} ${shown.length === 1 ? 'class' : 'classes'} across the whole show`)
              : filtering
                ? `${shown.length} ${shown.length === 1 ? 'class' : 'classes'} · ${filterLabel}`
                : dayClasses.length > 0
                  ? `${formatDayLong(activeDay)} · ${dayClasses.length} ${dayClasses.length === 1 ? 'class' : 'classes'}${isLive ? ` · ${dayDone} complete` : ''}`
                  : ''}
          </p>
        </div>
      </div>

      {shown.length === 0 && (
        <p style={{ color: '#8b7355' }}>
          {searching
            ? 'Nothing matches that search.'
            : favoritesOnly && registeredOnly
              ? "None of the classes you're entered in are starred."
              : favoritesOnly
                ? 'No starred classes yet. Tap the ☆ on a class to track it.'
                : registeredOnly
                  ? "You're not entered in any classes at this show yet."
                  : 'No classes are posted for this day yet.'}
        </p>
      )}

      <div className="space-y-5">
        {grouped.map(group => (
          <section key={group.key}>
            {(spanAllDays || showRingHeaders) && (
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#8b4513' }}>
                {spanAllDays ? formatDayLong(group.key) : group.key}
              </h3>
            )}
            <ul className="space-y-2">
              {group.items.map(cls => {
                const live = isLive ? liveStateFor(cls, upNextIds) : null;
                const badge = live ? LIVE_BADGE[live] : null;
                const isOpen = !!expanded[cls.id];
                const isFav = favorites.has(cls.id);
                const entries = programIndex[cls.id] ?? [];
                const hits = matchingEntries(cls.id);
                const meta = [
                  cls.discipline_name,
                  cls.division_name,
                  !showRingHeaders && cls.ring_name ? cls.ring_name : null,
                ].filter(Boolean).join(' · ');

                return (
                  <li
                    key={cls.id}
                    className="rounded-lg border overflow-hidden"
                    style={{ backgroundColor: '#ffffff', borderColor: isFav ? '#8b4513' : '#d4b896' }}
                  >
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(cls.id)}
                        aria-expanded={isOpen}
                        className="flex-1 min-w-0 text-left p-4 transition hover:bg-amber-50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold" style={{ color: '#2c1810' }}>
                              {cls.class_number} — {cls.class_name}
                              {/* Marked on the programme, not just missing from
                                  the entry form. Somebody reading the schedule
                                  beside their entry screen would otherwise see a
                                  class here and no way to enter it, with nothing
                                  on either page saying why. */}
                              {cls.entered_by_qualification && (
                                <span
                                  className="ml-2 align-middle text-xs font-normal px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                                  title="The top two from each qualifying class are called back to this one — there is nothing to enter."
                                >
                                  by qualification
                                </span>
                              )}
                            </div>
                            {meta && (
                              <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>{meta}</div>
                            )}
                            <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
                              {cls.entry_count} {cls.entry_count === 1 ? 'entry' : 'entries'}
                              {cls.placed_count > 0 && ' · results posted'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {badge && (
                              <span className="text-xs font-medium px-2 py-1 rounded-full"
                                style={{ backgroundColor: badge.bg, color: badge.text }}>
                                {badge.label}
                              </span>
                            )}
                            <span aria-hidden="true" className="text-xs" style={{ color: '#8b4513' }}>
                              {isOpen ? '▲' : '▼'}
                            </span>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleFavorite(cls.id)}
                        aria-pressed={isFav}
                        title={isFav ? 'Remove from my classes' : 'Track this class'}
                        className="px-3 shrink-0 text-lg transition hover:bg-amber-50 border-l"
                        style={{ borderColor: '#f0e6d6', color: isFav ? '#8b4513' : '#c4ab8a' }}
                      >
                        <span aria-hidden="true">{isFav ? '★' : '☆'}</span>
                        <span className="sr-only">
                          {isFav ? `Remove class ${cls.class_number} from my classes` : `Track class ${cls.class_number}`}
                        </span>
                      </button>
                    </div>

                    {/* While searching, surface who matched without making the
                        spectator open every class to find their horse. */}
                    {!isOpen && hits.length > 0 && (
                      <ul className="px-4 pb-3 -mt-1 space-y-0.5">
                        {hits.map(e => (
                          <li key={e.id} className="text-xs" style={{ color: '#5a3e2b' }}>
                            {e.back_number != null && (
                              <span className="font-semibold" style={{ color: '#8b4513' }}>#{e.back_number} · </span>
                            )}
                            {e.horse_name || '—'}
                            <span style={{ color: '#8b7355' }}> · {e.exhibitor_name}</span>
                            {e.owner_name && <span style={{ color: '#8b7355' }}> · owner {e.owner_name}</span>}
                          </li>
                        ))}
                      </ul>
                    )}

                    {isOpen && (
                      <div className="px-4 pb-4 border-t pt-3" style={{ borderColor: '#f0e6d6' }}>
                        {entries.length === 0 ? (
                          <p className="text-sm" style={{ color: '#8b7355' }}>No entries yet.</p>
                        ) : (
                          renderEntryTable(entries)
                        )}

                        <Link
                          href={`/shows/${showId}/classes/${cls.id}`}
                          className="inline-block text-sm mt-3 hover:underline"
                          style={{ color: '#8b4513' }}
                        >
                          {cls.placed_count > 0 ? 'View results' : 'View class'} →
                        </Link>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
