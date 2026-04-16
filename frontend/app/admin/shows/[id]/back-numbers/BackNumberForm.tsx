'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';

interface ExhibitorEntry {
  exhibitor_id: string;
  full_name: string;
  back_number: number | null;
}

export default function BackNumberForm({ showId, exhibitors }: {
  showId: string;
  exhibitors: ExhibitorEntry[];
}) {
  const router = useRouter();
  const [numbers, setNumbers] = useState<Record<string, string>>(
    Object.fromEntries(exhibitors.map((r) => [r.exhibitor_id, r.back_number?.toString() ?? '']))
  );
  const [saving, setSaving] = useState(false);
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
    const assignments = exhibitors.map((r) => ({
      exhibitor_id: r.exhibitor_id,
      back_number: numbers[r.exhibitor_id] ? parseInt(numbers[r.exhibitor_id]) : null,
    }));
    const res = await fetch('/api/back-numbers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showId, assignments }),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'Back numbers saved!' });
      router.refresh();
    } else {
      const data = await res.json();
      setMessage({ type: 'error', text: data.detail || 'Failed to save.' });
    }
  };

  return (
    <div>
      {hasDuplicates && (
        <div className="mb-4 p-3 rounded text-sm"
          style={{ backgroundColor: '#fdf0f0', color: '#8b1a1a', border: '1px solid #f5c0c0' }}>
          Duplicate back numbers: <strong>{[...duplicates].join(', ')}</strong>. Please fix before saving.
        </div>
      )}

      <div className="rounded-lg border overflow-hidden mb-4" style={{ borderColor: '#d4b896' }}>
        <table className="w-full">
          <thead>
            <tr style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
              <th className="py-3 px-4 text-left text-sm font-semibold">Exhibitor</th>
              <th className="py-3 px-4 text-left text-sm font-semibold">Back #</th>
            </tr>
          </thead>
          <tbody>
            {exhibitors.map((exhibitor, i) => {
              const val = numbers[exhibitor.exhibitor_id];
              const isDupe = val !== '' && duplicates.has(val);
              return (
                <tr key={exhibitor.exhibitor_id}
                  style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#faf7f2', borderTop: '1px solid #d4b896' }}>
                  <td className="py-3 px-4" style={{ color: '#2c1810' }}>{exhibitor.full_name}</td>
                  <td className="py-3 px-4">
                    <input
                      type="number"
                      min="1"
                      value={numbers[exhibitor.exhibitor_id]}
                      onChange={(e) => setNumbers((prev) => ({ ...prev, [exhibitor.exhibitor_id]: e.target.value }))}
                      className="w-20 border rounded px-2 py-1 text-sm text-center"
                      style={{
                        borderColor: isDupe ? '#e53e3e' : '#d4b896',
                        backgroundColor: isDupe ? '#fff5f5' : '#faf7f2',
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
            backgroundColor: message.type === 'success' ? '#f0f7f0' : '#fdf0f0',
            color: message.type === 'success' ? '#2d6a2d' : '#8b1a1a',
          }}>
          {message.text}
        </div>
      )}

      <button onClick={handleSave} disabled={saving || hasDuplicates}
        className="px-6 py-2 rounded font-medium transition disabled:opacity-50"
        style={{ backgroundColor: '#8b4513', color: '#ffffff' }}>
        {saving ? 'Saving...' : 'Save Back Numbers'}
      </button>
    </div>
  );
}
