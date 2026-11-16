'use client';

/**
 * Saddle-club high point, as the show office sets it up (migration 193).
 *
 * Whether the show keeps club standings; which saddle clubs compete — picked
 * from the shared list, and a club that is not listed added to it for every
 * show after; how many clubs one rider may ride for (WSCA: a primary club, and
 * a second in team events); and how a team class counts for clubs.
 */

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { TEAM_RULE_LABELS, type ClubOption, type ClubPointsSetup as Setup, type TeamRule } from '@/lib/clubs';

export default function ClubPointsSetup({ showId }: { showId: string }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [allClubs, setAllClubs] = useState<ClubOption[]>([]);
  const [find, setFind] = useState('');
  const [newClub, setNewClub] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/shows/${showId}/club-points`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setSetup(s))
      .catch(() => setError('Could not load the club setup.'));
    fetch('/api/associations?type=saddle_club')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: ClubOption[]) => setAllClubs(list.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, [showId]);

  const chosen = useMemo(() => new Set((setup?.clubs ?? []).map((c) => c.id)), [setup]);
  const shown = allClubs
    .filter((c) => c.name.toLowerCase().includes(find.trim().toLowerCase()))
    .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)) || a.name.localeCompare(b.name));

  if (!setup) return <p className="text-sm" style={{ color: 'var(--muted)' }}>{error ?? 'Loading…'}</p>;

  const update = (patch: Partial<Setup>) => {
    setSaved(false);
    setSetup({ ...setup, ...patch });
  };
  const toggleClub = (club: ClubOption, on: boolean) =>
    update({ clubs: on ? [...setup.clubs, club] : setup.clubs.filter((c) => c.id !== club.id) });

  const addClub = async () => {
    const name = newClub.trim();
    if (!name) return;
    setError(null);
    const res = await fetch('/api/saddle-clubs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(errorMessage(body, 'Could not add that club.'));
      return;
    }
    const club = { id: body.id, name: body.name };
    setAllClubs((prev) => (prev.some((c) => c.id === club.id) ? prev : [...prev, club]));
    if (!chosen.has(club.id)) toggleClub(club, true);
    setNewClub('');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/club-points`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: setup.enabled,
          clubs_per_rider: setup.clubs_per_rider,
          team_rule: setup.team_rule,
          club_ids: setup.clubs.map((c) => c.id),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(errorMessage(body, 'Could not save the club setup.'));
      else {
        setSetup(body);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const field = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' };

  return (
    <div className="space-y-4 text-sm">
      <label className="flex items-center gap-2 font-medium" style={{ color: 'var(--foreground)' }}>
        <input type="checkbox" checked={setup.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        Keep Saddle Club High Point standings at this show
      </label>

      {setup.enabled && (
        <>
          <div className="flex flex-wrap gap-6">
            <label className="block" style={{ color: 'var(--text-deep)' }}>
              A rider may ride for
              <select
                value={setup.clubs_per_rider}
                onChange={(e) => update({ clubs_per_rider: Number(e.target.value) })}
                className="ml-2 rounded border px-2 py-1"
                style={field}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'one club' : `up to ${n} clubs`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block" style={{ color: 'var(--text-deep)' }}>
              A team class counts for
              <select
                value={setup.team_rule}
                onChange={(e) => update({ team_rule: e.target.value as TeamRule })}
                className="ml-2 rounded border px-2 py-1"
                style={field}
              >
                {(Object.keys(TEAM_RULE_LABELS) as TeamRule[]).map((rule) => (
                  <option key={rule} value={rule}>
                    {TEAM_RULE_LABELS[rule]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            A rider with more than one club names a primary one: every individual placing counts for that club only —
            never split, never counted twice. A rider on a team may ride for another of their clubs on that team. A
            club earns a team&rsquo;s placing once, however many of its riders are on the team.
          </p>

          <div>
            <p className="font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
              Clubs competing — {setup.clubs.length} chosen
            </p>
            <input
              type="search"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a club"
              className="w-full rounded border px-2 py-1.5 mb-2"
              style={field}
            />
            <ul className="max-h-64 overflow-y-auto rounded border divide-y" style={{ borderColor: 'var(--border)' }}>
              {shown.map((club) => (
                <li key={club.id} className="px-2 py-1.5">
                  <label className="flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
                    <input type="checkbox" checked={chosen.has(club.id)} onChange={(e) => toggleClub(club, e.target.checked)} />
                    {club.name}
                  </label>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="px-2 py-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                  No saddle club by that name yet.
                </li>
              )}
            </ul>
            <div className="flex gap-2 mt-2">
              <input
                value={newClub}
                onChange={(e) => setNewClub(e.target.value)}
                placeholder="A club not listed — its full name"
                className="flex-1 rounded border px-2 py-1.5"
                style={field}
              />
              <button
                type="button"
                onClick={addClub}
                disabled={!newClub.trim()}
                title={!newClub.trim() ? 'Type the club’s name first' : undefined}
                className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              >
                Add club
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              A club you add is kept for every show after, and riders pick it on their profile&rsquo;s memberships.
            </p>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          {saving ? 'Saving…' : 'Save club setup'}
        </button>
        {saved && <span className="text-xs" style={{ color: 'var(--success)' }}>Saved</span>}
      </div>
    </div>
  );
}
