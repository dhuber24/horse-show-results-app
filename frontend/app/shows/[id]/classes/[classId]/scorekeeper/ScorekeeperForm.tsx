'use client';

import { useState, useMemo } from 'react';

interface Entry {
  id: string;
  back_number: number | null;
  exhibitorName: string;
  horseName: string;
}

interface Result {
  id: string;
  entry_id: string;
  place: number;
  is_tie: boolean;
  notes: string;
}

interface Props {
  showId: string;
  classId: string;
  entries: Entry[];
  results: Result[];
}

export default function ScorekeeperForm({ showId, classId, entries, results }: Props) {
  const existingByEntryId = Object.fromEntries(results.map((r) => [r.entry_id, r]));

  const [places, setPlaces] = useState<Record<string, string>>(
    Object.fromEntries(
      entries.map((e) => [
        e.id,
        existingByEntryId[e.id]?.place?.toString() ?? '',
      ])
    )
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Count how many entries share each place — any place with 2+ entries is a tie
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

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const resultItems = entries
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

      setMessage({ type: 'success', text: 'Placings saved successfully!' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message ?? 'Something went wrong. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <table className="w-full border-collapse mb-6">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-4">Back #</th>
            <th className="py-2 pr-4">Exhibitor</th>
            <th className="py-2 pr-4">Horse</th>
            <th className="py-2">Place</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const tied = isTie(entry.id);
            return (
              <tr key={entry.id} className={`border-b transition-colors ${tied ? 'bg-amber-50' : ''}`}>
                <td className="py-3 pr-4">{entry.back_number ?? '—'}</td>
                <td className="py-3 pr-4">{entry.exhibitorName}</td>
                <td className="py-3 pr-4">{entry.horseName}</td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      value={places[entry.id] ?? ''}
                      onChange={(e) =>
                        setPlaces((prev) => ({ ...prev, [entry.id]: e.target.value }))
                      }
                      className="w-16 border rounded px-2 py-1 text-center"
                      placeholder="—"
                    />
                    {tied && (
                      <span className="text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded">
                        TIE
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {message && (
        <div
          className={`mb-4 p-3 rounded ${
            message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Placings'}
      </button>
    </div>
  );
}
