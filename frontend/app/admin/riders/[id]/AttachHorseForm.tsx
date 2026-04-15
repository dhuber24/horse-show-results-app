'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Horse {
  id: string;
  name: string;
}

export default function AttachHorseForm({ riderId, allHorses, attachedHorseIds }: {
  riderId: string;
  allHorses: Horse[];
  attachedHorseIds: string[];
}) {
  const router = useRouter();
  const [selectedHorseId, setSelectedHorseId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableHorses = allHorses.filter((h) => !attachedHorseIds.includes(h.id));

  const handleAttach = async () => {
    if (!selectedHorseId) return;
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/riders/${riderId}/horses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horse_id: selectedHorseId }),
    });
    setSaving(false);
    if (res.ok) {
      setSelectedHorseId('');
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to attach horse.');
    }
  };

  const handleDetach = async (horseId: string) => {
    const res = await fetch(`/api/riders/${riderId}/horses/${horseId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      router.refresh();
    }
  };

  return (
    <div className="space-y-3">
      {attachedHorseIds.length > 0 && (
        <ul className="space-y-2">
          {allHorses
            .filter((h) => attachedHorseIds.includes(h.id))
            .map((horse) => (
              <li key={horse.id}
                className="flex items-center justify-between p-3 rounded-lg border"
                style={{ borderColor: '#d4b896' }}>
                <span className="font-medium" style={{ color: '#2c1810' }}>{horse.name}</span>
                <button
                  onClick={() => handleDetach(horse.id)}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>
      )}
      <div className="flex gap-2">
        <select
          value={selectedHorseId}
          onChange={(e) => setSelectedHorseId(e.target.value)}
          className="flex-1 border rounded px-3 py-2"
          style={{ borderColor: '#d4b896' }}
        >
          <option value="">Select a horse to attach...</option>
          {availableHorses.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
        <button
          onClick={handleAttach}
          disabled={!selectedHorseId || saving}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Adding...' : 'Attach'}
        </button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
