'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { AutosaveNavLink } from './StepAutosave';

/** Record, or take back, that something does not apply to this show
 *  (migration 154). Several keys at once for a step that sets up two things. */
async function setSkipped(showId: string, keys: string[], skipped: boolean): Promise<void> {
  for (const key of keys) {
    const res = await fetch(`/api/shows/${showId}/setup-skips/${key}`, { method: skipped ? 'PUT' : 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(errorMessage(body, skipped ? 'The skip could not be saved.' : 'The step could not be brought back.'));
    }
  }
}

/**
 * *Skip — no club sanctioning →*. Records the answer and then goes where Next
 * goes. Recording it is the whole difference from the old skip, which was a
 * link: the wizard folds the step away afterwards, and a step with a dashboard
 * tile greys that tile out, instead of both asking again every time somebody
 * manages the show.
 */
export function SkipStepOffer({
  showId,
  keys,
  nextHref,
  label,
  note,
}: {
  showId: string;
  keys: string[];
  nextHref: string;
  label: string;
  note: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      className="rounded-lg border p-3 space-y-2"
      style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-bg)' }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AutosaveNavLink
          href={nextHref}
          before={async () => {
            setError(null);
            try {
              await setSkipped(showId, keys, true);
            } catch (e) {
              setError((e as Error).message);
              throw e;
            }
          }}
          className="text-sm font-semibold rounded px-3 py-2 border shrink-0"
          style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--surface)', color: 'var(--accent)' }}
        >
          {label} →
        </AutosaveNavLink>
        <span className="text-sm" style={{ color: 'var(--muted)' }}>
          {note} Skipping folds this step away in the list.
        </span>
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}

/**
 * Standing on a step that was skipped. Says what the skip did — so nobody
 * wonders why the step was tucked away or a dashboard tile is grey — and offers
 * the two ways back: add something (the skip stops counting on its own), or
 * bring the step back empty.
 */
export function SkippedStepNotice({
  showId,
  keys,
  dashboardTiles,
}: {
  showId: string;
  keys: string[];
  /** What the skip greys out on the show dashboard, e.g. "the Futurities and
   *  Side Pots tiles". */
  dashboardTiles?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await setSkipped(showId, keys, false);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div
      className="rounded-lg border border-dashed p-3 space-y-2 text-sm"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
    >
      <p>
        <span className="font-semibold">Skipped — not used at this show.</span> It is folded away in
        the step list
        {dashboardTiles ? <>, and {dashboardTiles} on the show dashboard {dashboardTiles.endsWith('tiles') ? 'are' : 'is'} greyed out</> : null}.
        Add something here and it comes back on its own.
      </p>
      <button
        type="button"
        onClick={restore}
        disabled={busy}
        className="text-sm font-medium rounded px-3 py-1.5 border disabled:opacity-50"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' }}
      >
        {busy ? 'Bringing it back…' : 'Bring this step back'}
      </button>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}

/**
 * One feature on a step that sets up two — "No side pots at this show". The
 * Futurities & Side Pots step asks about each separately, because plenty of
 * shows run a futurity and no jackpot, or the other way round, and each has its
 * own tile on the show dashboard to grey out. Shown only while the feature has
 * nothing set up: once a pot exists, there is nothing to decline.
 */
export function DeclineFeature({
  showId,
  feature,
  declined,
  question,
  action,
  tile,
}: {
  showId: string;
  feature: string;
  declined: boolean;
  /** "Not running a futurity at this show?" */
  question: string;
  /** "No futurity at this show" */
  action: string;
  /** The dashboard tile it greys out, e.g. "Futurities". */
  tile: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await setSkipped(showId, [feature], !declined);
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="text-sm space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: 'var(--muted)' }}>
        {declined ? (
          <span>
            Marked as not used at this show — the {tile} tile on the show dashboard is greyed out.
            Add one below and it comes back.
          </span>
        ) : (
          <span>{question}</span>
        )}
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className="font-medium rounded px-2.5 py-1 border disabled:opacity-50"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--accent)' }}
        >
          {busy ? 'Saving…' : declined ? 'Undo' : action}
        </button>
      </div>
      {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
    </div>
  );
}
