'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ShowChargesEditor, { type ShowCharge } from '@/components/ShowChargesEditor';

type SanctioningFeeState = { association_id: string; dollars: string };

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

export type SanctioningRow = {
  association_id: string;
  code: string;
  name: string;
  per_class_fee_cents: number;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(input: string): number {
  const n = Number.parseFloat(input);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export default function FeesClient({
  showId,
  initialCharges,
  judgeCount,
  sanctioning,
  sanctionedCounts,
  classCount,
  legacyFuturityFee = null,
  futurityCount = 0,
}: {
  showId: string;
  /** The show's own class fees — office fee, association assessment, all-day
   *  pass, jackpot/sidepot fee, anything else a manager names. Saved by
   *  `ShowChargesEditor` a row at a time rather than by this screen's Save
   *  button — they are `show_fees` rows with their own endpoints, and folding
   *  them into the wizard's batch save would mean re-implementing add, edit and
   *  remove here. */
  initialCharges: ShowCharge[];
  judgeCount: number;
  sanctioning: SanctioningRow[];
  /** How many classes each club actually sanctions, keyed by association id.
   *  Shown next to the amount because the two numbers only mean anything
   *  together: a $3 per-class fee against zero approved classes bills nothing,
   *  and that used to be invisible here. */
  sanctionedCounts: Record<string, number>;
  classCount: number;
  /** A `futurity` fee row from before this screen stopped offering one. Shown
   *  so it can be removed deliberately — a show that also sets up a real
   *  futurity would otherwise bill both, and silently deleting somebody's fee
   *  is not this screen's call to make. */
  legacyFuturityFee?: FeeRow | null;
  futurityCount?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  const [sanctioningFees, setSanctioningFees] = useState<SanctioningFeeState[]>(
    sanctioning.map((s) => ({
      association_id: s.association_id,
      dollars: centsToDollars(s.per_class_fee_cents),
    })),
  );

  function setSanctioningFee(id: string, dollars: string) {
    setSanctioningFees((prev) =>
      prev.map((s) =>
        s.association_id === id ? { ...s, dollars } : s,
      ),
    );
  }

  async function save() {
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      // Class fees save themselves a row at a time in `ShowChargesEditor` —
      // the office charge among them since migration 132 made it an ordinary
      // fee row rather than a column on `shows`. All this button still owns is
      // the club sanctioning amounts below it.
      //
      // Sanctioning per-class fees: PUT replaces the full set, so we send
      // every currently-selected sanction with its (possibly updated) fee.
      if (sanctioningFees.length > 0) {
        const sancRes = await fetch(`/api/shows/${showId}/sanctioning`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: sanctioningFees.map((s) => ({
              association_id: s.association_id,
              per_class_fee_cents: dollarsToCents(s.dollars || '0'),
            })),
          }),
        });
        if (!sancRes.ok) {
          const j = await sancRes.json().catch(() => null);
          setError(j?.detail || 'Failed to update sanctioning fees.');
          return;
        }
      }

      // Classes are Step 6 and the futurity programme is Step 7, so the save
      // carries on through the wizard rather than dropping out to the show.
      router.push(`/admin/shows/${showId}/classes`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {successMsg && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#7fa97f', backgroundColor: '#eef7ee', color: '#1f4e1f' }}
        >
          {successMsg}
        </div>
      )}

      <ShowChargesEditor
        showId={showId}
        initialCharges={initialCharges}
        judgeCount={judgeCount}
        judgesHref={`/admin/shows/${showId}/setup/judges`}
      />

      {/* The clubs picked in Step 3, and what each charges per class it
          approves. Its own box rather than a footnote under the show's own
          class fees: this is a different body's money, on a different set of
          classes, and it is the only thing on this screen the Save button
          below still writes. */}
      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Club Sanctioned Fees
        </h2>
        {sanctioning.length === 0 ? (
          <p className="text-xs" style={{ color: COLORS.muted }}>
            No clubs sanction this show.{' '}
            <Link
              href={`/admin/shows/${showId}/setup/sanctioning`}
              className="underline"
              style={{ color: COLORS.warn }}
            >
              Add sanctioning associations in Step 3
            </Link>{' '}
            to set per-class fees here.
          </p>
        ) : (
          <>
            <p className="text-xs" style={{ color: COLORS.muted }}>
              Each club&apos;s per-class fee, added on top of the class fee — but
              only on the classes that club actually approves. A club sanctions a
              list of classes, not the whole schedule, so nothing is charged until
              you say which ones in{' '}
              <Link
                href={`/admin/shows/${showId}/classes/sanctioning`}
                className="underline"
                style={{ color: COLORS.warn }}
              >
                Sanctioned Classes
              </Link>
              . These amounts save with the button at the foot of the step, not on
              their own — the class fees above each save as you set them.
            </p>
            {sanctioning.map((s) => {
              const fee = sanctioningFees.find(
                (f) => f.association_id === s.association_id,
              );
              return (
                <div
                  key={s.association_id}
                  className="grid sm:grid-cols-[1fr_8rem_1fr] gap-3 items-end"
                >
                  <span>
                    <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                      {s.name}
                    </span>
                    <span className="font-mono text-xs" style={{ color: '#8b4513' }}>
                      {s.code} per-class fee
                    </span>
                    <span className="block text-xs mt-0.5" style={{ color: COLORS.muted }}>
                      {sanctionedCounts[s.association_id] ?? 0} of{' '}
                      {classCount} classes marked {s.code}-approved
                    </span>
                  </span>
                  <label className="block">
                    <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
                      Amount ($)
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={fee?.dollars ?? ''}
                      onChange={(e) =>
                        setSanctioningFee(s.association_id, e.target.value)
                      }
                      className="w-full border rounded px-3 py-2"
                      style={{ borderColor: COLORS.border }}
                      placeholder="e.g. 3.00"
                    />
                  </label>
                  <span />
                </div>
              );
            })}
          </>
        )}
      </section>

      <section
        className="p-4 rounded-lg border space-y-3"
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
      >
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Futurity
        </h2>
        <p className="text-sm" style={{ color: COLORS.muted }}>
          A futurity is not a fee. It runs its own classes at its own prices —
          the same class costs different money depending on which category the
          entrant qualifies for — closes entries on a stated day, charges an
          office fee per horse that depends on club membership, and hands out
          Hi-Point awards. All of that is set up in{' '}
          <Link
            href={`/admin/shows/${showId}/futurities`}
            className="underline"
            style={{ color: COLORS.warn }}
          >
            Step 7
          </Link>
          .
        </p>

        {legacyFee && (
          <div
            className="rounded border px-3 py-2 text-sm space-y-2"
            style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
          >
            <p>
              <strong>This show still carries an old flat futurity fee</strong> of{' '}
              {centsToDollars(legacyFee.amount_cents)} per entry, from before
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
              style={{ borderColor: '#c0392b', backgroundColor: '#fff', color: '#922' }}
            >
              {removingLegacy ? 'Removing…' : 'Remove the old futurity fee'}
            </button>
          </div>
        )}

        <Link
          href={`/admin/shows/${showId}/futurities`}
          className="inline-block text-sm rounded px-4 py-2"
          style={{ backgroundColor: COLORS.text, color: '#f5ede0' }}
        >
          {futurityCount > 0
            ? `Futurities (${futurityCount}) →`
            : '+ Add a futurity'}
        </Link>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-sm rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: COLORS.warn, color: '#fff' }}
        >
          {busy ? 'Saving…' : 'Save & continue to Classes →'}
        </button>
      </div>
    </div>
  );
}
