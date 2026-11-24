'use client';

import { useState, type ReactNode } from 'react';
import { formatMoney } from '@/lib/financials';
import { unitLabel } from '@/lib/fee-units';
import type { Bill, BillAdjustmentLine, BillClassLine, BillFuturityLine } from '@/lib/my-shows';
import DotLeader from './DotLeader';

/**
 * An exhibitor's bill line by line, as the show office reads it — on
 * Financials and at the desk's checkout, so the two cannot list it differently.
 *
 * Quoted off `billing.build_bill`, never re-added: every row is a figure the
 * backend already worked out, and the total is the bill's own. The office's
 * own lines (migration 197) print as a line like any other, their reason and
 * amount: who added one, and when, is kept in the Adjustments Log report, not
 * on the bill. A screen may put an action beside them (`lineAction`) and a way
 * to add one above the total (`beforeTotal`).
 *
 * A line that rolls several things up — the class entry fees, the club
 * sanction fees, an All Day fee, a per-class charge, a futurity — opens to
 * what is in it (`items`), folded until somebody asks. The items are the
 * backend's own per-class figures, so they add up to the line they sit under;
 * the exception is an All Day fee, whose items are the classes it covered at
 * their own prices, which is what it was charged *instead of*.
 */

export type OfficeBillItem = {
  key: string;
  label: string;
  /** Under the label, smaller: the horse, the day. */
  detail?: string;
  cents: number;
  /** Shown in place of the amount — "Free" for a class the office made free. */
  amountText?: string;
};

export type OfficeBillRow = {
  key: string;
  label: string;
  cents: number;
  /** Set on a line the office added: a charge or a credit with its reason. */
  adjustment?: BillAdjustmentLine;
  /** What a rolled-up line is made of, listed when the line is opened. */
  items?: OfficeBillItem[];
  /** A sentence over the items, when they are not simply the line's parts. */
  itemsNote?: string;
};

/** "Sat, Jun 13" — a date-only string read as a calendar day, not shifted
 *  into the reader's zone. */
function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Day order, then class number — the order the show bill runs in. */
function byDayThenNumber(a: BillClassLine, b: BillClassLine): number {
  return (
    (a.class_date ?? '').localeCompare(b.class_date ?? '') ||
    (a.class_number ?? '').localeCompare(b.class_number ?? '', undefined, { numeric: true })
  );
}

function classItem(line: BillClassLine, cents: number, amountText?: string): OfficeBillItem {
  const detail = [line.horse_name, line.class_date ? formatDay(line.class_date) : null]
    .filter(Boolean)
    .join(' · ');
  return {
    key: line.entry_id,
    label: `${line.class_number} ${line.class_name}`,
    detail: detail || undefined,
    cents,
    amountText,
  };
}

/** A futurity's classes, each at the entrant's category rate — or, for a
 *  payload without `entry_ids`, the one "N × rate" row they add up to. */
function futurityClassItems(line: BillFuturityLine, classLines: BillClassLine[]): OfficeBillItem[] {
  const ids = new Set(line.entry_ids ?? []);
  const classes = classLines.filter((c) => ids.has(c.entry_id));
  if (classes.length === line.class_count && classes.length > 0) {
    return classes.map((c) => {
      const item = classItem(c, line.tier_amount_cents);
      return { ...item, key: `class-${item.key}`, detail: line.fee_tier_name ?? item.detail };
    });
  }
  return [
    {
      key: 'tier',
      label: `${line.fee_tier_name ?? 'Class fee'} — ${line.class_count} × ${formatMoney(
        line.tier_amount_cents,
      )}`,
      cents: line.tier_amount_cents * line.class_count,
    },
  ];
}

export function officeBillRows(bill: Bill): OfficeBillRow[] {
  const classLines = [...bill.class_lines].sort(byDayThenNumber);
  // The classes priced one by one, at the class itself. Not those an All Day
  // fee covered, nor a futurity's: their `fee_cents` is 0 and their money is
  // on that line instead, where they are itemised. A futurity class that does
  // somehow carry a fee of its own stays, so the list still foots.
  const charged = classLines.filter(
    (line) => line.all_day_fee_id == null && !(line.is_futurity && line.fee_cents === 0),
  );

  const rows: OfficeBillRow[] = [
    {
      key: 'classes',
      label: 'Class entry fees',
      cents: bill.class_fee_total_cents,
      items: charged.map((line) => classItem(line, line.fee_cents, line.is_free ? 'Free' : undefined)),
    },
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
      items: classLines
        .filter(
          (c) =>
            c.all_day_fee_id === line.show_fee_id &&
            (!line.horse_name || c.horse_name === line.horse_name) &&
            (!line.class_date || c.class_date === line.class_date),
        )
        .map((c) => classItem(c, c.list_fee_cents ?? 0)),
      itemsNote: `The classes it covered, at their own prices — ${formatMoney(
        line.class_fee_cents,
      )} together, charged ${formatMoney(line.line_total_cents)} instead.`,
    })),
    // The per-class clubs only: their money is spread across the class lines
    // and has no line of its own. A club charging per horse or per exhibitor
    // is itemised below with its arithmetic, the way the show's own charges
    // are — the two add up to `sanction_total_cents`.
    {
      key: 'class-sanctions',
      label: 'Club sanction fees',
      cents: bill.class_sanction_total_cents ?? bill.sanction_total_cents,
      items: classLines
        .filter((line) => line.sanction_cents !== 0)
        .map((line) => classItem(line, line.sanction_cents)),
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
    // $30?" without opening the fee editor. One levied per class entry opens
    // to the classes it was counted on (`class_lines[].charges`).
    ...(bill.charge_lines ?? []).map((line, i) => ({
      key: `charge-${i}`,
      label: `${line.label} — ${formatMoney(line.amount_cents)} ${unitLabel(line.unit)}${
        line.quantity > 1 ? ` × ${line.quantity}` : ''
      }`,
      cents: line.line_total_cents,
      items: line.per_class
        ? classLines.flatMap((c) =>
            (c.charges ?? [])
              .filter((charge) => charge.show_fee_id === line.show_fee_id)
              .map((charge) => classItem(c, charge.cents)),
          )
        : undefined,
    })),
    // Futurity money is its own line per horse, because the per-class rate is
    // the entrant's category rate and appears nowhere in `class_lines` — those
    // classes are $0. Reading the two together is how you check a futurity
    // bill, so the horse and the category are both named. Opened, it is
    // `futurity_charge_cents` term by term, the classes one by one at the
    // category rate (`entry_ids`; a payload without them gets one row).
    ...(bill.futurity_lines ?? []).map((line, i) => ({
      key: `futurity-${i}`,
      label:
        `${line.futurity_name} — ${line.horse_name ?? 'horse'}` +
        (line.fee_tier_name ? ` (${line.fee_tier_name})` : '') +
        `, ${line.class_count} ${line.class_count === 1 ? 'class' : 'classes'}` +
        (line.is_late ? ' + late fee' : '') +
        (line.membership_fee_cents > 0 ? ` + ${line.membership_name ?? 'membership'}` : ''),
      cents: line.line_total_cents,
      items: [
        ...futurityClassItems(line, classLines),
        {
          key: 'office',
          label: `Office fee (${line.is_member ? 'member' : 'non-member'})`,
          cents: line.office_fee_cents,
        },
        { key: 'late', label: 'Late fee', cents: line.late_fee_cents },
        { key: 'membership', label: line.membership_name ?? 'Membership', cents: line.membership_fee_cents },
      ].filter((item) => item.key.startsWith('class-') || item.key === 'tier' || item.cents !== 0),
    })),
    // Buy-ins are in `total_cents` (entering a class a pot bundles is the
    // buy-in), so they are listed or the bill would not foot.
    ...(bill.side_pot_lines ?? []).map((line) => ({
      key: `pot-${line.side_pot_id}`,
      label: `${line.name} (side pot)`,
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
  // The lines that roll several things up come first, then the single-line
  // fees — the office's standing order for a bill. Stable, so each group keeps
  // the order above.
  const kept = rows.filter((row) => row.cents !== 0);
  const rolledUp = (row: OfficeBillRow) => (row.items?.length ?? 0) > 0;
  return [...kept.filter(rolledUp), ...kept.filter((row) => !rolledUp(row))];
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
  // Folded by default: the bill reads as its totals first, and the office opens
  // the one line it is being asked about.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    // Capped so a short label is not a page-width of dots from its amount.
    <div className="max-w-xl">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>
        Itemized Bill
      </h3>
      <ul className="text-sm space-y-1">
        {rows.map((row) => {
          const items = row.items ?? [];
          const expandable = items.length > 0;
          const isOpen = expandable && open.has(row.key);
          return (
            <li key={row.key}>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0" style={{ color: 'var(--text-deep)' }}>
                  {expandable ? (
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      aria-expanded={isOpen}
                      className="text-left hover:underline"
                      style={{ color: 'var(--text-deep)' }}
                      title={isOpen ? 'Hide what makes up this line' : 'Show what makes up this line'}
                    >
                      <span aria-hidden style={{ color: 'var(--muted)' }}>
                        {isOpen ? '▾' : '▸'}
                      </span>{' '}
                      {row.label}
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        {' '}({items.length})
                      </span>
                    </button>
                  ) : (
                    row.label
                  )}
                </span>
                <DotLeader />
                <span className="flex items-baseline gap-3 shrink-0">
                  <span className="tabular-nums" style={{ color: 'var(--foreground)' }}>
                    {formatMoney(row.cents)}
                  </span>
                  {row.adjustment && lineAction?.(row.adjustment)}
                </span>
              </div>
              {isOpen && (
                <div className="ml-1.5 pl-3 mt-1 mb-1.5 border-l" style={{ borderColor: 'var(--bg-subtle)' }}>
                  {row.itemsNote && (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {row.itemsNote}
                    </p>
                  )}
                  <ul className="space-y-0.5">
                    {items.map((item) => (
                      <li key={item.key} className="flex items-baseline gap-2 text-xs">
                        <span className="min-w-0" style={{ color: 'var(--text-deep)' }}>
                          {item.label}
                          {item.detail && <span style={{ color: 'var(--muted)' }}> — {item.detail}</span>}
                        </span>
                        <DotLeader />
                        <span className="tabular-nums shrink-0" style={{ color: 'var(--muted)' }}>
                          {item.amountText ?? formatMoney(item.cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
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
