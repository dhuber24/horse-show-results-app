'use client';

/**
 * Naming the rest of a team (migration 192) — the desk's and the exhibitor's.
 *
 * One editor for both doors, because the rules are one set (`backend/teams.py`):
 * only the way riders are found differs, so the host passes `findRiders` and
 * `loadHorses` — the desk looks through its own roster, the exhibitor asks the
 * show for riders by name. The team is saved whole with one press, the way the
 * endpoint takes it, so a half-picked team is never what is on file.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { type TeamMember, type TeamSeat, teamShortLabel } from '@/lib/teams';
import type { ClubOption } from '@/lib/clubs';

export interface TeamCandidate {
  exhibitor_id: string;
  full_name: string;
}

export interface TeamHorseOption {
  id: string;
  name: string;
}

interface DraftSeat {
  exhibitor_id: string;
  exhibitor_name: string;
  horse_id: string | null;
  horse_name: string | null;
  club_id: string | null;
}

/** A rider's declared clubs, primary first (migration 193). */
export interface SeatClubChoices {
  primaryId: string | null;
  clubs: ClubOption[];
}

/** Below this the exhibitor's search is not sent — the backend's own minimum. */
export const TEAMMATE_QUERY_MIN = 2;

export default function TeamEditor({
  teamSize,
  entrantName,
  teamHorseName,
  members,
  findRiders,
  loadHorses,
  onSave,
  onCancel,
  notFoundHint,
  clubChoices,
  entrantId,
  entrantClubId = null,
}: {
  teamSize: number;
  entrantName: string;
  teamHorseName: string | null;
  members: TeamMember[];
  /** Riders who could join, matching what was typed. The entrant and the riders
   *  already picked are left out here, whatever the host returns. */
  findRiders: (query: string) => Promise<TeamCandidate[]>;
  /** A rider's horses at this show, for the horse they ride on the team. */
  loadHorses: (exhibitorId: string) => Promise<TeamHorseOption[]>;
  /** Saves the whole team; resolves to an error message, or null once saved.
   *  `entrantClubId` is the club the entrant rides for on it, null for primary. */
  onSave: (seats: TeamSeat[], entrantClubId: string | null) => Promise<string | null>;
  /** A rider's declared clubs at a show that keeps club points (migration 193).
   *  A seat offers a club only where the rider declared more than one. */
  clubChoices?: (exhibitorId: string) => SeatClubChoices | null;
  entrantId?: string;
  entrantClubId?: string | null;
  onCancel: () => void;
  /** What to say when nobody matches — who can put somebody on the roster
   *  differs between the desk and the exhibitor. */
  notFoundHint: string;
}) {
  const seats = Math.max(0, teamSize - 1);
  const [draft, setDraft] = useState<DraftSeat[]>(() =>
    members.map((m) => ({
      exhibitor_id: m.exhibitor_id,
      exhibitor_name: m.exhibitor_name,
      horse_id: m.horse_id,
      horse_name: m.horse_name,
      club_id: m.club_id ?? null,
    })),
  );
  const [entrantClub, setEntrantClub] = useState<string | null>(entrantClubId);
  const [horses, setHorses] = useState<Record<string, TeamHorseOption[]>>({});
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TeamCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The answer to the latest search wins; an earlier one landing late is dropped.
  const searchSeq = useRef(0);
  // Read through a ref so a host passing a fresh function each render does not
  // send the search again on every render.
  const findRef = useRef(findRiders);
  findRef.current = findRiders;

  const picked = useMemo(() => new Set(draft.map((d) => d.exhibitor_id)), [draft]);
  const dirty =
    entrantClub !== entrantClubId ||
    draft.length !== members.length ||
    draft.some(
      (d, i) =>
        d.exhibitor_id !== members[i]?.exhibitor_id ||
        (d.horse_id ?? null) !== (members[i]?.horse_id ?? null) ||
        d.club_id !== (members[i]?.club_id ?? null),
    );

  /** A "rides for" club picker, where the rider declared more than one club. */
  const clubPicker = (exhibitorId: string, value: string | null, onChange: (id: string | null) => void, who: string) => {
    const choices = clubChoices?.(exhibitorId);
    if (!choices || choices.clubs.length < 2) return null;
    const primary = choices.clubs.find((c) => c.id === choices.primaryId);
    return (
      <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
        for
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="rounded border px-1.5 py-1 text-xs"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
          aria-label={`Club ${who} rides for on this team`}
        >
          <option value="">{primary ? `${primary.name} (primary)` : 'their primary club'}</option>
          {choices.clubs
            .filter((c) => c.id !== choices.primaryId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
    );
  };

  const ensureHorses = (exhibitorId: string) => {
    if (horses[exhibitorId]) return;
    loadHorses(exhibitorId)
      .then((list) => setHorses((prev) => ({ ...prev, [exhibitorId]: list })))
      .catch(() => setHorses((prev) => ({ ...prev, [exhibitorId]: [] })));
  };

  useEffect(() => {
    members.forEach((m) => ensureHorses(m.exhibitor_id));
    // Once, for the team as it opened; riders added later load their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < TEAMMATE_QUERY_MIN) {
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(() => {
      findRef.current(needle)
        .then((found) => {
          if (seq === searchSeq.current) setResults(found);
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const offered = results.filter((r) => !picked.has(r.exhibitor_id));

  const add = (rider: TeamCandidate) => {
    setDraft((prev) => [
      ...prev,
      { exhibitor_id: rider.exhibitor_id, exhibitor_name: rider.full_name, horse_id: null, horse_name: null, club_id: null },
    ]);
    ensureHorses(rider.exhibitor_id);
    setQuery('');
    setResults([]);
  };

  const remove = (exhibitorId: string) =>
    setDraft((prev) => prev.filter((d) => d.exhibitor_id !== exhibitorId));

  const setHorse = (exhibitorId: string, horseId: string) =>
    setDraft((prev) =>
      prev.map((d) => {
        if (d.exhibitor_id !== exhibitorId) return d;
        const horse = (horses[exhibitorId] ?? []).find((h) => h.id === horseId);
        return { ...d, horse_id: horseId || null, horse_name: horse?.name ?? null };
      }),
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const message = await onSave(
        draft.map((d) => ({ exhibitor_id: d.exhibitor_id, horse_id: d.horse_id, club_id: d.club_id })),
        entrantClub,
      );
      if (message) setError(message);
    } finally {
      setSaving(false);
    }
  };

  const teamHorse = teamHorseName ? `the team's horse (${teamHorseName})` : "the team's horse";
  const short = Math.max(0, seats - draft.length);

  return (
    <div
      className="rounded border p-3 space-y-3 text-sm"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Team of {teamSize}: {entrantName}
          {teamHorseName ? ` on ${teamHorseName}` : ''}, and {seats === 1 ? 'one more rider' : `${seats} more riders`}.
        </p>
        {entrantId && clubPicker(entrantId, entrantClub, setEntrantClub, entrantName)}
      </div>

      {draft.length > 0 && (
        <ol className="space-y-2">
          {draft.map((seat) => {
            const options = horses[seat.exhibitor_id] ?? [];
            const known = seat.horse_id === null || options.some((h) => h.id === seat.horse_id);
            return (
              <li key={seat.exhibitor_id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                  {seat.exhibitor_name}
                </span>
                <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
                  rides
                  <select
                    value={seat.horse_id ?? ''}
                    onChange={(e) => setHorse(seat.exhibitor_id, e.target.value)}
                    className="rounded border px-1.5 py-1 text-xs"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
                    aria-label={`Horse ${seat.exhibitor_name} rides`}
                  >
                    <option value="">{teamHorse}</option>
                    {options.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                    {!known && seat.horse_id && <option value={seat.horse_id}>{seat.horse_name ?? 'their horse'}</option>}
                  </select>
                </label>
                {clubPicker(
                  seat.exhibitor_id,
                  seat.club_id,
                  (id) => setDraft((prev) => prev.map((d) => (d.exhibitor_id === seat.exhibitor_id ? { ...d, club_id: id } : d))),
                  seat.exhibitor_name,
                )}
                <button
                  type="button"
                  onClick={() => remove(seat.exhibitor_id)}
                  className="text-xs hover:underline"
                  style={{ color: 'var(--error-strong)' }}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {short > 0 && (
        <div className="space-y-1">
          <label className="block text-xs font-medium" style={{ color: 'var(--text-deep)' }}>
            Add a rider — {teamShortLabel(short)}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type their name"
              autoComplete="off"
              className="mt-1 block w-full rounded border px-2 py-1.5 text-sm"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}
            />
          </label>
          {offered.length > 0 && (
            <ul className="rounded border divide-y" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
              {offered.map((rider) => (
                <li key={rider.exhibitor_id}>
                  <button
                    type="button"
                    onClick={() => add(rider)}
                    className="w-full text-left px-2 py-1.5 hover:underline"
                    style={{ color: 'var(--foreground)' }}
                  >
                    {rider.full_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= TEAMMATE_QUERY_MIN && !searching && offered.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Nobody at this show by that name. {notFoundHint}
            </p>
          )}
        </div>
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
          disabled={saving || !dirty}
          title={!dirty ? 'Nothing has changed yet' : undefined}
          className="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          {saving ? 'Saving…' : 'Save team'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs hover:underline" style={{ color: 'var(--muted)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
