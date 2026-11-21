'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { errorMessage } from '@/lib/api-error';

/**
 * Whether the show's team classes also count toward individual high point
 * (migration 208) — the show's call, since WSCA leaves high-point rules to each
 * show committee.
 *
 * Off, a team class earns Team High Point only. On, every rider on a placed
 * team also earns the placing's full points in the team class's division, with
 * the horse they rode. Team High Point is kept either way. Shown on the Scoring
 * step and the High Point page wherever the show has a team class; the page
 * refreshes after a change so the class list and the leaders move with it.
 */
export default function TeamPointsSetting({ showId, initial }: { showId: string; initial: boolean }) {
  const router = useRouter();
  const [inDivisions, setInDivisions] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/high-point/team-points`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ in_divisions: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorMessage(body, 'That change was not saved.'));
        return;
      }
      setInDivisions(Boolean(body?.team_points_in_divisions ?? next));
      router.refresh();
    } catch {
      setError('Network error — nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border px-3 py-2 space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
      <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--foreground)' }}>
        <input
          type="checkbox"
          className="mt-1"
          checked={inDivisions}
          disabled={busy}
          onChange={(e) => void save(e.target.checked)}
          title={busy ? 'Saving, please wait…' : undefined}
        />
        <span>
          <span className="font-medium">Team classes also count toward individual high point</span>
          <span className="block" style={{ color: 'var(--muted)' }}>
            {inDivisions
              ? 'Every rider on a placed team earns its points in Team High Point and in the team class’s division, with the horse they rode.'
              : 'Team classes earn Team High Point only. Tick to also add each rider’s team points to their division standings, with the horse they rode.'}
          </span>
        </span>
      </label>
      {error && (
        <p className="text-sm" style={{ color: 'var(--error-strong)' }}>
          ⚠ {error}
        </p>
      )}
    </div>
  );
}
