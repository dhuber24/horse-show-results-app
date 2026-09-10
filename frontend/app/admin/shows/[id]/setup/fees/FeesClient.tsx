'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ShowChargesEditor, { type ScopeClass, type ShowCharge } from '@/components/ShowChargesEditor';

/** A raw `show_fees` row, the shape a legacy pre-107 futurity fee still needs
 *  (see `legacyFuturityFee` below) — everything else that used to read this
 *  shape (the Standard/Jackpot slots) now lives in `ShowChargesEditor`. */
export type FeeRow = {
  id: string;
  code: string;
  label: string;
  amount_cents: number;
  unit: string;
  notes: string | null;
};

export type { ShowCharge };

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The show's own class fees, and nothing else.
 *
 * Two things left this screen. The **Club Sanctioned Fees** box went to the
 * Sanctioning step, where the clubs are picked and their classes designated:
 * what a club charges per class is meaningless apart from which classes it
 * approves, and splitting the three questions across three screens is what made
 * a $3 fee against zero approved classes look like a working sanction.
 *
 * The **Save & continue to Classes** button went with it. Once the sanctioning
 * amounts moved, it wrote nothing — every class fee above it already saves a row
 * at a time — so it was a Save button that saved nothing sitting next to a Next
 * link that goes to the same place. Leaving the step now writes whatever
 * `ShowChargesEditor` has unsaved; see `setup/_lib/StepAutosave.tsx`.
 */
export default function FeesClient({
  showId,
  initialCharges,
  judgeCount,
  classes,
  legacyFuturityFee = null,
  futurityCount = 0,
}: {
  showId: string;
  /** The show's own class fees — office fee, association assessment, all-day
   *  pass, jackpot/sidepot fee, anything else a manager names. Saved by
   *  `ShowChargesEditor` a row at a time; they are `show_fees` rows with their
   *  own endpoints, and folding them into a batch save here would mean
   *  re-implementing add, edit and remove. */
  initialCharges: ShowCharge[];
  judgeCount: number;
  /** The show's classes, for narrowing an automatic charge to some of them.
   *  Empty until Step 5 builds them, which is the ordinary case here. */
  classes: ScopeClass[];
  /** A `futurity` fee row from before this screen stopped offering one. Shown
   *  so it can be removed deliberately — a show that also sets up a real
   *  futurity would otherwise bill both, and silently deleting somebody's fee
   *  is not this screen's call to make. */
  legacyFuturityFee?: FeeRow | null;
  futurityCount?: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [legacyFee, setLegacyFee] = useState<FeeRow | null>(legacyFuturityFee);
  const [removingLegacy, setRemovingLegacy] = useState(false);

  async function removeLegacyFuturityFee() {
    if (!legacyFee) return;
    setError(null);
    setRemovingLegacy(true);
    try {
      const res = await fetch(`/api/shows/${showId}/fees/${legacyFee.id}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || 'Could not remove that fee.');
        return;
      }
      setLegacyFee(null);
      router.refresh();
    } finally {
      setRemovingLegacy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
          role="alert"
        >
          {error}
        </div>
      )}

      <ShowChargesEditor
        showId={showId}
        initialCharges={initialCharges}
        judgeCount={judgeCount}
        judgesHref={`/admin/shows/${showId}/setup/judges`}
        classes={classes}
      />

      {legacyFee && (
        <div
          className="rounded border px-3 py-2 text-sm space-y-2"
          style={{ borderColor: 'var(--error)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}
        >
          <p>
            <strong>This show still carries an old flat futurity fee</strong> of{' '}
            {centsToDollars(legacyFee.amount_cents)} per class, from before
            futurities were their own programme.
            {futurityCount > 0
              ? ' It is charged on top of the futurity’s own pricing, so every entrant is being billed twice.'
              : ' Remove it once the futurity is set up in Step 7, or entrants will be billed for both.'}
          </p>
          <button
            type="button"
            onClick={removeLegacyFuturityFee}
            disabled={removingLegacy}
            className="text-sm rounded px-3 py-1.5 border disabled:opacity-50"
            style={{ borderColor: 'var(--error)', backgroundColor: 'var(--surface)', color: 'var(--error-strong)' }}
          >
            {removingLegacy ? 'Removing…' : 'Remove the old futurity fee'}
          </button>
        </div>
      )}
    </div>
  );
}
