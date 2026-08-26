import {
  formatMoney,
  type Bill,
  type BillFuturityLine,
  type BillReservationLine,
} from '@/lib/my-shows';

/**
 * What one show costs the signed-in exhibitor, itemised.
 *
 * Shared between the My Shows card and the per-show bill page so the two
 * cannot quote different totals for the same weekend. Every figure here comes
 * from `billing.build_bill` on the backend — nothing is summed in the browser,
 * for the same reason the desk quotes rather than computes (see Claude.md).
 *
 * `detailed` adds the class-by-class list. The card wants a total and a shape;
 * somebody who clicked through to "what do I owe" wants to see the line that
 * surprised them.
 */
export default function ShowBillBreakdown({
  bill,
  detailed = false,
}: {
  bill: Bill;
  detailed?: boolean;
}) {
  if (bill.total_cents === 0) {
    return (
      <p className="text-sm" style={{ color: '#8b7355' }}>
        Nothing charged for this show yet.
      </p>
    );
  }

  return (
    <div>
      {detailed && bill.class_lines.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: '#8b7355' }}>
            Classes entered
          </h3>
          <table className="w-full text-sm" style={{ color: '#5d4a37' }}>
            <tbody>
              {bill.class_lines.map((line) => (
                <tr key={line.entry_id} className="border-b last:border-b-0"
                  style={{ borderColor: '#f0e4d0' }}>
                  <td className="py-1.5 pr-2 align-top font-mono whitespace-nowrap"
                    style={{ color: '#8b4513' }}>
                    {line.class_number}
                  </td>
                  <td className="py-1.5 pr-2 align-top w-full">
                    {line.class_name}
                    {/* The horse is the reason a class can appear twice: one
                        exhibitor may run two horses in the same pattern class,
                        which is two entries and two fees. Without the name the
                        second line looks like a duplicate charge. */}
                    {line.horse_name && (
                      <div className="text-xs" style={{ color: '#8b7355' }}>{line.horse_name}</div>
                    )}
                  </td>
                  <td className="py-1.5 align-top text-right whitespace-nowrap">
                    {formatMoney(line.fee_cents + line.nsba_sanction_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="text-sm grid grid-cols-2 gap-y-1.5" style={{ color: '#5d4a37' }}>
        {bill.class_fee_total_cents > 0 && (
          <>
            <dt>
              Class fees
              <span className="text-xs" style={{ color: '#8b7355' }}>
                {' '}({bill.class_lines.length})
              </span>
            </dt>
            <dd className="text-right">{formatMoney(bill.class_fee_total_cents)}</dd>
          </>
        )}
        {bill.nsba_sanction_total_cents > 0 && (
          <>
            <dt title="NSBA sanction fee: 6% of class fee, $3 minimum, on each NSBA-approved class.">
              NSBA sanction fees
            </dt>
            <dd className="text-right">{formatMoney(bill.nsba_sanction_total_cents)}</dd>
          </>
        )}
        {bill.reservation_lines.map((line) => (
          <ReservationLine key={line.show_fee_id} line={line} />
        ))}
        {(bill.futurity_lines ?? []).map((line) => (
          <FuturityLine key={line.futurity_entry_id} line={line} />
        ))}
        {bill.office_charge_total_cents > 0 && (
          <>
            <dt
              title={
                bill.office_charge_basis === 'per_horse'
                  ? 'Office/drug-testing charge, per horse.'
                  : 'One office/drug-testing charge per back number.'
              }
            >
              Office charge
            </dt>
            <dd className="text-right">{formatMoney(bill.office_charge_total_cents)}</dd>
          </>
        )}
        <dt
          className="pt-1.5 mt-1 border-t font-semibold"
          style={{ borderColor: '#e8d5b7', color: '#2c1810' }}
        >
          Total
        </dt>
        <dd
          className="pt-1.5 mt-1 border-t text-right font-bold"
          style={{ borderColor: '#e8d5b7', color: '#2c1810' }}
        >
          {formatMoney(bill.total_cents)}
        </dd>
      </dl>
    </div>
  );
}

function ReservationLine({ line }: { line: BillReservationLine }) {
  return (
    <>
      <dt>
        {line.label}
        <span className="text-xs" style={{ color: '#8b7355' }}>
          {' '}({line.quantity} × {formatMoney(line.amount_cents)})
        </span>
        {line.is_early_rate && (
          <span
            className="text-xs ml-1.5 px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{ backgroundColor: '#dcfce7', color: '#15803d' }}
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
          <span className="text-xs" style={{ color: '#8b7355' }}>
            {' '}— {line.horse_name}
          </span>
        )}
        <span className="block text-xs" style={{ color: '#8b7355' }}>
          {line.fee_tier_name ? `${line.fee_tier_name}: ` : ''}
          {perClass}
          {line.office_fee_cents > 0 &&
            ` + ${formatMoney(line.office_fee_cents)} office fee${
              line.is_member ? ' (member)' : ''
            }`}
          {line.is_late && ` + ${formatMoney(line.late_fee_cents)} late`}
        </span>
      </dt>
      <dd className="text-right">{formatMoney(line.line_total_cents)}</dd>
    </>
  );
}
