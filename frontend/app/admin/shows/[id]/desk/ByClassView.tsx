'use client';

import { useMemo, useState } from 'react';
import AddEntryForm from './AddEntryForm';
import { COLORS, formatShowDate } from './types';
import type { Desk, DeskEntry } from './types';

/**
 * The program listing: who is entered, class by class, grouped by show day.
 *
 * The desk's other view is per-exhibitor because that is the shape of the
 * conversation at the counter. This one is the shape of the printed program and
 * of the question "how many are in class 14?", and both are worth having — but
 * from the one payload the desk already loaded, not from a request per class.
 *
 * Filling a class is a real job in its own right — a secretary working down a
 * short class calling for more riders is thinking about the class, not about
 * each person's whole account — so an expanded class carries the same entry
 * form the exhibitor panel does, with the class pinned instead of the rider.
 */

type Row = DeskEntry & { exhibitor_id: string; exhibitor_name: string; back_number: number | null };

function haystack(row: Row): string {
  return [
    row.horse_name ?? '',
    row.barn_name ?? '',
    row.exhibitor_name,
    row.back_number != null ? `#${row.back_number} ${row.back_number}` : '',
    row.apha_division ?? '',
    row.owner_name ?? '',
    row.sire_name ?? '',
    row.dam_name ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export default function ByClassView({
  showId,
  desk,
  onChanged,
  onPickExhibitor,
}: {
  showId: string;
  desk: Desk;
  /** Re-reads the desk after an entry is added here. */
  onChanged: () => Promise<void>;
  /** Clicking a name jumps back to that person's desk panel — the by-class view
   *  is where you notice something is wrong, and fixing it happens over there. */
  onPickExhibitor: (exhibitorId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // One open form at a time: with Expand all on a 21-class show, a form per
  // class turns the program listing into a wall of dropdowns.
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const rowsByClass = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const ex of desk.exhibitors) {
      for (const entry of ex.entries) {
        const rows = map.get(entry.class_id) ?? [];
        rows.push({
          ...entry,
          exhibitor_id: ex.exhibitor_id,
          exhibitor_name: ex.exhibitor_name,
          back_number: ex.back_number,
        });
        map.set(entry.class_id, rows);
      }
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => {
        if (a.back_number == null && b.back_number == null) {
          return a.exhibitor_name.localeCompare(b.exhibitor_name);
        }
        if (a.back_number == null) return 1;
        if (b.back_number == null) return -1;
        return a.back_number - b.back_number;
      });
    }
    return map;
  }, [desk.exhibitors]);

  const normalized = query.trim().toLowerCase();
  const filtering = normalized.length > 0;

  const visible = useMemo(() => {
    return desk.classes
      .map((cls) => {
        const all = rowsByClass.get(cls.id) ?? [];
        if (!filtering) return { cls, rows: all, all };
        const classMatches = `${cls.class_number} ${cls.class_name}`.toLowerCase().includes(normalized);
        if (classMatches) return { cls, rows: all, all };
        return { cls, rows: all.filter((r) => haystack(r).includes(normalized)), all };
      })
      .filter((g) => !filtering || g.rows.length > 0);
  }, [desk.classes, rowsByClass, filtering, normalized]);

  const byDate = useMemo(() => {
    const out: { date: string; items: typeof visible }[] = [];
    for (const group of visible) {
      const last = out[out.length - 1];
      if (last && last.date === group.cls.class_date) last.items.push(group);
      else out.push({ date: group.cls.class_date, items: [group] });
    }
    return out;
  }, [visible]);

  const toggle = (classId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });

  if (desk.classes.length === 0) {
    return <p style={{ color: COLORS.muted }}>No classes yet. Build the class schedule first.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by horse, exhibitor, back #, or class…"
          className="flex-1 min-w-[220px] border rounded px-3 py-2 text-sm"
          style={{ borderColor: COLORS.border }}
        />
        {!filtering && (
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setExpanded(new Set(desk.classes.map((c) => c.id)))}
              className="px-2 py-1 rounded border hover:bg-amber-50"
              style={{ borderColor: COLORS.border, color: '#5a3e2b' }}
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setExpanded(new Set())}
              className="px-2 py-1 rounded border hover:bg-amber-50"
              style={{ borderColor: COLORS.border, color: '#5a3e2b' }}
            >
              Collapse all
            </button>
          </div>
        )}
      </div>

      {filtering && visible.length === 0 && (
        <p className="text-sm" style={{ color: COLORS.muted }}>Nothing matches that search.</p>
      )}

      <div className="space-y-5">
        {byDate.map(({ date, items }) => (
          <div key={date} className="space-y-2">
            <div className="flex items-baseline gap-2 pb-1 border-b" style={{ borderColor: COLORS.border }}>
              <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: COLORS.accent }}>
                {formatShowDate(date)}
              </h3>
              <span className="text-xs" style={{ color: COLORS.muted }}>
                {items.length} class{items.length === 1 ? '' : 'es'}
              </span>
            </div>

            {items.map(({ cls, rows, all }) => {
              const isOpen = filtering || expanded.has(cls.id);
              const countByExhibitor = rows.reduce<Record<string, number>>((acc, r) => {
                acc[r.exhibitor_id] = (acc[r.exhibitor_id] ?? 0) + 1;
                return acc;
              }, {});
              const countLabel =
                filtering && rows.length !== all.length ? `${rows.length} of ${all.length}` : String(all.length);

              return (
                <div key={cls.id} className="rounded-lg border" style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface }}>
                  <button
                    type="button"
                    onClick={() => !filtering && toggle(cls.id)}
                    disabled={filtering}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-50 transition-colors disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <div className="flex items-center gap-2 font-semibold" style={{ color: COLORS.text }}>
                      <span className="inline-block w-4 text-center text-sm" style={{ color: COLORS.accent }} aria-hidden>
                        {isOpen ? '▾' : '▸'}
                      </span>
                      <span>{cls.class_number} — {cls.class_name}</span>
                      <span className="text-sm font-normal" style={{ color: COLORS.muted }}>({countLabel})</span>
                      {cls.status === 'CLOSED' && (
                        <span className="text-xs font-normal px-1.5 py-0.5 rounded" style={{ backgroundColor: '#e5e7eb', color: '#374151' }}>
                          closed
                        </span>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-3 space-y-3">
                      {rows.length === 0 ? (
                        <p className="text-sm" style={{ color: COLORS.muted }}>No entries yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="text-xs uppercase tracking-wide" style={{ color: COLORS.accent }}>
                                <th className="text-left font-semibold pb-1 pr-3 whitespace-nowrap">Back #</th>
                                <th className="text-left font-semibold pb-1 pr-3">Exhibitor</th>
                                <th className="text-left font-semibold pb-1 pr-3">Horse</th>
                                <th className="text-left font-semibold pb-1 pr-3">Owner</th>
                                <th className="text-left font-semibold pb-1 pr-3">Sire</th>
                                <th className="text-left font-semibold pb-1 pr-3">Dam</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                <tr key={row.entry_id} className="border-t align-top" style={{ borderColor: COLORS.borderSoft }}>
                                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap" style={{ color: COLORS.accent }}>
                                    {row.back_number != null ? `#${row.back_number}` : '—'}
                                    {row.is_disqualified && (
                                      <span className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                        DQ
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <button
                                      type="button"
                                      onClick={() => onPickExhibitor(row.exhibitor_id)}
                                      className="hover:underline text-left"
                                      style={{ color: COLORS.text }}
                                      title={`Open ${row.exhibitor_name} at the desk`}
                                    >
                                      {row.exhibitor_name}
                                    </button>
                                    {row.apha_division && (
                                      <span
                                        className="ml-2 text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
                                        style={{ backgroundColor: '#e8d5b7', color: '#5c3d1e' }}
                                      >
                                        {row.apha_division.replace(/_/g, ' ')}
                                      </span>
                                    )}
                                    {(countByExhibitor[row.exhibitor_id] ?? 1) > 1 && (
                                      <span
                                        className="ml-2 text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap"
                                        title={`This exhibitor has ${countByExhibitor[row.exhibitor_id]} entries in this class`}
                                      >
                                        ⚠ {countByExhibitor[row.exhibitor_id]} horses
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1.5 pr-3" style={{ color: COLORS.text }}>
                                    {row.horse_name ?? '(horse removed)'}
                                  </td>
                                  <td className="py-1.5 pr-3" style={{ color: '#5a3e2b' }}>{row.owner_name || '—'}</td>
                                  <td className="py-1.5 pr-3" style={{ color: COLORS.muted }}>{row.sire_name || '—'}</td>
                                  <td className="py-1.5 pr-3" style={{ color: COLORS.muted }}>{row.dam_name || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {cls.status === 'CLOSED' ? (
                        <p className="text-sm" style={{ color: COLORS.muted }}>
                          This class is closed and is not accepting entries. Reopen it on the class
                          list to add anyone.
                        </p>
                      ) : addingTo === cls.id ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: COLORS.accent }}>
                              Add to {cls.class_number} — {cls.class_name}
                            </p>
                            <button
                              type="button"
                              onClick={() => setAddingTo(null)}
                              className="text-xs hover:underline"
                              style={{ color: COLORS.muted }}
                            >
                              Done
                            </button>
                          </div>
                          {/* Stays open after a save so a queue of riders can be
                              entered one after another without reopening it. */}
                          <AddEntryForm showId={showId} desk={desk} cls={cls} onAdded={onChanged} />
                          <p className="text-xs" style={{ color: COLORS.muted }}>
                            Only people already on this show&rsquo;s roster are offered. Add a newcomer
                            from the <strong>By exhibitor</strong> tab first.
                          </p>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAddingTo(cls.id)}
                          className="text-sm hover:underline"
                          style={{ color: COLORS.accent }}
                        >
                          + Add an exhibitor to this class
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
