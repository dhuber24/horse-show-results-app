'use client';

import { useRef, useState } from 'react';

import { errorMessage } from '@/lib/api-error';
import { useRegisterStepAutosave } from './setup/_lib/StepAutosave';

/** One of this show's rings. `venue_ring_id` null: this show alone runs it. */
export interface ShowRing {
  id: string;
  name: string;
  sort_order: number | null;
  class_count: number | null;
  venue_ring_id: string | null;
}

/** A ring at the show's venue (migration 204), and how many shows run it. */
export interface VenueRing {
  id: string;
  name: string;
  sort_order: number | null;
  show_count: number;
}

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  subtle: 'var(--border-subtle)',
  bg: 'var(--surface)',
  accent: 'var(--text-deep)',
} as const;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Step 1's rings and arenas (migration 204). The show's own rings first — the
 * gate runs one class at a time in each — then the rest of the venue's list,
 * which the next show at the venue starts with. A ring added at a show with a
 * venue goes on the venue's list too; one this show alone runs (the "Ring 1" a
 * show made before it had a venue) waits for *Save to venue*.
 *
 * Reads the venue the show is saved at, not the one picked in the form above:
 * the form saves first, the page refreshes, and the parent's `key` gives this
 * a fresh start at the new venue.
 */
export default function RingsSection({
  showId,
  venueName,
  initialRings,
  initialVenueRings,
}: {
  showId: string;
  /** The saved venue's name; null when the show has no venue yet. */
  venueName: string | null;
  /** Null when the show's rings could not be read. */
  initialRings: ShowRing[] | null;
  initialVenueRings: VenueRing[];
}) {
  const [rings, setRings] = useState<ShowRing[] | null>(initialRings);
  const [venueRings, setVenueRings] = useState<VenueRing[]>(initialVenueRings);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasVenue = venueName !== null;
  const runIds = new Set((rings ?? []).map((r) => r.venue_ring_id).filter(Boolean));
  const notRun = venueRings.filter((v) => !runIds.has(v.id));

  const reload = async () => {
    const [ringsRes, venueRes] = await Promise.all([
      fetch(`/api/shows/${showId}/rings`, { cache: 'no-store' }),
      hasVenue ? fetch(`/api/shows/${showId}/rings/venue`, { cache: 'no-store' }) : null,
    ]);
    if (ringsRes.ok) setRings(await ringsRes.json());
    if (venueRes?.ok) setVenueRings(await venueRes.json());
  };

  /** Run one change; true once it is saved, false with its reason on screen. */
  const run = async (request: () => Promise<Response>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await request();
      if (!res.ok) {
        setError(errorMessage(await res.json().catch(() => null), fallback));
        return false;
      }
      await reload();
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<boolean> => {
    const name = newName.trim();
    if (!name) return true;
    if (rings?.some((r) => sameName(r.name, name))) {
      setError(`This show already has a ring called “${name}”.`);
      return false;
    }
    // A name the venue already has is that ring, not a second one.
    const known = notRun.find((v) => sameName(v.name, name));
    const ok = await run(
      () =>
        fetch(`/api/shows/${showId}/rings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(known ? { venue_ring_id: known.id } : { name }),
        }),
      'The ring could not be added.',
    );
    if (ok) {
      setNewName('');
      inputRef.current?.focus();
    }
    return ok;
  };

  const use = (v: VenueRing) =>
    run(
      () =>
        fetch(`/api/shows/${showId}/rings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ venue_ring_id: v.id }),
        }),
      `“${v.name}” could not be added to this show.`,
    );

  const saveRename = async (): Promise<boolean> => {
    if (!renaming) return true;
    const ring = rings?.find((r) => r.id === renaming.id);
    const name = renaming.name.trim();
    if (!ring || !name || name === ring.name) {
      setRenaming(null);
      return true;
    }
    const ok = await run(
      () =>
        fetch(`/api/shows/${showId}/rings/${ring.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      'The ring could not be renamed.',
    );
    if (ok) setRenaming(null);
    return ok;
  };

  const saveToVenue = (ring: ShowRing) =>
    run(
      () =>
        fetch(`/api/shows/${showId}/rings/${ring.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ save_to_venue: true }),
        }),
      `“${ring.name}” could not be saved to the venue.`,
    );

  const remove = (ring: ShowRing) =>
    run(
      () => fetch(`/api/shows/${showId}/rings/${ring.id}`, { method: 'DELETE' }),
      `“${ring.name}” could not be removed.`,
    );

  const removeFromVenue = (v: VenueRing) =>
    run(
      () => fetch(`/api/shows/${showId}/rings/venue/${v.id}`, { method: 'DELETE' }),
      `“${v.name}” could not be taken off the venue's list.`,
    );

  // A name typed and not added, or a rename not saved, is saved on the way
  // out like the rest of the step.
  const isDirty = () =>
    newName.trim() !== '' ||
    (renaming !== null && renaming.name.trim() !== (rings?.find((r) => r.id === renaming.id)?.name ?? ''));
  useRegisterStepAutosave(async () => {
    if (!(await saveRename()) || !(await add())) throw new Error('The rings could not be saved.');
  }, isDirty);

  const buttonClass = 'text-xs hover:underline disabled:opacity-50 disabled:no-underline';

  return (
    <section
      className="p-4 rounded-lg border space-y-3"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      aria-labelledby="rings-heading"
    >
      <div className="space-y-1">
        <h2 id="rings-heading" className="text-base font-semibold" style={{ color: COLORS.text }}>
          Rings &amp; arenas
        </h2>
        <p className="text-sm" style={{ color: COLORS.muted }}>
          {hasVenue ? (
            <>
              Where this show&apos;s classes run. A ring you add here is kept with{' '}
              <strong style={{ color: COLORS.text }}>{venueName}</strong>, and the next show there
              starts with it.
            </>
          ) : (
            <>
              Where this show&apos;s classes run. Pick the show&apos;s venue above and save, and the
              rings you add are kept for the next show there.
            </>
          )}
        </p>
      </div>

      {error && (
        <p className="text-sm" role="alert" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}

      {rings === null ? (
        <p className="text-sm" role="alert" style={{ color: 'var(--error)' }}>
          This show&apos;s rings could not be loaded. Reload the page to try again.
        </p>
      ) : (
        <>
          {rings.length === 0 ? (
            <p className="text-sm" style={{ color: COLORS.muted }}>
              No rings yet.{' '}
              {hasVenue && notRun.length > 0
                ? `Use one of ${venueName}'s below, or add one.`
                : 'Add one below, or the first class makes a “Ring 1”.'}
            </p>
          ) : (
            <ul className="divide-y rounded border" style={{ borderColor: COLORS.subtle }}>
              {rings.map((ring, i) => {
                const classes = ring.class_count ?? 0;
                const editing = renaming?.id === ring.id;
                return (
                  <li
                    key={ring.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                    style={{ borderColor: COLORS.subtle }}
                  >
                    {editing ? (
                      <input
                        autoFocus
                        aria-label={`New name for ${ring.name}`}
                        value={renaming.name}
                        maxLength={100}
                        onChange={(e) => setRenaming({ id: ring.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveRename();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        className="flex-1 min-w-40 border rounded px-2 py-1 text-sm"
                        style={{ borderColor: COLORS.border }}
                      />
                    ) : (
                      <span className="flex-1 min-w-40 text-sm font-medium" style={{ color: COLORS.text }}>
                        {ring.name}
                        {i === 0 && rings.length > 1 && (
                          <span className="ml-2 text-xs font-normal" style={{ color: COLORS.muted }}>
                            new classes go here
                          </span>
                        )}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: COLORS.muted }}>
                      {classes === 0 ? 'No classes yet' : `${classes} class${classes === 1 ? '' : 'es'}`}
                    </span>
                    {hasVenue && ring.venue_ring_id === null && (
                      <span className="text-xs" style={{ color: COLORS.muted }}>
                        This show only ·{' '}
                        <button
                          type="button"
                          onClick={() => void saveToVenue(ring)}
                          disabled={busy}
                          className={buttonClass}
                          style={{ color: COLORS.accent }}
                        >
                          Save to venue
                        </button>
                      </span>
                    )}
                    <span className="flex items-center gap-3">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void saveRename()}
                            disabled={busy}
                            className={buttonClass}
                            style={{ color: COLORS.accent }}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenaming(null)}
                            disabled={busy}
                            className={buttonClass}
                            style={{ color: COLORS.muted }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setRenaming({ id: ring.id, name: ring.name })}
                            disabled={busy}
                            className={buttonClass}
                            style={{ color: COLORS.accent }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(ring)}
                            disabled={busy || classes > 0}
                            title={
                              classes > 0
                                ? `${classes} class${classes === 1 ? ' runs' : 'es run'} in this ring, so it stays.`
                                : hasVenue && ring.venue_ring_id
                                  ? `Takes it off this show. ${venueName} keeps it for the next show.`
                                  : 'Takes it off this show.'
                            }
                            className={`${buttonClass} text-red-600`}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              aria-label="New ring or arena"
              placeholder="Add a ring or arena — Main Arena, Covered Arena…"
              className="flex-1 min-w-48 border rounded px-3 py-2 text-sm"
              style={{ borderColor: COLORS.border }}
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="text-sm rounded px-4 py-2 disabled:opacity-50"
              style={{ backgroundColor: COLORS.accent, color: 'var(--surface)' }}
            >
              Add
            </button>
          </form>

          {hasVenue && notRun.length > 0 && (
            <div className="space-y-2 border-t pt-3" style={{ borderColor: COLORS.subtle }}>
              <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
                Also at {venueName}
              </h3>
              <ul className="space-y-1">
                {notRun.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="flex-1 min-w-40" style={{ color: COLORS.text }}>
                      {v.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => void use(v)}
                      disabled={busy}
                      className={buttonClass}
                      style={{ color: COLORS.accent }}
                    >
                      Use at this show
                    </button>
                    {v.show_count === 0 && (
                      <button
                        type="button"
                        onClick={() => void removeFromVenue(v)}
                        disabled={busy}
                        title="No show runs it. Takes it off the list later shows here are offered."
                        className={`${buttonClass} text-red-600`}
                      >
                        Remove from venue
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
