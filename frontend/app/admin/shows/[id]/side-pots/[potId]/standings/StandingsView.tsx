'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ELIGIBILITY_LABEL,
  SCORING_LABEL,
  formatCents,
  type Payout,
  type SidePot,
  type Standings,
} from '../../pot-shared';

/**
 * The live ranking, the settle control, and the frozen payout sheet.
 *
 * One client component because the three share state: settling turns the
 * projected column into the payout sheet and takes the button away, and the
 * settle panel counts paid and eligible entries off the standings above it.
 */
export default function StandingsView({
  showId,
  pot: initialPot,
  initialStandings,
  initialPayouts,
}: {
  showId: string;
  pot: SidePot;
  initialStandings: Standings | null;
  initialPayouts: Payout[];
}) {
  const [pot, setPot] = useState(initialPot);
  const [standings, setStandings] = useState(initialStandings);
  const [payouts, setPayouts] = useState(initialPayouts);

  const isSettled = pot.status === 'settled';

  const refreshStandings = async () => {
    const res = await fetch(`/api/shows/${showId}/side-pots/${pot.id}/standings`);
    if (res.ok) setStandings(await res.json());
  };

  return (
    <div className="space-y-6">
      <StandingsTable
        pot={pot}
        standings={standings}
        onRefresh={refreshStandings}
        settled={isSettled}
      />

      {!isSettled && (
        <SettlePanel
          showId={showId}
          pot={pot}
          standings={standings}
          onSettled={(settledPot, settledPayouts) => {
            setPot(settledPot);
            setPayouts(settledPayouts);
          }}
        />
      )}

      {payouts.length > 0 && <PayoutsTable payouts={payouts} />}
    </div>
  );
}

function StandingsTable({
  pot,
  standings,
  onRefresh,
  settled,
}: {
  pot: SidePot;
  standings: Standings | null;
  onRefresh: () => void;
  settled: boolean;
}) {
  if (!standings || standings.standings.length === 0) {
    return (
      <section className="border rounded-lg p-4" style={{ borderColor: '#d4b896' }}>
        <p className="text-sm" style={{ color: '#8b7355' }}>
          {standings === null
            ? 'Standings will appear once the bundled classes have results.'
            : 'Nobody is in this pot yet, so there is nothing to rank.'}
        </p>
      </section>
    );
  }

  return (
    <section className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold" style={{ color: '#2c1810' }}>
          {settled ? 'Final ranking' : 'Live ranking'}
        </h2>
        {!settled && (
          <button
            onClick={onRefresh}
            className="text-xs hover:underline"
            style={{ color: '#8b4513' }}
          >
            Refresh
          </button>
        )}
      </div>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        {SCORING_LABEL[pot.scoring_method]}. {ELIGIBILITY_LABEL[pot.eligibility_rule]}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: '#e8d5b7' }}>
              <th className="text-left py-1">Place</th>
              <th className="text-left py-1">Back #</th>
              <th className="text-left py-1">Exhibitor</th>
              <th className="text-right py-1">
                {pot.scoring_method === 'sum_scores' ? 'Score sum' : 'Place sum'}
              </th>
              {/* Projections are live. Once settled, the money is whatever the
                  frozen payout sheet below says — a second, recomputed money
                  column could quietly disagree with it if results are corrected
                  after the fact. */}
              {!settled && <th className="text-right py-1">Projected</th>}
            </tr>
          </thead>
          <tbody>
            {standings.standings.map((s) => {
              const key =
                s.back_number != null ? String(s.back_number) : s.show_entry_id;
              const projected = standings.projected_payouts[key] ?? 0;
              return (
                <tr
                  key={s.show_entry_id}
                  className="border-b"
                  style={{
                    borderColor: '#f0e6d2',
                    color: s.is_eligible ? '#2c1810' : '#999',
                  }}
                >
                  <td className="py-1">{s.is_eligible ? s.place ?? '—' : 'DQ'}</td>
                  <td className="py-1 font-mono">#{s.back_number ?? '—'}</td>
                  <td className="py-1">
                    {s.exhibitor_name ?? '—'}
                    {!s.is_eligible && s.missing_class_ids.length > 0 && (
                      <span className="text-xs ml-2" style={{ color: '#b45309' }}>
                        Missing {s.missing_class_ids.length} class
                        {s.missing_class_ids.length === 1 ? '' : 'es'}
                      </span>
                    )}
                    {!s.paid && (
                      <span className="text-xs ml-2" style={{ color: '#b45309' }}>
                        Unpaid
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {s.aggregate_value.toFixed(
                      pot.scoring_method === 'sum_scores' ? 2 : 0,
                    )}
                  </td>
                  {!settled && (
                    <td className="py-1 text-right tabular-nums">
                      {projected ? formatCents(projected) : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        Payout pool: {formatCents(standings.payout_pool_cents)} of{' '}
        {formatCents(standings.total_pool_cents)} in paid buy-ins.
        {settled && ' The payouts below are what was written when the pot settled.'}
      </p>
    </section>
  );
}

function SettlePanel({
  showId,
  pot,
  standings,
  onSettled,
}: {
  showId: string;
  pot: SidePot;
  standings: Standings | null;
  onSettled: (pot: SidePot, payouts: Payout[]) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSettle = async () => {
    setError(null);
    setWorking(true);
    const res = await fetch(`/api/shows/${showId}/side-pots/${pot.id}/settle`, {
      method: 'POST',
    });
    setWorking(false);
    if (res.ok) {
      const newPayouts: Payout[] = await res.json();
      onSettled(
        { ...pot, status: 'settled', settled_at: new Date().toISOString() },
        newPayouts,
      );
      setConfirming(false);
      router.refresh();
    } else {
      const err = await res.json().catch(() => ({}));
      setError(err.detail ?? 'Failed to settle pot.');
    }
  };

  const paidCount = standings ? standings.standings.filter((s) => s.paid).length : 0;
  const eligibleCount = standings
    ? standings.standings.filter((s) => s.is_eligible).length
    : 0;

  return (
    <section
      className="border rounded-lg p-4 space-y-2"
      style={{ borderColor: '#d4b896', backgroundColor: '#fffaf0' }}
    >
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>
        Settle pot
      </h2>
      <p className="text-sm" style={{ color: '#5c3d1e' }}>
        Freezes the ranking above, writes the payouts, and locks the pot. This cannot be
        undone.
      </p>
      <p className="text-xs" style={{ color: '#8b7355' }}>
        {paidCount} {paidCount === 1 ? 'entry' : 'entries'} in the pool · {eligibleCount}{' '}
        eligible for a payout
      </p>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {confirming ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleSettle}
            disabled={working}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#7c3a0c', color: '#fff' }}
          >
            {working ? 'Settling…' : 'Yes, settle'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={working}
            className="text-sm hover:underline"
            style={{ color: '#8b7355' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="px-4 py-2 rounded text-sm font-medium border"
          style={{ borderColor: '#7c3a0c', color: '#7c3a0c' }}
        >
          Settle pot…
        </button>
      )}
    </section>
  );
}

function PayoutsTable({ payouts }: { payouts: Payout[] }) {
  return (
    <section className="border rounded-lg p-4 space-y-2" style={{ borderColor: '#d4b896' }}>
      <h2 className="font-semibold" style={{ color: '#2c1810' }}>
        Payouts (frozen)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: '#e8d5b7' }}>
              <th className="text-left py-1">Place</th>
              <th className="text-left py-1">Back #</th>
              <th className="text-left py-1">Exhibitor</th>
              <th className="text-right py-1">Aggregate</th>
              <th className="text-right py-1">Payout</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b" style={{ borderColor: '#f0e6d2' }}>
                <td className="py-1">{p.place}</td>
                <td className="py-1 font-mono">#{p.back_number ?? '—'}</td>
                <td className="py-1">
                  {p.exhibitor_name ?? '—'}
                  {p.tiebreaker_notes && (
                    <span
                      className="text-xs ml-2"
                      style={{ color: '#8b7355' }}
                      title={p.tiebreaker_notes}
                    >
                      (tied)
                    </span>
                  )}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {p.aggregate_value.toFixed(2)}
                </td>
                <td className="py-1 text-right font-medium tabular-nums">
                  {formatCents(p.payout_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
