'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface Entry {
  id: string;
  back_number: number | null;
  exhibitorName: string;
  horseName: string;
}

export default function BackNumberForm({ showId, classId, entries }: {
  showId: string;
  classId: string;
  entries: Entry[];
}) {
  const router = useRouter();
  const [numbers, setNumbers] = useState<Record<string, string>>(
    Object.fromEntries(entries.map((e) => [e.id, e.back_number?.toString() ?? '']))
  );
  const [saving, setSaving] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const duplicates = useMemo(() => {
    const vals = Object.values(numbers).filter((v) => v !== '');
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const v of vals) {
      if (seen.has(v)) dupes.add(v);
      seen.add(v);
    }
    return dupes;
  }, [numbers]);

  const hasDuplicates = duplicates.size > 0;

  const handleSave = async () => {
    if (hasDuplicates) {
      setMessage({ type: 'error', text: `Duplicate back numbers: ${[...duplicates].join(', ')}. Each exhibitor must have a unique number.` });
      return;
    }
    setSaving(true);
    setMessage(null);
    const assignments = entries.map((e) => ({
      entry_id: e.id,
      back_number: numbers[e.id] ? parseInt(numbers[e.id]) : null,
    }));
    const res = await fetch('/api/back-numbers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId, assignments }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Back numbers saved!' });
      router.refresh();
    } else {
      const data = await res.json();
      setMessage({ type: 'error', text: data.detail || 'Failed to save back numbers.' });
    }
  };

  const handleAutoAssign = async () => {
    setAutoAssigning(true);
    setMessage(null);
    const res = await fetch('/api/back-numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, classId }),
    });
    if (res.ok) {
      setMessage({ type: 'success', text: 'Back numbers auto-assigned!' });
      router.refresh();
    } else {
      setMessage({ type: 'error', text: 'Failed to auto-assign.' });
    }
    setAutoAssigning(false);
  };

  return (
    <div>
      <div className="flex gap-3 mb-6">
        <button onClick={handleAutoAssign} disabled={autoAssigning}
          className="px-4 py-2 rounded font-medium text-sm transition disabled:opacity-50"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
          {autoAssigning ? 'Assigning...' : 'Auto-Assign 1, 2, 3...'}
        </button>
      </div>

      {hasDuplicates && (
        <div className="mb-4 p-3 rounded text-sm"
          style={{ backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)', border: '1px solid var(--error-border)' }}>
          Duplicate back numbers detected: <strong>{[...duplicates].join(', ')}</strong>. Please fix before saving.
        </div>
      )}

      <div className="rounded-lg border overflow-hidden mb-4" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}>
              <th className="py-3 px-4 text-left text-sm font-semibold">Exhibitor</th>
              <th className="py-3 px-4 text-left text-sm font-semibold hidden md:table-cell">Horse</th>
              <th className="py-3 px-4 text-left text-sm font-semibold">Back #</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const val = numbers[entry.id];
              const isDupe = val !== '' && duplicates.has(val);
              return (
                <tr key={entry.id}
                  style={{ backgroundColor: i % 2 === 0 ? 'var(--surface)' : 'var(--background)', borderTop: '1px solid var(--border)' }}>
                  <td className="py-3 px-4" style={{ color: 'var(--foreground)' }}>{entry.exhibitorName}</td>
                  <td className="py-3 px-4 hidden md:table-cell" style={{ color: 'var(--muted)' }}>{entry.horseName}</td>
                  <td className="py-3 px-4">
                    <input
                      type="number"
                      min="1"
                      value={numbers[entry.id]}
                      onChange={(e) => setNumbers((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                      className="w-20 border rounded px-2 py-1 text-sm text-center"
                      style={{
                        borderColor: isDupe ? 'var(--error)' : 'var(--border)',
                        backgroundColor: isDupe ? 'var(--error-bg)' : 'var(--background)',
                      }}
                      placeholder="--"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {message && (
        <div className="mb-4 p-3 rounded text-sm"
          style={{
            backgroundColor: message.type === 'success' ? 'var(--success-bg)' : 'var(--error-bg)',
            color: message.type === 'success' ? 'var(--success)' : 'var(--error-strong)',
          }}>
          {message.text}
        </div>
      )}

      <button onClick={handleSave} disabled={saving || hasDuplicates}
        className="px-6 py-2 rounded font-medium transition disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}>
        {saving ? 'Saving...' : 'Save Back Numbers'}
      </button>
    </div>
  );
}
