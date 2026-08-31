'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import TouchScorePad from './TouchScorePad';
import PublishBar from './PublishBar';
import JudgeTabs from './JudgeTabs';
import { useAutosave } from './useAutosave';
import { buildCards, groupByCard, type ShowJudge } from './judges';
import { RESULT_OUTCOMES, isRanked, type ResultOutcome } from '@/lib/result-outcomes';

type ScoreType = 'pattern' | 'time';

interface Entry {
  id: string;
  back_number: number | null;
  exhibitorName: string;
  horseName: string;
  is_disqualified: boolean;
}

interface Result {
  id: string;
  entry_id: string;
  judge_id: string | null;
  place: number | null;
  raw_score: number | null;
  is_tie: boolean;
  outcome?: string;
  tiebreak_rank?: number | null;
}

interface Class {
  id: string;
  class_number: string;
  class_name: string;
}

interface Props {
  showId: string;
  classId: string;
  scoreType: ScoreType;
  classes: Class[];
  entries: Entry[];
  results: Result[];
  judges: ShowJudge[];
  resultsPublishedAt: string | null;
}

const LABELS = {
  pattern: {
    column: 'Score',
    placeholder: 'e.g. 71.5',
    helper: 'Highest score wins. Leave blank for entries that did not compete.',
    decimals: 2,
  },
  time: {
    column: 'Time (sec)',
    placeholder: 'e.g. 17.842',
    helper: 'Lowest time wins. Leave blank for entries that did not compete.',
    decimals: 3,
  },
} as const;

/**
 * One row of the sheet: what the judge called, and what it means.
 *
 * `outcome` was a fifth state the app could not hold before migration 121 — a
 * disqualification, an elimination, a declared zero or a no score all had to be
 * typed as a blank, which is indistinguishable from a horse the scribe has not
 * reached yet. `tiebreak` is how the judge separated two equal scores, kept out
 * of `score` so recording the decision never edits the number they called.
 */
interface Cell {
  score: string;
  outcome: ResultOutcome;
  tiebreak: string;
}

const EMPTY_CELL: Cell = { score: '', outcome: 'placed', tiebreak: '' };

/** Whether the scribe has said anything about this entry yet. */
function isAnswered(cell: Cell | undefined): boolean {
  if (!cell) return false;
  if (cell.outcome !== 'placed') return true;
  return !Number.isNaN(parseFloat(cell.score));
}

/** The number this row ranks on. A declared zero is a zero whatever is typed. */
function rankValue(cell: Cell): number {
  if (cell.outcome === 'zero_score') return 0;
  return parseFloat(cell.score);
}

/**
 * Live-derive placings, mirroring `rank_card` in routers/results.py.
 *
 * Only rows in the running are ranked — a disqualified horse is not last, it is
 * off the card. Equal scores share a place unless the judge's tiebreak order
 * separates them, which is the whole point of keeping that number apart from
 * the score.
 */
function derivePlaces(
  scoreType: ScoreType,
  cells: Record<string, Cell>,
): { places: Record<string, number>; tied: Set<number> } {
  const filled = Object.entries(cells)
    .filter(([, cell]) => isRanked(cell.outcome))
    .map(([id, cell]) => ({
      id,
      value: rankValue(cell),
      tiebreak: cell.tiebreak === '' ? null : parseInt(cell.tiebreak, 10),
    }))
    .filter((e) => !Number.isNaN(e.value));

  filled.sort((a, b) => {
    const primary = scoreType === 'pattern' ? b.value - a.value : a.value - b.value;
    if (primary !== 0) return primary;
    // A row the judge ranked comes before one they did not speak to.
    return (a.tiebreak ?? Infinity) - (b.tiebreak ?? Infinity);
  });

  const places: Record<string, number> = {};
  const tally: Record<number, number> = {};
  let lastKey: string | null = null;
  let lastPlace = 0;
  filled.forEach((entry, idx) => {
    const key = `${entry.value}|${entry.tiebreak ?? ''}`;
    if (lastKey !== null && key === lastKey) {
      places[entry.id] = lastPlace;
    } else {
      places[entry.id] = idx + 1;
      lastPlace = idx + 1;
      lastKey = key;
    }
    tally[places[entry.id]] = (tally[places[entry.id]] ?? 0) + 1;
  });
  const tied = new Set(
    Object.entries(tally)
      .filter(([, count]) => count > 1)
      .map(([p]) => parseInt(p, 10)),
  );
  return { places, tied };
}

export default function ScoredScribeForm({
  showId,
  classId,
  scoreType,
  classes,
  entries,
  results,
  judges,
  resultsPublishedAt,
}: Props) {
  const labels = LABELS[scoreType];
  // Offer the unassigned card only when something is actually filed against it,
  // so a normal panel show shows exactly its judges.
  const cards = useMemo(
    () => buildCards(judges, results.some((r) => r.judge_id == null)),
    [judges, results]
  );

  const activeEntries = useMemo(
    () =>
      entries
        .filter((e) => !e.is_disqualified)
        .sort((a, b) => (a.back_number ?? 9999) - (b.back_number ?? 9999)),
    [entries],
  );
  const dqEntries = useMemo(
    () => entries.filter((e) => e.is_disqualified),
    [entries],
  );

  // One sheet of scores per judge. Each judge marks the same run independently,
  // so these are separate numbers rather than one number to agree on.
  const [byCard, setByCard] = useState<Record<string, Record<string, Cell>>>(() => {
    const grouped = groupByCard(results);
    return Object.fromEntries(
      cards.map((card) => {
        const existing = Object.fromEntries(
          (grouped[card.key] ?? []).map((r) => [r.entry_id, r]),
        );
        return [
          card.key,
          Object.fromEntries(
            entries.map((e) => {
              const filed = existing[e.id];
              return [
                e.id,
                {
                  score: filed?.raw_score != null ? String(filed.raw_score) : '',
                  outcome: (filed?.outcome ?? 'placed') as ResultOutcome,
                  tiebreak:
                    filed?.tiebreak_rank != null ? String(filed.tiebreak_rank) : '',
                },
              ];
            }),
          ),
        ];
      }),
    );
  });
  const [activeKey, setActiveKey] = useState(cards[0].key);
  const [publishedAt, setPublishedAt] = useState<string | null>(resultsPublishedAt);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const activeCard = cards.find((c) => c.key === activeKey) ?? cards[0];
  // Memoised: see ScribeForm — a fresh `{}` each render would invalidate every
  // downstream memo on every keystroke.
  const cells = useMemo(() => byCard[activeKey] ?? {}, [byCard, activeKey]);

  const classIndex = classes.findIndex((c) => c.id === classId);
  const prevClass = classIndex > 0 ? classes[classIndex - 1] : null;
  const nextClass =
    classIndex < classes.length - 1 ? classes[classIndex + 1] : null;

  const { places, tied } = useMemo(
    () => derivePlaces(scoreType, cells),
    [scoreType, cells],
  );

  const placedCount = useMemo(
    () => activeEntries.filter((e) => isAnswered(cells[e.id])).length,
    [activeEntries, cells],
  );

  /** Rows answered on each card, for the tab strip. A disqualification is an
   *  answer — the card is finished when every row has one, not when every row
   *  carries a number. */
  const filledByCard = useMemo(
    () =>
      Object.fromEntries(
        cards.map((card) => [
          card.key,
          activeEntries.filter((e) => isAnswered(byCard[card.key]?.[e.id])).length,
        ]),
      ),
    [cards, byCard, activeEntries],
  );

  const buildItems = useCallback(
    (card: Record<string, Cell>) => {
      const derived = derivePlaces(scoreType, card);
      return activeEntries
        .map((entry) => {
          const cell = card[entry.id] ?? EMPTY_CELL;
          const raw = parseFloat(cell.score);
          const hasScore = !Number.isNaN(raw);
          // A placed row with nothing typed is a horse the scribe has not
          // reached yet, not a result. Every other outcome is an answer in its
          // own right and files with or without a number.
          if (cell.outcome === 'placed' && !hasScore) return null;
          const ranked = isRanked(cell.outcome);
          const place = derived.places[entry.id];
          return {
            entry_id: entry.id,
            // place is recomputed by the backend for pattern/time classes; a
            // ranked row still needs a positive integer to insert with.
            place: ranked ? place ?? 1 : null,
            raw_score: hasScore ? raw : cell.outcome === 'zero_score' ? 0 : null,
            is_tie: ranked && place !== undefined ? derived.tied.has(place) : false,
            outcome: cell.outcome,
            tiebreak_rank: cell.tiebreak === '' ? null : parseInt(cell.tiebreak, 10),
          };
        })
        .filter(Boolean);
    },
    [activeEntries, scoreType],
  );

  // Carries the judge alongside the scores; `save` reads it back off the
  // snapshot so the sheet that was debounced is the sheet that gets committed.
  const payload = useMemo(
    () => JSON.stringify({ judgeId: activeCard.judgeId, results: buildItems(cells) }),
    [activeCard.judgeId, buildItems, cells],
  );

  const save = useCallback(async (snapshot: string) => {
    const res = await fetch('/api/results', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId, ...JSON.parse(snapshot) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail ?? 'Failed to save');
    }
  }, [showId, classId]);

  const { status, lastSavedAt, error, flush } = useAutosave({
    payload,
    save,
    baselineKey: activeKey,
  });

  const setCell = (entryId: string, patch: Partial<Cell>) => {
    setByCard((prev) => ({
      ...prev,
      [activeKey]: {
        ...prev[activeKey],
        [entryId]: { ...(prev[activeKey]?.[entryId] ?? EMPTY_CELL), ...patch },
      },
    }));
  };

  const setScore = (entryId: string, value: string) => setCell(entryId, { score: value });

  /** Commit the open sheet before showing another — see ScribeForm.selectCard. */
  const selectCard = async (key: string) => {
    if (key === activeKey) return;
    await flush();
    setSelectedIndex(null);
    setActiveKey(key);
  };

  const handleClearAll = () => {
    setByCard((prev) => ({
      ...prev,
      [activeKey]: Object.fromEntries(entries.map((e) => [e.id, { ...EMPTY_CELL }])),
    }));
    setSelectedIndex(null);
  };

  const selectedEntry = selectedIndex !== null ? activeEntries[selectedIndex] : null;

  // The pad is docked over the bottom of the page, so the row being scored can
  // end up behind it — especially when "Next horse" walks down the list.
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  useEffect(() => {
    if (selectedIndex === null) return;
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedIndex]);

  return (
    <div className={selectedEntry ? 'pb-72' : undefined}>
      {classes.length > 1 && (
        <div className="flex items-center justify-between mb-5 text-sm">
          {prevClass ? (
            <Link
              href={`/shows/${showId}/classes/${prevClass.id}/scribe`}
              className="font-medium hover:underline min-h-[44px] flex items-center"
              style={{ color: '#8b4513' }}
            >
              ← {prevClass.class_number}
            </Link>
          ) : (
            <span />
          )}
          <span style={{ color: '#8b7355' }}>
            Class {classIndex + 1} of {classes.length}
          </span>
          {nextClass ? (
            <Link
              href={`/shows/${showId}/classes/${nextClass.id}/scribe`}
              className="font-medium hover:underline min-h-[44px] flex items-center"
              style={{ color: '#8b4513' }}
            >
              {nextClass.class_number} →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}

      <PublishBar
        showId={showId}
        classId={classId}
        status={status}
        lastSavedAt={lastSavedAt}
        error={error}
        onRetry={() => void flush()}
        publishedAt={publishedAt}
        onPublished={setPublishedAt}
        empty={Object.values(filledByCard).every((n) => n === 0)}
        flush={flush}
      />

      <JudgeTabs
        cards={cards}
        activeKey={activeKey}
        onSelect={(key) => void selectCard(key)}
        filledByCard={filledByCard}
        total={activeEntries.length}
      />

      <p className="text-sm mb-3" style={{ color: '#8b7355' }}>
        {labels.helper}
      </p>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm" style={{ color: '#8b7355' }}>
          {placedCount} of {activeEntries.length} recorded
          {dqEntries.length > 0 && ` · ${dqEntries.length} DQ`}
        </span>
        {confirmClear ? (
          <span className="flex items-center gap-2">
            <span className="text-xs" style={{ color: '#5c3d1e' }}>
              Clear {cards.length > 1 ? `${activeCard.label}'s` : 'all'} scores?
            </span>
            <button
              type="button"
              onClick={() => {
                setConfirmClear(false);
                handleClearAll();
              }}
              className="text-xs text-red-600 hover:underline"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="text-xs hover:underline"
              style={{ color: '#8b7355' }}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="text-xs hover:underline"
            style={{ color: '#8b7355' }}
          >
            Clear all
          </button>
        )}
      </div>

      <table className="w-full border-collapse mb-4">
        <thead>
          <tr className="text-left" style={{ borderBottom: '2px solid #d4b896' }}>
            <th className="py-2 pr-4 text-sm font-semibold" style={{ color: '#2c1810' }}>
              Back #
            </th>
            <th className="py-2 pr-4 text-sm font-semibold" style={{ color: '#2c1810' }}>
              Exhibitor
            </th>
            <th
              className="py-2 pr-4 text-sm font-semibold hidden md:table-cell"
              style={{ color: '#2c1810' }}
            >
              Horse
            </th>
            <th className="py-2 pr-4 text-sm font-semibold" style={{ color: '#2c1810' }}>
              {labels.column}
            </th>
            <th className="py-2 pr-4 text-sm font-semibold" style={{ color: '#2c1810' }}>
              Result
            </th>
            <th className="py-2 text-sm font-semibold" style={{ color: '#2c1810' }}>
              Place
            </th>
          </tr>
        </thead>
        <tbody>
          {activeEntries.map((entry, i) => {
            const cell = cells[entry.id] ?? EMPTY_CELL;
            const place = places[entry.id];
            const isTied = place !== undefined && tied.has(place);
            const isSelected = selectedIndex === i;
            const ranked = isRanked(cell.outcome);
            return (
              <tr
                key={entry.id}
                ref={(el) => { rowRefs.current[i] = el; }}
                onClick={() => setSelectedIndex(i)}
                style={{
                  borderBottom: '1px solid #e8ddd0',
                  backgroundColor: isSelected
                    ? '#f5ede0'
                    : isTied
                      ? '#fffbeb'
                      : undefined,
                  cursor: 'pointer',
                  outline: isSelected ? '2px solid #8b4513' : undefined,
                }}
              >
                <td className="py-4 pr-4 font-medium text-base" style={{ color: '#2c1810' }}>
                  {entry.back_number ?? '—'}
                </td>
                <td className="py-4 pr-4 text-base" style={{ color: '#2c1810' }}>
                  {entry.exhibitorName}
                </td>
                <td className="py-4 pr-4 hidden md:table-cell" style={{ color: '#8b7355' }}>
                  {entry.horseName}
                </td>
                <td className="py-4 pr-4">
                  <input
                    type="number"
                    step={scoreType === 'time' ? '0.001' : '0.01'}
                    // Suppress the OS keyboard — the docked pad drives entry.
                    inputMode="none"
                    value={cell.score}
                    onFocus={() => setSelectedIndex(i)}
                    onChange={(e) => setScore(entry.id, e.target.value)}
                    disabled={cell.outcome !== 'placed'}
                    title={
                      cell.outcome !== 'placed'
                        ? 'This entry was not scored — clear the result to enter a number.'
                        : undefined
                    }
                    className="w-28 min-h-[44px] border rounded-lg px-2 text-center text-lg disabled:opacity-40"
                    style={{
                      borderColor: isSelected ? '#8b4513' : '#d4b896',
                      backgroundColor: '#fffdf9',
                    }}
                    placeholder={labels.placeholder}
                  />
                </td>
                <td className="py-4 pr-4">
                  {/* What happened, where a blank score cannot say. Before
                      migration 121 a disqualification and a horse the scribe
                      had not reached yet looked identical on this sheet. */}
                  <select
                    value={cell.outcome}
                    onChange={(e) => {
                      const outcome = e.target.value as ResultOutcome;
                      setCell(entry.id, {
                        outcome,
                        // A tiebreak only means something on a ranked row.
                        ...(isRanked(outcome) ? {} : { tiebreak: '' }),
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="min-h-[44px] border rounded-lg px-2 text-sm"
                    style={{
                      borderColor: cell.outcome === 'placed' ? '#d4b896' : '#fca5a5',
                      backgroundColor: cell.outcome === 'placed' ? '#fffdf9' : '#fef2f2',
                      color: '#2c1810',
                    }}
                  >
                    {RESULT_OUTCOMES.map((o) => (
                      <option key={o.value} value={o.value} title={o.help}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-4">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-medium text-base"
                      style={{
                        color: place === undefined ? '#bbb' : '#2c1810',
                      }}
                    >
                      {place ?? '—'}
                    </span>
                    {isTied && (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: '#fef3c7',
                          color: '#92400e',
                          border: '1px solid #fcd34d',
                        }}
                      >
                        TIE
                      </span>
                    )}
                    {/* The judge's answer to a tie, kept apart from the score so
                        recording it never edits the number they called. Shown
                        once there is a tie to break, and while one is on file. */}
                    {ranked && (isTied || cell.tiebreak !== '') && (
                      <input
                        type="number"
                        min={1}
                        value={cell.tiebreak}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setCell(entry.id, { tiebreak: e.target.value })}
                        className="w-16 min-h-[44px] border rounded-lg px-2 text-center text-sm"
                        style={{ borderColor: '#fcd34d', backgroundColor: '#fffdf9' }}
                        placeholder="1st?"
                        title="Order the judge called between the tied entries — 1 is the higher of them. Neither score changes."
                      />
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {dqEntries.map((entry) => (
            <tr
              key={entry.id}
              style={{
                borderBottom: '1px solid #e8ddd0',
                backgroundColor: '#f9f9f9',
              }}
            >
              <td className="py-4 pr-4 text-sm" style={{ color: '#bbb' }}>
                {entry.back_number ?? '—'}
              </td>
              <td className="py-4 pr-4 text-sm" style={{ color: '#bbb' }}>
                {entry.exhibitorName}
              </td>
              <td className="py-4 pr-4 text-sm hidden md:table-cell" style={{ color: '#bbb' }}>
                {entry.horseName}
              </td>
              <td className="py-4 pr-4" style={{ color: '#bbb' }}>
                —
              </td>
              <td className="py-4 pr-4" style={{ color: '#bbb' }}>
                —
              </td>
              <td className="py-4">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                    border: '1px solid #fca5a5',
                  }}
                >
                  DQ
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <TouchScorePad
        mode={scoreType}
        subject={
          selectedEntry
            ? `${selectedEntry.back_number ?? '—'} · ${selectedEntry.exhibitorName}`
            : null
        }
        value={selectedEntry ? cells[selectedEntry.id]?.score ?? '' : ''}
        onChange={(next) => selectedEntry && setScore(selectedEntry.id, next)}
        onNext={() =>
          setSelectedIndex((i) =>
            i !== null && i < activeEntries.length - 1 ? i + 1 : null,
          )
        }
        onClose={() => setSelectedIndex(null)}
      />
    </div>
  );
}
