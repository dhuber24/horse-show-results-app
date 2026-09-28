'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';

/**
 * The show's choice of points system. Saved on the press, and the public
 * leaderboard recomputes on its next read — standings are derived from the
 * posted placings, never stored, so changing the system rescores everything.
 *
 * The list is the caller's own company's systems (migration 148). A show a
 * co-manager from another company set up may already score by a system this
 * caller cannot see; it stays in the dropdown, by name, so the screen does not
 * read as though the show has none — it just cannot be chosen again once left.
 */
export default function PointSystemPicker({
  showId,
  systems,
  current,
}: {
  showId: string;
  systems: { id: string; name: string }[];
  current: { id: string; name: string } | null;
}) {
  const currentId = current?.id ?? null;
  const foreign = current && !systems.some((s) => s.id === current.id) ? current : null;
  const router = useRouter();
  const [value, setValue] = useState(currentId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = value !== (currentId ?? '');

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/shows/${showId}/high-point`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ point_system_id: value || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(errorMessage(body, 'The points system could not be saved.'));
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor="show-point-system" className="sr-only">Points system</label>
        <select
          id="show-point-system"
          value={value}
          onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          className="border rounded px-3 py-2 text-sm min-w-0 max-w-full"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
        >
          <option value="">No high point at this show</option>
          {foreign && <option value={foreign.id}>{foreign.name} (another company&apos;s)</option>}
          {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          title={!dirty ? 'Nothing has changed' : undefined}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--surface)' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && !dirty && <span className="text-sm" style={{ color: 'var(--success-strong)' }}>Saved.</span>}
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}
