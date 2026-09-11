'use client';

import { useState } from 'react';
import {
  formatMoney,
  type Bill,
  type BillChargeLine,
  type BillClassLine,
  type BillFuturityLine,
  type BillReservationLine,
  type BillSanctionLine,
} from '@/lib/my-shows';
import { unitLabel } from '@/lib/fee-units';

/**
 * What one show costs the signed-in exhibitor, itemised.
 *
 * Shared between the My Shows card and the per-show bill page so the two
 * cannot quote different totals for the same weekend. Every figure here comes
 * from `billing.build_bill` on the backend — nothing is summed in the browser,
 * for the same reason the desk quotes rather than computes (see Claude.md).
 *
 * The Class fees line expands to a sub-line per class. `detailed` only decides
 * whether it starts open: the card wants a total and a shape, while somebody
 * who clicked through to "what do I owe" wants the line that surprised them
 * already in front of them.
 *
 * The sub-lines carry `fee_cents` alone, never `fee_cents + sanction_cents`.
 * As a separate table above the summary the combined figure was merely a
 * different question; as sub-lines *under* the Class fees total they have to
 * add up to it, and a bill whose own rows do not foot is the one thing an
 * exhibitor checking it will not forgive. A class carrying club money says so
 * in its own line and that money is totalled in Club sanction fees below.
 */
export default function ShowBillBreakdown({
  bill,
  detailed = false,
}: {
  bill: Bill;
  detailed?: boolean;
}) {
  const [classesOpen, setClassesOpen] = useState(detailed);

  if (bill.total_cents === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Nothing charged for this show yet.
      </p>
    );
  }

  return (
    <div>
      <dl className="text-sm grid grid-cols-2 gap-y-1.5" style={{ color: 'var(--text-deep)' }}>
        {/* Guarded on the class list rather than on the money: an exhibitor
            entered only in futurity classes has a $0 class-fee total and three
            classes, and hiding the row would leave the futurity charge below
            looking like it came from nowhere. */}
        {bill.class_lines.length > 0 && (
          <>
            <dt>
              <button
                type="button"
                onClick={() => setClassesOpen((open) => !open)}
                aria-expanded={classesOpen}
                className="text-left"
                style={{ color: 'var(--text-deep)' }}
                title={
                  classesOpen
                    ? 'Hide the class-by-class breakdown'
                    : 'Show every class entered and what each one costs'
                }
              >
                <span aria-hidden>{classesOpen ? '▾' : '▸'}</span> Class fees
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {' '}({bill.class_lines.length})
                </span>
              </button>
            </dt>
            <dd className="text-right">{formatMoney(bill.class_fee_total_cents)}</dd>
            {classesOpen &&
              bill.class_lines.map((line) => (
                <ClassSubLine key={line.entry_id} line={line} />
              ))}
          </>
        )}
        {/* The per-class clubs, rolled up: their money is already spread
            across the class lines above, so one figure is the only way to show
            it without restating every line. A club charging per horse or per
            exhibitor gets a line of its own below, with its arithmetic — the
            two together are `sanction_total_cents`. */}
        {(bill.class_sanction_total_cents ?? bill.sanction_total_cents) > 0 && (
          <>
            <dt title="Each sanctioning club's per-class fee, charged only on the classes that club approves.">
              Club sanction fees
            </dt>
            <dd className="text-right">
              {formatMoney(bill.class_sanction_total_cents ?? bill.sanction_total_cents)}
            </dd>
          </>
        )}
        {(bill.sanction_lines ?? []).map((line) => (
          <SanctionLine key={line.association_id} line={line} />
        ))}
        {bill.reservation_lines.map((line) => (
          <ReservationLine key={line.show_fee_id} line={line} />
        ))}
        {(bill.charge_lines ?? []).map((line) => (
          <ChargeLine key={line.show_fee_id} line={line} />
        ))}
        {(bill.futurity_lines ?? []).map((line) => (
          <FuturityLine key={line.futurity_entry_id} line={line} />
        ))}
        <dt
          className="pt-1.5 mt-1 border-t font-semibold"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--foreground)' }}
        >
          Total
        </dt>
        <dd
          className="pt-1.5 mt-1 border-t text-right font-bold"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--foreground)' }}
        >
          {formatMoney(bill.total_cents)}
        </dd>
      </dl>
    </div>
  );
}

/**
 * One class, under the Class fees total it is part of.
 *
 * A `dt`/`dd` pair like every other row rather than a nested table, so the
 * amounts sit in the same column as the totals they add up to — which is the
 * whole point of breaking the line open, and what a table indented under it
 * would lose.
 */
function ClassSubLine({ line }: { line: BillClassLine }) {
  return (
    <>
      <dt className="pl-3 ml-1 border-l text-xs" style={{ borderColor: 'var(--bg-subtle)' }}>
        <span className="font-mono" style={{ color: 'var(--accent)' }}>
          {line.class_number}
        </span>{' '}
        <span style={{ color: 'var(--muted)' }}>{line.class_name}</span>
        {/* The horse is the reason a class can appear twice: one exhibitor may
            run two horses in the same pattern class, which is two entries and
            two fees. Without the name the second line looks like a duplicate
            charge. */}
        {line.horse_name && (
          <span className="block" style={{ color: 'var(--muted)' }}>
            {line.horse_name}
          </span>
        )}
        {line.sanction_cents > 0 && (
          <span
            className="block"
            style={{ color: 'var(--muted)' }}
            title="Charged by a club that sanctions this class. Totalled in Club sanction fees below, not in the amount beside this line."
          >
            + {formatMoney(line.sanction_cents)} club sanction
          </span>
        )}
      </dt>
      <dd className="text-right text-xs self-start" style={{ color: 'var(--muted)' }}>
        {formatMoney(line.fee_cents)}
      </dd>
    </>
  );
}

/**
 * One club's sanction fee, where the club charges per horse or per exhibitor.
 *
 * Named for the club rather than lumped under "Club sanction fees", and the
 * arithmetic spelled out, for the same reason a `ChargeLine` is: this is money
 * nobody booked, and "$180.00" beside a club code is a figure an exhibitor
 * cannot check. The counts are of that club's own classes only, which is what
 * makes them differ from the show's own charges above.
 */
function SanctionLine({ line }: { line: BillSanctionLine }) {
  const parts = [formatMoney(line.amount_cents)];
  if (line.unit === 'per_judge_per_horse' || line.unit === 'per_judge_per_exhibitor') {
    parts.push(`× ${line.judge_count} judge${line.judge_count === 1 ? '' : 's'}`);
  }
  if (line.unit === 'per_horse' || line.unit === 'per_judge_per_horse') {
    parts.push(`× ${line.horse_count} horse${line.horse_count === 1 ? '' : 's'}`);
  }
  return (
    <>
      <dt>
        {line.name || line.code} sanction fee
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {' '}({parts.join(' ')}, in its {line.entry_count}{' '}
          {line.entry_count === 1 ? 'class' : 'classes'})
        </span>
      </dt>
      <dd className="text-right">{formatMoney(line.line_total_cents)}</dd>
    </>
  );
}

/**
 * One of the show's own charges.
 *
 * The arithmetic is shown rather than only the total, because this is the line
 * an exhibitor did not ask for and will want to check: "$5.00 × 3 judges × 2
 * horses" answers the question that a bare $30.00 raises.
 */
function ChargeLine({ line }: { line: BillChargeLine }) {
  const parts = [formatMoney(line.amount_cents)];
  if (
    line.unit === 'per_judge_per_horse' ||
    line.unit === 'per_judge_per_exhibitor' ||
    line.unit === 'per_judge_per_entry'
  ) {
    parts.push(`× ${line.judge_count} judge${line.judge_count === 1 ? '' : 's'}`);
  }
  if (line.unit === 'per_horse' || line.unit === 'per_judge_per_horse') {
    parts.push(`× ${line.horse_count} horse${line.horse_count === 1 ? '' : 's'}`);
  }
  if (line.unit === 'per_judge_per_entry') {
    // Only the breed association's own class entries — a class a club like
    // WSCA or MNSPHC sanctions outright is not counted, so this can read
    // lower than the exhibitor's total entry count on the same bill.
    parts.push(`× ${line.entry_count} ${line.entry_count === 1 ? 'entry' : 'entries'}`);
  }
  return (
    <>
      <dt
        title={`Charged ${unitLabel(
          line.unit,
        )}, counted only against horses/entries in the breed association's own classes — not ones a club like WSCA or MNSPHC sanctions outright.`}
      >
        {line.label}
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {' '}({parts.join(' ')})
        </span>
      </dt>
      <dd className="text-right">{formatMoney(line.line_total_cents)}</dd>
    </>
  );
}

function ReservationLine({ line }: { line: BillReservationLine }) {
  return (
    <>
      <dt>
        {line.label}
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {' '}({line.quantity} × {formatMoney(line.amount_cents)})
        </span>
        {line.is_early_rate && (
          <span
            className="text-xs ml-1.5 px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)' }}
            title={`Early rate — reserved ${line.reserved_at}. Standard rate is ${formatMoney(
              line.standard_amount_cents,
            )}.`}
          >
            early rate
          </span>
        )}
      </dt>
      <dd className="text-right">{formatMoney(line.line_total_cents)}</dd>
    </>
  );
}

/**
 * One horse's futurity charge.
 *
 * Spelled out rather than folded into "Class fees", because the futurity's
 * classes are $0 on the class row and their money arrives here instead — an
 * exhibitor reading a $150-per-class futurity bill against a class list showing
 * nothing would reasonably think they had been charged twice.
 */
function FuturityLine({ line }: { line: BillFuturityLine }) {
  const perClass = `${line.class_count} × ${formatMoney(line.tier_amount_cents)}`;
  return (
    <>
      <dt>
        {line.futurity_name}
        {line.horse_name && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {' '}— {line.horse_name}
          </span>
        )}
        <span className="block text-xs" style={{ color: 'var(--muted)' }}>
          {line.fee_tier_name ? `${line.fee_tier_name}: ` : ''}
          {perClass}
          {line.office_fee_cents > 0 &&
            ` + ${formatMoney(line.office_fee_cents)} office fee${
              line.is_member ? ' (member)' : ''
            }`}
          {line.membership_fee_cents > 0 &&
            ` + ${formatMoney(line.membership_fee_cents)} ${
              line.membership_name ?? 'membership'
            }`}
          {line.is_late && ` + ${formatMoney(line.late_fee_cents)} late`}
        </span>
      </dt>
      <dd className="text-right">{formatMoney(line.line_total_cents)}</dd>
    </>
  );
}
