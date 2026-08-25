import { formatMoney, type MyShow } from '@/lib/my-shows';

/**
 * "Due at this show" — the headline on What I Owe.
 *
 * It used to sit at the top of My Shows as a roll-up across every upcoming
 * show. That is a number nobody is ever asked for: the office collects per
 * show, against a back number, and "you owe $940 across four weekends" cannot
 * be handed to anyone at a desk. Per show it is the figure on the cheque.
 *
 * The back number and class count ride along because they are how the office
 * finds the account this total is on — the same line the desk reads back.
 *
 * Rendered even at zero: an exhibitor who has signed up and entered nothing is
 * asking exactly this question, and a box that disappears when the answer is
 * "nothing" reads as the page having failed to load it.
 */
export default function DueAtShow({ show }: { show: MyShow }) {
  return (
    <div
      className="rounded-lg border px-4 py-3 flex items-center justify-between gap-3"
      style={{ borderColor: '#d4b896', backgroundColor: '#faf4ec' }}
    >
      <div className="text-sm" style={{ color: '#5d4a37' }}>
        Due at this show
        <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
          {show.back_number != null ? `Back #${show.back_number}` : 'No back # yet'}
          {' · '}
          {show.entry_count} class{show.entry_count === 1 ? '' : 'es'}
        </div>
      </div>
      <div className="text-2xl font-bold" style={{ color: '#2c1810' }}>
        {formatMoney(show.bill.total_cents)}
      </div>
    </div>
  );
}
