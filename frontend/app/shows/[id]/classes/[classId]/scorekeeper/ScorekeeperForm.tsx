'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';

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
  is_tie: boolean;
  notes: string;
}

interface Class {
  id: string;
  class_number: string;
  class_name: string;
}

interface Props {
  showId: string;
  classId: string;
  classes: Class[];
  entries: Entry[];
  results: Result[];
}

export default function ScorekeeperForm({ showId, classId, classes, entries, results }: Props) {
  const existingByEntryId = Object.fromEntries(results.map((r) => [r.entry_id, r]));

  const activeEntries = useMemo(() =>
    entries
      .filter((e) => !e.is_disqualified)
      .sort((a, b) => (a.back_number ?? 9999) - (b.back_number ?? 9999)),
    [entries]
  );
  const dqEntries = useMemo(() => entries.filter((e) => e.is_disqualified), [entries]);

  const [places, setPlaces] = useState<Record<string, string>>(
    Object.fromEntries(
      entries.map((e) => [e.id, existingByEntryId[e.id]?.place?.toString() ?? ''])
    )
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const classIndex = classes.findIndex((c) => c.id === classId);
  const prevClass = classIndex > 0 ? classes[classIndex - 1] : null;
  const nextClass = classIndex < classes.length - 1 ? classes[classIndex + 1] : null;

  // Count how many entries share each place — any place with 2+ is a tie
  const placeCount = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const val of Object.values(places)) {
      const p = parseInt(val);
      if (!isNaN(p) && p > 0) counts[p] = (counts[p] ?? 0) + 1;
    }
    return counts;
  }, [places]);

  const isTie = (entryId: string) => {
    const p = parseInt(places[entryId]);
    return !isNaN(p) && p > 0 && (placeCount[p] ?? 0) > 1;
  };

  const placedCount = useMemo(() =>
    activeEntries.filter((e) => {
      const p = parseInt(places[e.id]);
      return !isNaN(p) && p >= 1;
    }).length,
    [activeEntries, places]
  );

  // Detect skipped place numbers (e.g. 1, 2, 4 missing 3)
  const gapWarning = useMemo(() => {
    const assigned = new Set<number>();
    for (const val of Object.values(places)) {
      const p = parseInt(val);
      if (!isNaN(p) && p >= 1) assigned.add(p);
    }
    if (assigned.size === 0) return null;
    const max = Math.max(...assigned);
    const missing: number[] = [];
    for (let i = 1; i <= max; i++) {
      if (!assigned.has(i)) missing.push(i);
    }
    return missing.length > 0 ? missing : null;
  }, [places]);

  // Auto-focus the first empty active input on mount
  const firstEmptyRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstEmptyRef.current?.focus(); }, []);
  const firstEmptyIndex = activeEntries.findIndex((e) => !places[e.id]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    setSaved(false);
    try {
      const resultItems = activeEntries
        .filter((entry) => {
          const p = parseInt(places[entry.id]);
          return !isNaN(p) && p >= 1;
        })
        .map((entry) => ({
          entry_id: entry.id,
          place: parseInt(places[entry.id]),
          is_tie: isTie(entry.id),
        }));

      const res = await fetch('/api/results', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId, classId, results: resultItems }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? 'Failed to save');
      }

      setSaved(true);
      setMessage({ type: 'success', text: 'Placings saved.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message ?? 'Something went wrong. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleClearAll = () => {
    setPlaces(Object.fromEntries(entries.map((e) => [e.id, ''])));
    setMessage(null);
    setSaved(false);
  };

  return (
    <div>
      {/* Class navigation */}
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
          ) : <span />}
          <span style={{ color: '#8b7355' }}>Class {classIndex + 1} of {classes.length}</span>
          {nextClass ? (
            <Link
              href={`/shows/${showId}/classes/${nextClass.id}/scorekeeper`}
              className="font-medium hover:underline"
              style={{ color: '#8b4513' }}
            >
              {nextClass.class_number} →
            </Link>
          ) : <span />}
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm" style={{ color: '#8b7355' }}>
          {placedCount} of {activeEntries.length} placed
          {dqEntries.length > 0 && ` · ${dqEntries.length} DQ`}
        </span>
        {confirmClear ? (
          <span className="flex items-center gap-2">
            <span className="text-xs" style={{ color: '#5c3d1e' }}>Clear all placings?</span>
            <button type="button" onClick={() => { setConfirmClear(false); handleClearAll(); }}
              className="text-xs text-red-600 hover:underline">Yes</button>
            <button type="button" onClick={() => setConfirmClear(false)}
              className="text-xs hover:underline" style={{ color: '#8b7355' }}>Cancel</button>
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
            <th className="py-2 pr-4 text-sm font-semibold" style={{ color: '#2c1810' }}>Back #</th>
            <th className="py-2 pr-4 text-sm font-semibold" style={{ color: '#2c1810' }}>Exhibitor</th>
            <th className="py-2 pr-4 text-sm font-semibold hidden md:table-cell" style={{ color: '#2c1810' }}>Horse</th>
            <th className="py-2 text-sm font-semibold" style={{ color: '#2c1810' }}>Place</th>
          </tr>
        </thead>
        <tbody>
          {activeEntries.map((entry, i) => {
            const tied = isTie(entry.id);
            return (
              <tr
                key={entry.id}
                style={{
                  borderBottom: '1px solid #e8ddd0',
                  backgroundColor: tied ? '#fffbeb' : undefined,
                }}
              >
                <td className="py-3 pr-4 font-medium" style={{ color: '#2c1810' }}>
                  {entry.back_number ?? '—'}
                </td>
                <td className="py-3 pr-4" style={{ color: '#2c1810' }}>{entry.exhibitorName}</td>
                <td className="py-3 pr-4 hidden md:table-cell" style={{ color: '#8b7355' }}>{entry.horseName}</td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <input
                      ref={i === firstEmptyIndex ? firstEmptyRef : undefined}
                      type="number"
                      min="1"
                      value={places[entry.id] ?? ''}
                      onChange={(e) => {
                        setPlaces((prev) => ({ ...prev, [entry.id]: e.target.value }));
                        setSaved(false);
                      }}
                      className="w-16 border rounded px-2 py-1 text-center text-sm"
                      style={{ borderColor: '#d4b896' }}
                      placeholder="—"
                    />
                    {tied && (
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded"
                        style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
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
            <tr key={entry.id} style={{ borderBottom: '1px solid #e8ddd0', backgroundColor: '#f9f9f9' }}>
              <td className="py-3 pr-4 text-sm" style={{ color: '#bbb' }}>{entry.back_number ?? '—'}</td>
              <td className="py-3 pr-4 text-sm" style={{ color: '#bbb' }}>{entry.exhibitorName}</td>
              <td className="py-3 pr-4 text-sm hidden md:table-cell" style={{ color: '#bbb' }}>{entry.horseName}</td>
              <td className="py-3">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}
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

      {gapWarning && (
        <div
          className="mb-3 px-3 py-2 rounded text-sm"
          style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
        >
          ⚠ Place gap — missing: {gapWarning.join(', ')}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2 rounded font-medium text-sm transition-opacity"
        style={{ backgroundColor: '#2c1810', color: '#f5ede0', opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Saving…' : 'Save Placings'}
      </button>
    </div>
  );
}
