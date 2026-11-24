'use client';

import { formatMoney } from '@/lib/financials';
import { COLORS } from './types';
import type { Desk, DeskExhibitor } from './types';

type Run = (key: string, fn: () => Promise<Response>, fallback: string) => Promise<boolean>;

const KIND = 'stall_inspection';

/**
 * The stall inspection at checkout (migration 209), where the Lodging step
 * says the show requires one.
 *
 * A reminder, and — where the show set a fee — one box: ticked, the fee goes on
 * their bill as an office charge (`PUT …/stall-inspection-fee`); unticked, it
 * comes off. The box reads its state off the bill, so it agrees with the line
 * their bill prints on Financials. Never a gate: checking out still refuses nothing.
 */
export default function StallInspectionCheck({
  showId,
  desk,
  exhibitor,
  busy,
  run,
}: {
  showId: string;
  desk: Desk;
  exhibitor: DeskExhibitor;
  busy: Set<string>;
  run: Run;
}) {
  const charge = (exhibitor.bill?.adjustment_lines ?? []).find((line) => line.kind === KIND);
  // A charge already made stays untickable after the show stops requiring it.
  if (!desk.stall_inspection_required && !charge) return null;

  const fee = desk.stall_inspection_fee_cents ?? null;
  const stalls = (exhibitor.bill?.reservation_lines ?? []).some(
    (line) => line.unit === 'per_stall' && line.quantity > 0,
  );
  const note = stalls ? null : 'No stalls booked.';

  if (!fee && !charge) {
    return (
      <p className="text-xs mb-3" style={{ color: COLORS.muted }}>
        <strong style={{ color: COLORS.text }}>Inspect their stalls before they check out.</strong>{' '}
        {note}
      </p>
    );
  }

  const url = `/api/shows/${showId}/desk/exhibitors/${exhibitor.exhibitor_id}/stall-inspection-fee`;
  const pending = busy.has('stall-inspection');
  return (
    <label className="flex items-start gap-2 text-sm mb-3" style={{ color: COLORS.text }}>
      <input
        type="checkbox"
        checked={Boolean(charge)}
        disabled={pending}
        onChange={(e) =>
          void run(
            'stall-inspection',
            () => fetch(url, { method: e.target.checked ? 'PUT' : 'DELETE' }),
            e.target.checked
              ? 'Could not add the stall inspection fee to their bill.'
              : 'Could not take the stall inspection fee off their bill.',
          )
        }
        className="mt-0.5"
      />
      <span>
        <strong>Stall inspection fee</strong>{' '}
        <span className="tabular-nums">{formatMoney(charge?.amount_cents ?? fee ?? 0)}</span>{' '}
        <span className="text-xs" style={{ color: COLORS.muted }}>
          {charge ? 'On their bill.' : 'Tick to add it to their bill.'} {note}
        </span>
      </span>
    </label>
  );
}
