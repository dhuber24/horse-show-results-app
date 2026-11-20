'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ELIGIBILITY_LABEL,
  SCORING_LABEL,
  dSummary,
  formatCents,
  type Payout,
  type SidePot,
  type Standings,
} from '../../pot-shared';
import { backNumbersLabel } from '@/lib/back-numbers';
import { errorMessage } from '@/lib/api-error';

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

      {payouts.length > 0 && <PayoutsTable payouts={payouts} perRun={pot.per_run ?? false} />}
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
  if (pot.per_run && standings && standings.standings.length > 0) {
    return <TimeStandingsTable pot={pot} standings={standings} onRefresh={onRefresh} settled={settled} />;
  }
  if (!standings || standings.standings.length === 0) {
    return (
      <section className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {standings === null
            ? 'Standings will appear once the bundled classes have results.'
            : 'Nobody is in this pot yet, so there is nothing to rank.'}
        </p>
      </section>
    );
  }

  return (
    <section className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
          {settled ? 'Final ranking' : 'Live ranking'}
        </h2>
        {!settled && (
          <button
            onClick={onRefresh}
            className="text-xs hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Refresh
          </button>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {SCORING_LABEL[pot.scoring_method]}. {ELIGIBILITY_LABEL[pot.eligibility_rule]}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
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
              // Keyed by roster row first: at a show that numbers horses two
              // exhibitors can share a lowest number (migration 161). The
              // back-number key is for a backend from before that.
              const projected =
                standings.projected_payouts[s.show_entry_id] ??
                (s.back_number != null ? standings.projected_payouts[String(s.back_number)] : undefined) ??
                0;
              return (
                <tr
                  key={s.show_entry_id}
                  className="border-b"
                  style={{
                    borderColor: 'var(--bg-subtle)',
                    color: s.is_eligible ? 'var(--foreground)' : 'var(--text-dimmed)',
                  }}
                >
                  <td className="py-1">{s.is_eligible ? s.place ?? '—' : 'DQ'}</td>
                  <td className="py-1 font-mono">{backNumbersLabel(s, '#') ?? '#—'}</td>
                  <td className="py-1">
                    {s.exhibitor_name ?? '—'}
                    {!s.is_eligible && s.missing_class_ids.length > 0 && (
                      <span className="text-xs ml-2" style={{ color: 'var(--warning)' }}>
                        Missing {s.missing_class_ids.length} class
                        {s.missing_class_ids.length === 1 ? '' : 'es'}
                      </span>
                    )}
                    {!s.paid && (
                      <span className="text-xs ml-2" style={{ color: 'var(--warning)' }}>
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
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Payout pool: {formatCents(standings.payout_pool_cents)} of{' '}
        {formatCents(standings.total_pool_cents)} in paid buy-ins.
        {settled && ' The payouts below are what was written when the pot settled.'}
      </p>
    </section>
  );
}

/** "16.482" — a run's time as the timer printed it. */
const formatTime = (seconds: number) => seconds.toFixed(3);

/**
 * A pot paid on time (migration 205): one row per run, grouped into Ds behind
 * the fastest time, with each D's share of the pool once unclaimed D money has
 * been spread. Unpaid runs are ranked for the office to see but take no money
 * and never move the D lines.
 */
function TimeStandingsTable({
  pot,
  standings,
  onRefresh,
  settled,
}: {
  pot: SidePot;
  standings: Standings;
  onRefresh: () => void;
  settled: boolean;
}) {
  const lines = standings.d_lines ?? [];
  const unranked = standings.standings.filter((s) => s.d_number == null);
  return (
    <section className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
          {settled ? 'Final ranking' : 'Live ranking'}
        </h2>
        {!settled && (
          <button onClick={onRefresh} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>
            Refresh
          </button>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {SCORING_LABEL[pot.scoring_method]} · {dSummary(pot)}. Each run counts the time it made in its
        class.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              <th className="text-left py-1">Place</th>
              <th className="text-left py-1">Back #</th>
              <th className="text-left py-1">Run</th>
              <th className="text-right py-1">Time</th>
              <th className="text-right py-1">Behind</th>
              {!settled && <th className="text-right py-1">Projected</th>}
            </tr>
          </thead>
          {lines.map((line) => {
            const rows = standings.standings.filter((s) => s.d_number === line.d_number);
            return (
              <tbody key={line.d_number}>
                <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                  <td colSpan={settled ? 5 : 6} className="py-1 px-1 text-xs font-medium" style={{ color: 'var(--text-deep)' }}>
                    {line.d_number}D
                    {line.from_time != null && ` · from ${formatTime(line.from_time)}`} · {line.percent}% of the pool ·{' '}
                    {line.runners} {line.runners === 1 ? 'run' : 'runs'}
                    {!settled && ` · pays ${formatCents(line.amount_cents)}`}
                  </td>
                </tr>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={settled ? 5 : 6} className="py-1 text-xs" style={{ color: 'var(--muted)' }}>
                      Nobody in this D — its share goes to the Ds that have runners.
                    </td>
                  </tr>
                ) : (
                  rows.map((s) => (
                    <TimeRow key={s.side_pot_entry_id ?? s.show_entry_id} s={s} standings={standings} settled={settled} />
                  ))
                )}
              </tbody>
            );
          })}
          {unranked.length > 0 && (
            <tbody>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <td colSpan={settled ? 5 : 6} className="py-1 px-1 text-xs font-medium" style={{ color: 'var(--text-deep)' }}>
                  No time yet — not run, no time, or disqualified
                </td>
              </tr>
              {unranked.map((s) => (
                <TimeRow key={s.side_pot_entry_id ?? s.show_entry_id} s={s} standings={standings} settled={settled} />
              ))}
            </tbody>
          )}
        </table>
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Payout pool: {formatCents(standings.payout_pool_cents)} —{' '}
        {pot.payback_percent}% of {formatCents(standings.total_pool_cents)} in paid buy-ins
        {(standings.added_money_cents ?? 0) > 0 && ` plus ${formatCents(standings.added_money_cents ?? 0)} added`}.
        {(standings.unawarded_cents ?? 0) > 0 &&
          ` ${formatCents(standings.unawarded_cents ?? 0)} has no place to go yet (no times, or a payout schedule under 100%); the office decides what happens to it.`}
        {settled && ' The payouts below are what was written when the pot settled.'}
      </p>
    </section>
  );
}

function TimeRow({ s, standings, settled }: { s: Standings['standings'][number]; standings: Standings; settled: boolean }) {
  const projected = s.side_pot_entry_id ? standings.projected_payouts[s.side_pot_entry_id] ?? 0 : 0;
  return (
    <tr
      className="border-b"
      style={{ borderColor: 'var(--bg-subtle)', color: s.is_eligible ? 'var(--foreground)' : 'var(--text-dimmed)' }}
    >
      <td className="py-1">{s.is_eligible && s.paid ? (s.place ?? '—') : '—'}</td>
      <td className="py-1 font-mono">{backNumbersLabel(s, '#') ?? '#—'}</td>
      <td className="py-1">
        {s.exhibitor_name ?? '—'}
        {s.run_label && (
          <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
            {s.run_label}
          </span>
        )}
        {!s.paid && (
          <span className="text-xs ml-2" style={{ color: 'var(--warning)' }}>
            Unpaid — not in the pool
          </span>
        )}
      </td>
      <td className="py-1 text-right tabular-nums">{s.is_eligible ? formatTime(s.aggregate_value) : '—'}</td>
      <td className="py-1 text-right tabular-nums">
        {s.behind_ms != null ? `+${(s.behind_ms / 1000).toFixed(3)}` : '—'}
      </td>
      {!settled && <td className="py-1 text-right tabular-nums">{projected ? formatCents(projected) : '—'}</td>}
    </tr>
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
      setError(errorMessage(err, 'Failed to settle pot.'));
    }
  };

  const paidCount = standings ? standings.standings.filter((s) => s.paid).length : 0;
  const eligibleCount = standings
    ? standings.standings.filter((s) => s.is_eligible).length
    : 0;

  return (
    <section
      className="border rounded-lg p-4 space-y-2"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
        Settle pot
      </h2>
      <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
        Freezes the ranking above, writes the payouts, and locks the pot. This cannot be
        undone.
      </p>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
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
            style={{ backgroundColor: 'var(--warning-strong)', color: 'var(--surface)' }}
          >
            {working ? 'Settling…' : 'Yes, settle'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={working}
            className="text-sm hover:underline"
            style={{ color: 'var(--muted)' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="px-4 py-2 rounded text-sm font-medium border"
          style={{ borderColor: 'var(--warning-strong)', color: 'var(--warning-strong)' }}
        >
          Settle pot…
        </button>
      )}
    </section>
  );
}

function PayoutsTable({ payouts, perRun }: { payouts: Payout[]; perRun: boolean }) {
  return (
    <section className="border rounded-lg p-4 space-y-2" style={{ borderColor: 'var(--border)' }}>
      <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>
        Payouts (frozen)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border-subtle)' }}>
              {perRun && <th className="text-left py-1">D</th>}
              <th className="text-left py-1">Place</th>
              <th className="text-left py-1">Back #</th>
              <th className="text-left py-1">Exhibitor</th>
              <th className="text-right py-1">{perRun ? 'Time' : 'Aggregate'}</th>
              <th className="text-right py-1">Payout</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b" style={{ borderColor: 'var(--bg-subtle)' }}>
                {perRun && <td className="py-1">{p.d_number != null ? `${p.d_number}D` : '—'}</td>}
                <td className="py-1">{p.place}</td>
                <td className="py-1 font-mono">{backNumbersLabel(p, '#') ?? '#—'}</td>
                <td className="py-1">
                  {p.exhibitor_name ?? '—'}
                  {p.run_label && (
                    <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
                      {p.run_label}
                    </span>
                  )}
                  {p.tiebreaker_notes && (
                    <span
                      className="text-xs ml-2"
                      style={{ color: 'var(--muted)' }}
                      title={p.tiebreaker_notes}
                    >
                      (tied)
                    </span>
                  )}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {p.aggregate_value.toFixed(perRun ? 3 : 2)}
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
