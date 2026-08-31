'use client';

import { useMemo, useState } from 'react';
import { outcomeLabel, outcomeShort } from '@/lib/result-outcomes';

/**
 * The posted placings for one class, one column per judge.
 *
 * Client-side because the columns sort. With a panel of judges the useful
 * question is often "read me judge 2's card in order" or "find back number
 * 112", and the default mean-placing order answers neither.
 */

// Standard US horse show placement ribbon colors
const RIBBON_COLORS: Record<number, { main: string; dark: string; text: string }> = {
  1: { main: '#2563eb', dark: '#1e3a8a', text: '#ffffff' },
  2: { main: '#dc2626', dark: '#7f1d1d', text: '#ffffff' },
  3: { main: '#facc15', dark: '#a16207', text: '#1a1a1a' },
  4: { main: '#f1f5f9', dark: '#94a3b8', text: '#1e293b' },
  5: { main: '#f472b6', dark: '#9d174d', text: '#ffffff' },
  6: { main: '#16a34a', dark: '#14532d', text: '#ffffff' },
  7: { main: '#7c3aed', dark: '#3b0764', text: '#ffffff' },
  8: { main: '#b45309', dark: '#451a03', text: '#ffffff' },
};

const DEFAULT_RIBBON = { main: '#6b7280', dark: '#1f2937', text: '#ffffff' };

function placeOrdinal(n: number) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

const RIBBON_CX = 16;
const RIBBON_CY = 16;

/**
 * The scalloped petal ring, computed once.
 *
 * Coordinates are **rounded**, and that is load-bearing rather than tidiness:
 * raw `Math.cos`/`Math.sin` output serializes to a different number of
 * significant digits on the server than in the browser
 * (`27.2583302491977` vs `27.258330249197698`), and this table is a client
 * component, so React compares the two and logs a hydration mismatch for every
 * rosette on the page. Three decimals is well past visible at 32px.
 */
const RIBBON_PETALS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
  return {
    x: Number((RIBBON_CX + 13 * Math.cos(angle)).toFixed(3)),
    y: Number((RIBBON_CY + 13 * Math.sin(angle)).toFixed(3)),
  };
});

/**
 * A placement rosette.
 *
 * Sized to sit inside a judge column: a class judged by a panel shows one of
 * these per judge per row, so the full-page rosette the single-card layout used
 * would push the far judges off screen.
 */
function Ribbon({ place }: { place: number }) {
  const { main, dark, text } = RIBBON_COLORS[place] ?? DEFAULT_RIBBON;
  const cx = RIBBON_CX, cy = RIBBON_CY;
  const petals = RIBBON_PETALS;

  return (
    <svg width="32" height="44" viewBox="0 0 32 44" aria-hidden="true">
      <polygon points={`10,27 6,44 16,38`} fill={dark} />
      <polygon points={`22,27 26,44 16,38`} fill={dark} />
      {petals.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={i % 2 === 0 ? main : dark} />
      ))}
      <circle cx={cx} cy={cy} r={10.5} fill={main} />
      <circle cx={cx} cy={cy} r={7.5} fill={dark} />
      <circle cx={cx} cy={cy} r={6} fill={main} />
      <text
        x={cx} y={cy + 3.5}
        textAnchor="middle"
        fill={text}
        fontSize="9"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        {place}
      </text>
    </svg>
  );
}

export interface CardColumn {
  key: string;
  label: string;
  shortLabel: string;
}

export interface PlacingRow {
  id: string;
  back_number: number | null;
  exhibitorName: string;
  horseName: string;
  /** card key → what that judge's card says about this entry. */
  placings: Record<string, JudgeCell>;
}

/** One judge's answer for one entry. `place` is null on a card that did not
 *  rank the entry — see lib/result-outcomes. */
export interface JudgeCell {
  place: number | null;
  is_tie: boolean;
  outcome?: string;
  outcome_note?: string | null;
}

type SortKey = 'consensus' | 'back' | 'exhibitor' | 'horse' | { judge: string };
type Direction = 'asc' | 'desc';

function sameKey(a: SortKey, b: SortKey): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.judge === b.judge;
}

const INK = '#2c1810';
const MUTED = '#8b7355';

export default function PlacingsTable({
  rows,
  judgeColumns,
}: {
  rows: PlacingRow[];
  judgeColumns: CardColumn[];
}) {
  const [sort, setSort] = useState<SortKey>('consensus');
  const [dir, setDir] = useState<Direction>('asc');

  /** Mean place across the cards that placed this entry. */
  const meanPlace = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      // Only cards that actually placed the entry count towards the mean. A judge
      // who threw it out did not rank it last, and averaging in a missing card
      // as anything at all would invent an opinion nobody gave.
      const places = Object.values(r.placings)
        .map((p) => p.place)
        .filter((p): p is number => p != null);
      out[r.id] = places.length
        ? places.reduce((a, b) => a + b, 0) / places.length
        : Number.POSITIVE_INFINITY;
    }
    return out;
  }, [rows]);

  const sorted = useMemo(() => {
    const flip = dir === 'asc' ? 1 : -1;

    // An entry with no placing in the column being sorted is not "last place",
    // it is unplaced — so it stays at the bottom in both directions rather than
    // jumping to the top when the sort is reversed.
    const rank = (r: PlacingRow): number | null => {
      if (sort === 'consensus') {
        const m = meanPlace[r.id];
        return Number.isFinite(m) ? m : null;
      }
      if (typeof sort === 'object') return r.placings[sort.judge]?.place ?? null;
      return null;
    };

    return [...rows].sort((a, b) => {
      if (sort === 'back') {
        const av = a.back_number, bv = b.back_number;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * flip;
      }
      if (sort === 'exhibitor' || sort === 'horse') {
        const field = sort === 'exhibitor' ? 'exhibitorName' : 'horseName';
        return a[field].localeCompare(b[field]) * flip;
      }

      const ar = rank(a), br = rank(b);
      if (ar == null && br == null) return (a.back_number ?? 9999) - (b.back_number ?? 9999);
      if (ar == null) return 1;
      if (br == null) return -1;
      if (ar !== br) return (ar - br) * flip;
      return (a.back_number ?? 9999) - (b.back_number ?? 9999);
    });
  }, [rows, sort, dir, meanPlace]);

  const toggle = (key: SortKey) => {
    if (sameKey(key, sort)) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key);
      setDir('asc');
    }
  };

  const ariaSort = (key: SortKey) =>
    sameKey(key, sort) ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';

  const arrow = (key: SortKey) =>
    sameKey(key, sort) ? (dir === 'asc' ? ' ▲' : ' ▼') : '';

  const headerButton = (key: SortKey, label: React.ReactNode, extraClass = '') => (
    <button
      type="button"
      onClick={() => toggle(key)}
      className={`w-full text-left font-semibold hover:underline ${extraClass}`}
      style={{ color: '#f5ede0' }}
      title="Sort by this column"
    >
      {label}
      <span aria-hidden="true">{arrow(key)}</span>
    </button>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ backgroundColor: INK, color: '#f5ede0' }}>
            <th className="py-3 px-4 text-left text-sm" aria-sort={ariaSort('back')}>
              {headerButton('back', 'Back #')}
            </th>
            <th className="py-3 px-4 text-left text-sm" aria-sort={ariaSort('exhibitor')}>
              {headerButton('exhibitor', 'Exhibitor')}
            </th>
            <th className="py-3 px-4 text-left text-sm hidden md:table-cell" aria-sort={ariaSort('horse')}>
              {headerButton('horse', 'Horse')}
            </th>
            {judgeColumns.length === 0 ? (
              <th className="py-3 px-4 text-left text-sm font-semibold">Place</th>
            ) : (
              <>
                {judgeColumns.map((col) => (
                  <th
                    key={col.key}
                    className="py-3 px-3 text-center text-sm whitespace-nowrap"
                    style={{ borderLeft: '1px solid #5c3d1e' }}
                    aria-sort={ariaSort({ judge: col.key })}
                  >
                    {headerButton(
                      { judge: col.key },
                      <>
                        {col.shortLabel && (
                          <span className="block text-xs font-normal" style={{ color: '#d4b896' }}>
                            {col.shortLabel}
                          </span>
                        )}
                        {col.label}
                      </>,
                      'text-center',
                    )}
                  </th>
                ))}
                {judgeColumns.length > 1 && (
                  <th
                    className="py-3 px-3 text-center text-sm whitespace-nowrap"
                    style={{ borderLeft: '1px solid #5c3d1e' }}
                    aria-sort={ariaSort('consensus')}
                  >
                    {headerButton(
                      'consensus',
                      <>
                        <span className="block text-xs font-normal" style={{ color: '#d4b896' }}>
                          avg
                        </span>
                        Across cards
                      </>,
                      'text-center',
                    )}
                  </th>
                )}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, i) => (
            <tr
              key={entry.id}
              style={{
                backgroundColor: i % 2 === 0 ? '#ffffff' : '#faf7f2',
                borderTop: '1px solid #d4b896',
              }}
            >
              <td className="py-2 px-4 font-medium" style={{ color: INK }}>
                {entry.back_number ?? '—'}
              </td>
              <td className="py-2 px-4" style={{ color: INK }}>{entry.exhibitorName}</td>
              <td className="py-2 px-4 hidden md:table-cell" style={{ color: MUTED }}>
                {entry.horseName}
              </td>
              {judgeColumns.length === 0 ? (
                <td className="py-2 px-4" style={{ color: MUTED }}>—</td>
              ) : (
                <>
                  {judgeColumns.map((col) => {
                    const result = entry.placings[col.key];
                    return (
                      <td
                        key={col.key}
                        className="py-2 px-3 text-center"
                        style={{ borderLeft: '1px solid #e8ddd0' }}
                      >
                        {result && result.place != null ? (
                          <span className="inline-flex flex-col items-center">
                            <Ribbon place={result.place} />
                            <span className="text-xs font-semibold" style={{ color: '#8b4513' }}>
                              {placeOrdinal(result.place)}
                              {result.is_tie && (
                                <span className="font-normal" style={{ color: MUTED }}> (T)</span>
                              )}
                              {outcomeShort(result.outcome) && (
                                <span className="font-normal" style={{ color: MUTED }}>
                                  {' '}
                                  ({outcomeShort(result.outcome)})
                                </span>
                              )}
                            </span>
                          </span>
                        ) : result ? (
                          // A card that did not place the entry is not a blank
                          // cell — a blank reads as "this judge has not filed",
                          // and this judge filed a decision.
                          <span
                            className="inline-block text-xs font-semibold px-2 py-1 rounded"
                            style={{ backgroundColor: '#f3ede3', color: MUTED }}
                            title={result.outcome_note || outcomeLabel(result.outcome)}
                          >
                            {outcomeShort(result.outcome) || '—'}
                          </span>
                        ) : (
                          <span style={{ color: '#c9bba6' }}>—</span>
                        )}
                      </td>
                    );
                  })}
                  {judgeColumns.length > 1 && (
                    <td
                      className="py-2 px-3 text-center text-sm"
                      style={{ borderLeft: '1px solid #e8ddd0', color: MUTED }}
                    >
                      {Number.isFinite(meanPlace[entry.id])
                        ? meanPlace[entry.id].toFixed(2).replace(/\.00$/, '')
                        : '—'}
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
