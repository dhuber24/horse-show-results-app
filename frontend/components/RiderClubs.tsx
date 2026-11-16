'use client';

/**
 * Which saddle club(s) a rider rides for at a show (migration 193) — the
 * desk's and the exhibitor's, one implementation.
 *
 * Only the competing clubs the rider holds a membership with are offered: the
 * membership on their profile is what the desk verifies. Up to the number the
 * show office allows; with more than one, one is primary — the club an
 * individual placing counts for. The others are for team events.
 */

import { useState } from 'react';
import type { RiderClubs as RiderClubsData } from '@/lib/clubs';

export default function RiderClubs({
  clubs,
  clubsPerRider,
  onSave,
  noClubHint,
}: {
  clubs: RiderClubsData;
  clubsPerRider: number;
  /** Resolves to an error message, or null once saved. */
  onSave: (clubIds: string[], primaryId: string | null) => Promise<string | null>;
  /** What to say when they hold no competing club's membership. */
  noClubHint: string;
}) {
  const [chosen, setChosen] = useState<string[]>(clubs.club_ids);
  const [primary, setPrimary] = useState<string | null>(clubs.primary_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (clubs.held.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        No membership on file with a club competing here. {noClubHint}
      </p>
    );
  }

  const dirty =
    primary !== clubs.primary_id ||
    chosen.length !== clubs.club_ids.length ||
    chosen.some((id) => !clubs.club_ids.includes(id));

  const toggle = (id: string, on: boolean) => {
    if (clubsPerRider === 1) {
      setChosen(on ? [id] : []);
      setPrimary(on ? id : null);
      return;
    }
    const next = on ? [...chosen, id] : chosen.filter((c) => c !== id);
    setChosen(next);
    if (!next.includes(primary ?? '')) setPrimary(next[0] ?? null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const message = await onSave(chosen, primary);
      if (message) setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 text-sm">
      {clubs.derived && (
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Their one club here, so it is theirs without choosing.
        </p>
      )}
      <ul className="space-y-1">
        {clubs.held.map((club) => {
          const on = chosen.includes(club.id);
          const full = !on && clubsPerRider > 1 && chosen.length >= clubsPerRider;
          return (
            <li key={club.id} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
                <input
                  type={clubsPerRider === 1 ? 'radio' : 'checkbox'}
                  name="rider-club"
                  checked={on}
                  disabled={full}
                  title={full ? `A rider rides for up to ${clubsPerRider} clubs here` : undefined}
                  onChange={(e) => toggle(club.id, e.target.checked)}
                />
                {club.name}
              </label>
              {clubsPerRider > 1 && on && (
                <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
                  <input type="radio" name="rider-primary" checked={primary === club.id} onChange={() => setPrimary(club.id)} />
                  primary — individual classes count for it
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        title={!dirty ? 'Nothing has changed yet' : undefined}
        className="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
      >
        {saving ? 'Saving…' : 'Save club'}
      </button>
    </div>
  );
}
