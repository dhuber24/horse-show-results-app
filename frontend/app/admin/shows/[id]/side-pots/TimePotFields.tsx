'use client';

/**
 * The added money every pot can have, and the Ds of a pot paid on time
 * (migration 205), shared by the Create form and the pot's Settings.
 *
 * A barrel sidepot takes each run's time from the class it was run in, splits
 * the field into Ds behind the fastest time, and shares the pool between the Ds
 * — "$1,000 Added SIDEPOT 5D Barrels, 1/2 second splits, 75% payout". The
 * shares are typed as a list ("30, 25, 20, 15, 10") because bills rarely print
 * them and the office reads them off the show's own rules.
 */

import { defaultDPercents, type ScoringMethod } from './pot-shared';

export interface TimePotState {
  addedDollars: string;
  dCount: string;
  dSplitSeconds: string;
  dPercents: string;
}

export function timePotState(pot?: {
  added_money_cents?: number;
  d_count?: number;
  d_split_ms?: number;
  d_percents?: number[];
}): TimePotState {
  const count = pot?.d_count ?? 1;
  return {
    addedDollars: ((pot?.added_money_cents ?? 0) / 100).toFixed(2),
    dCount: String(count),
    dSplitSeconds: String((pot?.d_split_ms ?? 500) / 1000),
    dPercents: (pot?.d_percents ?? defaultDPercents(count)).join(', '),
  };
}

/** The request fields, or the reason they cannot be saved. */
export function timePotPayload(
  state: TimePotState,
  scoringMethod: ScoringMethod,
):
  | {
      ok: true;
      body: {
        added_money_cents: number;
        d_count?: number;
        d_split_ms?: number;
        d_percents?: number[];
      };
    }
  | { ok: false; error: string } {
  const added = Math.round(parseFloat(state.addedDollars || '0') * 100);
  if (Number.isNaN(added) || added < 0) return { ok: false, error: 'Added money must be a non-negative number.' };
  if (scoringMethod !== 'fastest_time') return { ok: true, body: { added_money_cents: added } };

  const count = parseInt(state.dCount, 10);
  if (Number.isNaN(count) || count < 1 || count > 10) {
    return { ok: false, error: 'The number of Ds must be between 1 and 10.' };
  }
  const splitMs = Math.round(parseFloat(state.dSplitSeconds) * 1000);
  if (Number.isNaN(splitMs) || splitMs <= 0) {
    return { ok: false, error: 'The D split must be more than 0 seconds.' };
  }
  const shares = state.dPercents
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map((x) => parseInt(x, 10));
  if (shares.length !== count || shares.some((x) => Number.isNaN(x) || x < 0)) {
    return { ok: false, error: `Give one share per D: ${count} numbers, fastest D first.` };
  }
  const total = shares.reduce((a, b) => a + b, 0);
  if (total !== 100) return { ok: false, error: `The Ds' shares must add up to 100%, not ${total}%.` };
  return {
    ok: true,
    body: { added_money_cents: added, d_count: count, d_split_ms: splitMs, d_percents: shares },
  };
}

export default function TimePotFields({
  state,
  onChange,
  scoringMethod,
}: {
  state: TimePotState;
  onChange: (next: TimePotState) => void;
  scoringMethod: ScoringMethod;
}) {
  const set = (patch: Partial<TimePotState>) => onChange({ ...state, ...patch });
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm text-gray-500 block mb-1">Added money ($)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={state.addedDollars}
          onChange={(e) => set({ addedDollars: e.target.value })}
          className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
          title="Money the show adds to the pool, paid out on top of the buy-ins' payback"
        />
      </div>
      {scoringMethod === 'fastest_time' && (
        <>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm text-gray-500 block mb-1">Ds</label>
              <input
                type="number"
                min="1"
                max="10"
                value={state.dCount}
                onChange={(e) => {
                  const count = parseInt(e.target.value, 10);
                  set({
                    dCount: e.target.value,
                    // A new D count takes that count's shares; the office edits them after.
                    ...(count >= 1 && count <= 10 ? { dPercents: defaultDPercents(count).join(', ') } : {}),
                  });
                }}
                className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
                title="5 for a 5D, 4 for a 4D, 1 for one field where the fastest time wins"
              />
            </div>
            <div className="flex-1">
              <label className="text-sm text-gray-500 block mb-1">Split (seconds)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={state.dSplitSeconds}
                onChange={(e) => set({ dSplitSeconds: e.target.value })}
                className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
                title="How far behind the fastest time each D starts: 0.5 for half-second splits"
              />
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-500 block mb-1">Each D&rsquo;s share of the pool (%)</label>
            <input
              value={state.dPercents}
              onChange={(e) => set({ dPercents: e.target.value })}
              placeholder="30, 25, 20, 15, 10"
              className="w-full border rounded px-3 py-2 disabled:bg-gray-50"
              title="Fastest D first, adding up to 100"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Fastest D first. Each D pays places by the payout schedule for how many bought in.
              Money a D can&rsquo;t pay — no runners, or fewer runners than places — is shared
              over the Ds that have runners, by these shares.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
