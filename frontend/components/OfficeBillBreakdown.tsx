import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/financials';
import { unitLabel } from '@/lib/fee-units';
import type { Bill, BillAdjustmentLine } from '@/lib/my-shows';
import DotLeader from './DotLeader';

/**
 * An exhibitor's bill line by line, as the show office reads it — on
 * Financials and at the desk's checkout, so the two cannot list it differently.
 *
 * Quoted off `billing.build_bill`, never re-added: every row is a figure the
 * backend already worked out, and the total is the bill's own. The office's
 * own lines (migration 197) carry their reason and who added them, and a
 * screen may put an action beside them (`lineAction`) and a way to add one
 * above the total (`beforeTotal`).
 */

export type OfficeBillRow = {
  key: string;
  label: string;
  cents: number;
  /** Set on a line the office added: a charge or a credit with its reason. */
  adjustment?: BillAdjustmentLine;
};

export function officeBillRows(bill: Bill): OfficeBillRow[] {
  const rows: OfficeBillRow[] = [
    { key: 'classes', label: 'Class entry fees', cents: bill.class_fee_total_cents },
    // Charged in place of the class entry fees each one covered, which are not
    // in the row above (migration 186).
    ...(bill.all_day_lines ?? []).map((line, i) => ({
      key: `all-day-${i}`,
      label:
        `${line.label}${line.horse_name ? ` — ${line.horse_name}` : ''}` +
        `${line.class_date ? `, ${line.class_date}` : ''}` +
        ` (${line.class_count} ${line.class_count === 1 ? 'class' : 'classes'} at ${formatMoney(
          line.class_fee_cents,
        )})`,
      cents: line.line_total_cents,
    })),
    // The per-class clubs only: their money is spread across the class lines
    // and has no line of its own. A club charging per horse or per exhibitor
    // is itemised below with its arithmetic, the way the show's own charges
    // are — the two add up to `sanction_total_cents`.
    {
      key: 'class-sanctions',
      label: 'Club sanction fees',
      cents: bill.class_sanction_total_cents ?? bill.sanction_total_cents,
    },
    ...(bill.sanction_lines ?? []).map((line, i) => ({
      key: `sanction-${i}`,
      label: `${line.name || line.code} sanction — ${formatMoney(line.amount_cents)} ${unitLabel(
        line.unit,
      )}${line.quantity > 1 ? ` × ${line.quantity}` : ''}`,
      cents: line.line_total_cents,
    })),
    // No office charge row of its own: since migration 132 it is an ordinary
    // fee row and arrives with the show's other charges below.
    ...bill.reservation_lines.map((line, i) => ({
      key: `booked-${i}`,
      label: `${line.label} — ${line.quantity} × ${formatMoney(line.amount_cents)}${
        line.is_early_rate ? ' (early rate)' : ''
      }`,
      cents: line.line_total_cents,
    })),
    // The show's own charges. The multiplier is spelled out for the same reason
    // the futurity line names the horse and the category: this is a charge
    // nobody booked, so the office needs to be able to answer "why is this
    // $30?" without opening the fee editor.
    ...(bill.charge_lines ?? []).map((line, i) => ({
      key: `charge-${i}`,
      label: `${line.label} — ${formatMoney(line.amount_cents)} ${unitLabel(line.unit)}${
        line.quantity > 1 ? ` × ${line.quantity}` : ''
      }`,
      cents: line.line_total_cents,
    })),
    // Futurity money is its own line per horse, because the per-class rate is
    // the entrant's category rate and appears nowhere in `class_lines` — those
    // classes are $0. Reading the two together is how you check a futurity
    // bill, so the horse and the category are both named.
    ...(bill.futurity_lines ?? []).map((line, i) => ({
      key: `futurity-${i}`,
      label:
        `${line.futurity_name} — ${line.horse_name ?? 'horse'}` +
        (line.fee_tier_name ? ` (${line.fee_tier_name})` : '') +
        `, ${line.class_count} ${line.class_count === 1 ? 'class' : 'classes'}` +
        (line.is_late ? ' + late fee' : '') +
        (line.membership_fee_cents > 0 ? ` + ${line.membership_name ?? 'membership'}` : ''),
      cents: line.line_total_cents,
    })),
    // The office's own lines (migration 197), each with its reason.
    ...(bill.adjustment_lines ?? []).map((line) => ({
      key: `office-${line.id}`,
      label: `${line.reason} (${line.amount_cents < 0 ? 'credit' : 'charge'})`,
      cents: line.amount_cents,
      adjustment: line,
    })),
  ];
  return rows.filter((row) => row.cents !== 0);
}

export default function OfficeBillBreakdown({
  bill,
  lineAction,
  beforeTotal,
  afterTotal,
}: {
  bill: Bill;
  /** Beside each line the office added — Remove, at the desk. */
  lineAction?: (line: BillAdjustmentLine) => ReactNode;
  /** Above the total: a way to add a line, at the desk. */
  beforeTotal?: ReactNode;
  /** Under the total, as further `<dt>`/`<dd>` rows: paid, owing. */
  afterTotal?: ReactNode;
}) {
  const rows = officeBillRows(bill);
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>
        Bill
      </h3>
      <dl className="text-sm space-y-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline gap-2">
            <dt className="min-w-0" style={{ color: 'var(--text-deep)' }}>
              {row.label}
              {row.adjustment?.recorded_by_name && (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {' '}
                  · added by {row.adjustment.recorded_by_name}
                </span>
              )}
            </dt>
            <DotLeader />
            <dd className="flex items-baseline gap-3 shrink-0">
              <span className="tabular-nums" style={{ color: 'var(--foreground)' }}>
                {formatMoney(row.cents)}
              </span>
              {row.adjustment && lineAction?.(row.adjustment)}
            </dd>
          </div>
        ))}
      </dl>
      {beforeTotal && <div className="mt-2">{beforeTotal}</div>}
      <dl className="text-sm space-y-1 pt-1.5 mt-1.5 border-t" style={{ borderColor: 'var(--bg-subtle)' }}>
        <div className="flex justify-between gap-4 font-semibold">
          <dt style={{ color: 'var(--foreground)' }}>Total billed</dt>
          <dd className="tabular-nums" style={{ color: 'var(--foreground)' }}>
            {formatMoney(bill.total_cents)}
          </dd>
        </div>
        {afterTotal}
      </dl>
    </div>
  );
}
