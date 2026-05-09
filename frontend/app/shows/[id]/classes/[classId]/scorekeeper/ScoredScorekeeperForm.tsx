'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

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
  place: number;
  raw_score: number | null;
  is_tie: boolean;
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

/** Live-derive placings from entered raw scores. Returns a map of entry_id → place.
 *  Equal scores share a place; entries without a score get no place. */
function derivePlaces(
  scoreType: ScoreType,
  scores: Record<string, string>,
): { places: Record<string, number>; tied: Set<number> } {
  const filled = Object.entries(scores)
    .map(([id, raw]) => ({ id, value: parseFloat(raw) }))
    .filter((e) => !Number.isNaN(e.value));

  filled.sort((a, b) =>
    scoreType === 'pattern' ? b.value - a.value : a.value - b.value,
  );

  const places: Record<string, number> = {};
  const tally: Record<number, number> = {};
  let lastValue: number | null = null;
  let lastPlace = 0;
  filled.forEach((entry, idx) => {
    if (lastValue !== null && entry.value === lastValue) {
      places[entry.id] = lastPlace;
    } else {
      places[entry.id] = idx + 1;
      lastPlace = idx + 1;
      lastValue = entry.value;
    }
    tally[places[entry.id]] = (tally[places[entry.id]] ?? 0) + 1;
  });
  const tied = new Set(
    Object.entries(tally)
      .filter(([, n]) => n > 1)
      .map(([p]) => parseInt(p, 10)),
  );
  return { places, tied };
}

export default function ScoredScorekeeperForm({
  showId,
  classId,
  scoreType,
  classes,
  entries,
  results,
}: Props) {
  const labels = LABELS[scoreType];
  const existingByEntryId = useMemo(
    () => Object.fromEntries(results.map((r) => [r.entry_id, r])),
    [results],
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

  const [scores, setScores] = useState<Record<string, string>>(
    Object.fromEntries(
      entries.map((e) => [
        e.id,
        existingByEntryId[e.id]?.raw_score != null
          ? String(existingByEntryId[e.id].raw_score)
          : '',
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] =
    useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const classIndex = classes.findIndex((c) => c.id === classId);
  const prevClass = classIndex > 0 ? classes[classIndex - 1] : null;
  const nextClass =
    classIndex < classes.length - 1 ? classes[classIndex + 1] : null;

  const { places, tied } = useMemo(
    () => derivePlaces(scoreType, scores),
    [scoreType, scores],
  );

  const placedCount = useMemo(
    () => activeEntries.filter((e) => places[e.id] !== undefined).length,
    [activeEntries, places],
  );

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const firstEmpty = activeEntries.findIndex((e) => !scores[e.id]);
    if (firstEmpty >= 0) inputRefs.current[firstEmpty]?.focus();
    else inputRefs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setSaved(false);
    try {
      const items = activeEntries
        .map((entry) => {
          const raw = parseFloat(scores[entry.id]);
          if (Number.isNaN(raw)) return null;
          return {
            entry_id: entry.id,
            // place is recomputed by the backend for pattern/time classes,
            // but the API requires a positive integer — send a placeholder.
            place: places[entry.id] ?? 1,
            raw_score: raw,
            is_tie: tied.has(places[entry.id]),
          };
        })
        .filter(Boolean);

      const res = await fetch('/api/results', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId, classId, results: items }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? 'Failed to save');
      }
      setSaved(true);
      setMessage({ type: 'success', text: 'Scores saved.' });
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err.message ?? 'Something went wrong. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClearAll = () => {
    setScores(Object.fromEntries(entries.map((e) => [e.id, ''])));
    setMessage(null);
    setSaved(false);
  };

  return (
    <div>
      {classes.length > 1 && (
        <div className="flex items-center justify-between mb-5 text-sm">
          {prevClass ? (
            <Link
              href={`/shows/${showId}/classes/${prevClass.id}/scorekeeper`}
              className="font-medium hover:underline"
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
              href={`/shows/${showId}/classes/${nextClass.id}/scorekeeper`}
              className="font-medium hover:underline"
              style={{ color: '#8b4513' }}
            >
              {nextClass.class_number} →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}

      <p className="text-sm mb-3" style={{ color: '#8b7355' }}>
        {labels.helper}
      </p>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm" style={{ color: '#8b7355' }}>
          {placedCount} of {activeEntries.length} scored
          {dqEntries.length > 0 && ` · ${dqEntries.length} DQ`}
        </span>
        {confirmClear ? (
          <span className="flex items-center gap-2">
            <span className="text-xs" style={{ color: '#5c3d1e' }}>
              Clear all scores?
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
          <tr
            className="text-left"
            style={{ borderBottom: '2px solid #d4b896' }}
          >
            <th
              className="py-2 pr-4 text-sm font-semibold"
              style={{ color: '#2c1810' }}
            >
              Back #
            </th>
            <th
              className="py-2 pr-4 text-sm font-semibold"
              style={{ color: '#2c1810' }}
            >
              Exhibitor
            </th>
            <th
              className="py-2 pr-4 text-sm font-semibold hidden md:table-cell"
              style={{ color: '#2c1810' }}
            >
              Horse
            </th>
            <th
              className="py-2 pr-4 text-sm font-semibold"
              style={{ color: '#2c1810' }}
            >
              {labels.column}
            </th>
            <th
              className="py-2 text-sm font-semibold"
              style={{ color: '#2c1810' }}
            >
              Place
            </th>
          </tr>
        </thead>
        <tbody>
          {activeEntries.map((entry, i) => {
            const place = places[entry.id];
            const isTied = place !== undefined && tied.has(place);
            return (
              <tr
                key={entry.id}
                style={{
                  borderBottom: '1px solid #e8ddd0',
                  backgroundColor: isTied ? '#fffbeb' : undefined,
                }}
              >
                <td
                  className="py-3 pr-4 font-medium"
                  style={{ color: '#2c1810' }}
                >
                  {entry.back_number ?? '—'}
                </td>
                <td className="py-3 pr-4" style={{ color: '#2c1810' }}>
                  {entry.exhibitorName}
                </td>
                <td
                  className="py-3 pr-4 hidden md:table-cell"
                  style={{ color: '#8b7355' }}
                >
                  {entry.horseName}
                </td>
                <td className="py-3 pr-4">
                  <input
                    ref={(el) => {
                      inputRefs.current[i] = el;
                    }}
                    type="number"
                    step={scoreType === 'time' ? '0.001' : '0.01'}
                    inputMode="decimal"
                    value={scores[entry.id] ?? ''}
                    onChange={(e) => {
                      setScores((prev) => ({
                        ...prev,
                        [entry.id]: e.target.value,
                      }));
                      setSaved(false);
                    }}
                    onKeyDown={(e) => handleKeyDown(e, i)}
                    disabled={saving}
                    className="w-24 border rounded px-2 py-1 text-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ borderColor: '#d4b896' }}
                    placeholder={labels.placeholder}
                  />
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="font-medium text-sm"
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
              <td className="py-3 pr-4 text-sm" style={{ color: '#bbb' }}>
                {entry.back_number ?? '—'}
              </td>
              <td className="py-3 pr-4 text-sm" style={{ color: '#bbb' }}>
                {entry.exhibitorName}
              </td>
              <td
                className="py-3 pr-4 text-sm hidden md:table-cell"
                style={{ color: '#bbb' }}
              >
                {entry.horseName}
              </td>
              <td className="py-3 pr-4" style={{ color: '#bbb' }}>
                —
              </td>
              <td className="py-3">
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

      {message && (
        <div
          className="mb-4 p-3 rounded text-sm flex items-center justify-between gap-4"
          style={{
            backgroundColor: message.type === 'success' ? '#d1fae5' : '#fee2e2',
            color: message.type === 'success' ? '#065f46' : '#991b1b',
          }}
        >
          <span>{message.text}</span>
          {saved && (
            <div className="flex items-center gap-4 shrink-0 font-medium">
              <Link
                href={`/shows/${showId}/classes/${classId}`}
                className="hover:underline"
              >
                View Results
              </Link>
              {nextClass && (
                <Link
                  href={`/shows/${showId}/classes/${nextClass.id}/scorekeeper`}
                  className="hover:underline"
                >
                  Next Class →
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2 rounded font-medium text-sm transition-opacity"
        style={{
          backgroundColor: '#2c1810',
          color: '#f5ede0',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Save Scores'}
      </button>
    </div>
  );
}
