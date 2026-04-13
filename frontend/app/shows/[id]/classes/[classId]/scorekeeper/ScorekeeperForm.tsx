'use client';

import { useState } from 'react';

interface Entry {
  id: string;
  back_number: number | null;
  riderName: string;
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

  const [placings, setPlacings] = useState<Record<string, { place: string; is_tie: boolean }>>(
    Object.fromEntries(
      entries.map((e) => [
        e.id,
        {
          place: existingByEntryId[e.id]?.place?.toString() ?? '',
          is_tie: existingByEntryId[e.id]?.is_tie ?? false,
        },
      ])
    )
  );

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleChange = (entryId: string, field: 'place' | 'is_tie', value: string | boolean) => {
    setPlacings((prev) => ({ ...prev, [entryId]: { ...prev[entryId], [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const entry of entries) {
        const placing = placings[entry.id];
        if (!placing.place) continue;
        const place = parseInt(placing.place);
        if (isNaN(place) || place < 1) continue;
        const existing = existingByEntryId[entry.id];

        if (existing) {
          await fetch('/api/results', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showId, classId, resultId: existing.id, place, is_tie: placing.is_tie }),
          });
        } else {
          await fetch('/api/results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showId, classId, entry_id: entry.id, place, is_tie: placing.is_tie }),
          });
        }
      }
      setMessage({ type: 'success', text: 'Placings saved successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' });
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
            <th className="py-2 pr-4">Rider</th>
            <th className="py-2 pr-4">Horse</th>
            <th className="py-2 pr-4">Place</th>
            <th className="py-2">Tie</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b">
              <td className="py-3 pr-4">{entry.back_number ?? '—'}</td>
              <td className="py-3 pr-4">{entry.riderName}</td>
              <td className="py-3 pr-4">{entry.horseName}</td>
              <td className="py-3 pr-4">
                <input
                  type="number"
                  min="1"
                  value={placings[entry.id]?.place ?? ''}
                  onChange={(e) => handleChange(entry.id, 'place', e.target.value)}
                  className="w-16 border rounded px-2 py-1 text-center"
                  placeholder="—"
                />
              </td>
              <td className="py-3">
                <input
                  type="checkbox"
                  checked={placings[entry.id]?.is_tie ?? false}
                  onChange={(e) => handleChange(entry.id, 'is_tie', e.target.checked)}
                  className="w-4 h-4"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {message && (
        <div className={`mb-4 p-3 rounded ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
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
