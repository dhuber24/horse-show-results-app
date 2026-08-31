'use client';

import { useState } from 'react';
import { coatDescription } from '@/lib/horse-coat';

interface TrainerHorse {
  id: string;
  name: string;
  owner_exhibitor_name: string | null;
  sex: string | null;
  age: number | null;
  breed_name: string | null;
  color_name: string | null;
  pattern_name: string | null;
  is_solid_paint_bred: boolean;
}

export default function TrainerHorsesPanel({ horses: initialHorses }: { horses: TrainerHorse[] }) {
  const [horses, setHorses] = useState<TrainerHorse[]>(initialHorses);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async (horseId: string) => {
    setError(null);
    setRemovingId(horseId);
    const res = await fetch(`/api/trainers/me/horses/${horseId}`, { method: 'DELETE' });
    setRemovingId(null);
    if (res.ok || res.status === 204) {
      setHorses((prev) => prev.filter((h) => h.id !== horseId));
      setConfirmRemoveId(null);
      return;
    }
    const json = await res.json().catch(() => ({}));
    setError(json.detail || 'Failed to remove horse.');
  };

  if (horses.length === 0) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: '#e8d5b7', backgroundColor: '#faf7f2' }}>
        <p className="text-sm" style={{ color: '#8b7355' }}>
          No horses are linked to your trainer profile yet. When exhibitors select you from the Trainer dropdown on a horse profile, that horse will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
        {horses.map((horse) => (
          <li key={horse.id} className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-sm flex items-center flex-wrap gap-1.5" style={{ color: '#2c1810' }}>
                {horse.name}
                {horse.sex && (
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                    {horse.sex}
                  </span>
                )}
                {horse.is_solid_paint_bred && (
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                    SPB
                  </span>
                )}
              </div>
              <div className="text-xs mt-1 flex flex-wrap gap-x-2 gap-y-1" style={{ color: '#8b7355' }}>
                {horse.owner_exhibitor_name && <span>Owner: {horse.owner_exhibitor_name}</span>}
                {horse.breed_name && <span>{horse.breed_name}</span>}
                {coatDescription(horse.color_name, horse.pattern_name) && (
                                  <span>{coatDescription(horse.color_name, horse.pattern_name)}</span>
                                )}
                {horse.age !== null && horse.age !== undefined && <span>Age: {horse.age}</span>}
              </div>
            </div>
            <div className="shrink-0">
              {confirmRemoveId === horse.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: '#8b7355' }}>Not your horse?</span>
                  <button
                    onClick={() => handleRemove(horse.id)}
                    disabled={removingId === horse.id}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    {removingId === horse.id ? 'Removing…' : 'Yes, remove'}
                  </button>
                  <button
                    onClick={() => setConfirmRemoveId(null)}
                    className="text-xs hover:underline"
                    style={{ color: '#8b7355' }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmRemoveId(horse.id)}
                  className="text-xs text-red-600 hover:underline"
                  title="Remove this horse from your trainer profile (use if an exhibitor selected you by mistake)"
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
    </div>
  );
}
