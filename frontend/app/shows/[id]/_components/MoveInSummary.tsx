import { periodWindow, type StallPeriod } from '@/lib/stall-periods';
import {
  earlyMoveInPass,
  formatStallsOpen,
  passBasisLabel,
  passMoveIn,
  periodPass,
} from '@/lib/stalls-open';

/**
 * When and how exhibitors move in, worded once for every page that says it —
 * Show Details' *Move-in* row and the show bill's *Move-in* fact — so the two
 * cannot drift apart (the sign-up form says the same things beside the stalls
 * being booked, from the same `lib/stalls-open.ts` and `lib/stall-periods.ts`).
 *
 * Move-in is set by stall period, so this lists each period's move-in and
 * move-out, its own Early Move-In Pass, and its own move-in notes as typed
 * (migration 199: each period can have different instructions); "stalls open"
 * is the first of those move-ins (the backend keeps it so) and is not said a
 * second time. A show without periods — one set up before them, whose office
 * has not opened the Lodging step since — says when stalls open and its one
 * pass, as it did.
 */

export type MoveInFee = {
  id: string;
  code: string;
  unit: string;
  amount_cents: number;
  stall_period_id?: string | null;
  move_in_date?: string | null;
  move_in_time?: string | null;
  /** When that window closes (migration 203). */
  move_in_end_date?: string | null;
  move_in_end_time?: string | null;
  one_per_exhibitor?: boolean;
  /** The pass's own wording: limited, one trailer per pass. */
  notes?: string | null;
};

type Props = {
  stallsOpenDate?: string | null;
  stallsOpenTime?: string | null;
  periods: StallPeriod[];
  fees: MoveInFee[];
};

function money(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** "$35.00 per stall, added at sign-up — move in from Tuesday, September 21 at
 *  2:00 PM until 4:00 PM. Limited, one trailer per pass." */
export function passSummary(pass: MoveInFee): string {
  const from = passMoveIn(pass);
  const notes = pass.notes?.trim();
  return `${money(pass.amount_cents)} ${passBasisLabel(pass)}, added at sign-up${
    from ? ` — move in from ${from}` : ''
  }.${notes ? ` ${notes}` : ''}`;
}

/** Whether there is anything to say at all, so a page can leave the row out. */
export function hasMoveInSummary({ stallsOpenDate, periods, fees }: Props): boolean {
  return Boolean(stallsOpenDate || periods.length > 0 || earlyMoveInPass(fees));
}

export default function MoveInSummary({ stallsOpenDate, stallsOpenTime, periods, fees }: Props) {
  const wholeShowPass = earlyMoveInPass(fees);
  const stallsOpen = formatStallsOpen(stallsOpenDate, stallsOpenTime);
  return (
    <div className="space-y-1">
      {periods.length > 0 ? (
        periods.map((period) => {
          const pass = periodPass(fees, period.id);
          return (
            <div key={period.id}>
              <div>
                <span className="font-medium">{period.name}:</span> {periodWindow(period)}
              </div>
              {pass && (
                <div style={{ color: 'var(--muted)' }}>Early move-in: {passSummary(pass)}</div>
              )}
              {period.move_in_notes?.trim() && (
                <div className="whitespace-pre-wrap">{period.move_in_notes}</div>
              )}
            </div>
          );
        })
      ) : (
        stallsOpen && <div>Stalls open {stallsOpen}.</div>
      )}
      {wholeShowPass && (
        <div style={{ color: 'var(--muted)' }}>Early Move-In Pass: {passSummary(wholeShowPass)}</div>
      )}
    </div>
  );
}
