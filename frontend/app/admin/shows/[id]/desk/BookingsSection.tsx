'use client';

import { useEffect, useState, type ReactNode } from 'react';
import DotLeader from '@/components/DotLeader';
import { formatMoney } from '@/lib/financials';
import { isReservableUnit, unitLabel } from '@/lib/fee-units';
import { passAllowance } from '@/lib/stalls-open';
import type { Bill } from '@/lib/my-shows';
import { COLORS } from './types';

type Run = (key: string, fn: () => Promise<Response>, fallback: string) => Promise<boolean>;

/** A line an exhibitor books a quantity of: stalls, passes, shavings, camping. */
type BookableLine = {
  id: string;
  code: string;
  label: string;
  unit: string;
  amount_cents: number;
  one_per_exhibitor?: boolean;
  stall_kind?: string | null;
  stall_period_id?: string | null;
};

/**
 * What the exhibitor has booked (stalls, passes, shavings, camping), as the
 * office sets it at the desk (migration 197). GaitDesk does not run the stall
 * chart, so the office uses this to make the bill match the chart it keeps: a
 * tie stall in place of a box stall when the boxes ran out, or a walk-up's
 * stalls. The whole booking is saved at once; a line comes off with its
 * Remove button (never by typing 0), and is dropped on Save. A line kept keeps its early rate; a line added now is
 * charged today's rate.
 *
 * Bookings are made here at the desk, with everything else the exhibitor signed
 * up for. Financials only takes payments and adds credits or charges.
 *
 * An Early Move-In Pass is held to the stalls booked in its period, as at
 * sign-up (`passAllowance`; the server refuses the same with
 * `PASS_WITHOUT_STALL`): one pass per stall, or for a pass sold per exhibitor,
 * any stall at all. A pass already on file stays.
 *
 * Remount it (`key`) when the saved booking changes, so the boxes start again
 * from what was saved.
 *
 * `frame` draws the panel section around it. It is passed in rather than drawn
 * by the panel because only this knows whether the show sells anything to
 * book (it reads the fees), and a show that sells none should have no
 * "Stalls, shavings & camping" section at all rather than an empty one.
 */
export default function BookingsSection({
  showId,
  exhibitorId,
  bill,
  busy,
  run,
  frame,
}: {
  showId: string;
  exhibitorId: string;
  bill: Bill | null;
  busy: Set<string>;
  run: Run;
  frame: (body: ReactNode) => ReactNode;
}) {
  // The show's bookable lines. Not part of the desk payload, so read once
  // here. On any failure the list stays empty, which only hides the editor.
  const [bookable, setBookable] = useState<BookableLine[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/shows/${showId}/fees`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => [])
      .then((fees: BookableLine[]) => {
        if (cancelled) return;
        setBookable((Array.isArray(fees) ? fees : []).filter((fee) => isReservableUnit(fee.unit)));
      });
    return () => {
      cancelled = true;
    };
  }, [showId]);

  const booked: Record<string, number> = Object.fromEntries(
    (bill?.reservation_lines ?? []).map((line) => [line.show_fee_id, line.quantity]),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // Lines picked from "Add" since the last save. Only what they have booked is
  // listed (a dozen lines at 0 would bury the two they bought), so a line they
  // have not booked shows up once the office adds it, and stays while it is
  // being typed into, even at 0.
  const [added, setAdded] = useState<string[]>([]);
  // Lines taken off with Remove since the last save. Hidden at once and gone
  // on Save, like a line picked from "+ Book…" appears at once and is booked
  // on Save: the whole booking is still saved in one press.
  const [removed, setRemoved] = useState<string[]>([]);

  if (!bookable || bookable.length === 0) return null;

  const qtyOf = (feeId: string) => quantities[feeId] ?? booked[feeId] ?? 0;
  const dirty = bookable.some((fee) => qtyOf(fee.id) !== (booked[fee.id] ?? 0));
  const shown = bookable.filter(
    (fee) =>
      !removed.includes(fee.id) &&
      ((booked[fee.id] ?? 0) > 0 || qtyOf(fee.id) > 0 || added.includes(fee.id)),
  );
  const current = Object.fromEntries(bookable.map((fee) => [fee.id, qtyOf(fee.id)]));
  const allowanceOf = (fee: BookableLine) => passAllowance(fee, bookable, current, booked[fee.id] ?? 0);
  const passOver = bookable.some((fee) => {
    const allowance = allowanceOf(fee);
    return allowance !== null && qtyOf(fee.id) > allowance.cap;
  });
  const addable = bookable.filter((fee) => !shown.includes(fee));
  const saving = busy.has('bookings');

  function addLine(feeId: string) {
    setAdded((prev) => [...prev, feeId]);
    setRemoved((prev) => prev.filter((id) => id !== feeId));
    // A pass whose stalls allow none is not offered in "+ Book…" at all.
    setQuantities((prev) => ({ ...prev, [feeId]: Math.max(qtyOf(feeId), 1) }));
  }

  function removeLine(feeId: string) {
    setRemoved((prev) => [...prev, feeId]);
    setAdded((prev) => prev.filter((id) => id !== feeId));
    setQuantities((prev) => ({ ...prev, [feeId]: 0 }));
  }

  async function save() {
    await run(
      'bookings',
      () =>
        fetch(`/api/shows/${showId}/accounts/${exhibitorId}/reservations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reservations: bookable!
              .filter((fee) => qtyOf(fee.id) > 0)
              .map((fee) => ({ show_fee_id: fee.id, quantity: qtyOf(fee.id) })),
          }),
        }),
      'Could not save their bookings.',
    );
  }

  return frame(
    <div className="space-y-2 text-sm">
      <p className="text-xs" style={{ color: COLORS.muted }}>
        What they have booked. Change it to match your stall chart; their bill on Financials updates
        to match.
      </p>
      {shown.length === 0 ? (
        <p style={{ color: COLORS.muted }}>Nothing booked.</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((fee) => {
            const basis = fee.one_per_exhibitor ? 'per exhibitor' : unitLabel(fee.unit);
            // One a head is the most anyone can have (the server refuses
            // more), so the box stops at 1. A pass stops at the stalls
            // booked in its period.
            // Never below 1: a line comes off with Remove, not by typing 0.
            const allowance = allowanceOf(fee);
            const max = Math.max(1, Math.min(fee.one_per_exhibitor ? 1 : 999, allowance?.cap ?? 999));
            const over = allowance !== null && qtyOf(fee.id) > allowance.cap;
            return (
              <li key={fee.id} className="flex items-baseline gap-2">
                <span className="min-w-0" style={{ color: COLORS.text }}>
                  {fee.label}
                  <span className="text-xs" style={{ color: COLORS.muted }}>
                    {' '}
                    {formatMoney(fee.amount_cents)} {basis}
                  </span>
                  {allowance !== null && allowance.stalls === 0 && (
                    <span className="block text-xs" style={{ color: 'var(--warning)' }}>
                      Needs a stall{fee.stall_period_id ? ' in this period' : ''} — book the stall first.
                    </span>
                  )}
                  {over && allowance.stalls > 0 && (
                    <span className="block text-xs" style={{ color: 'var(--warning)' }}>
                      One pass per stall — {allowance.stalls} booked.
                    </span>
                  )}
                </span>
                <DotLeader />
                {fee.one_per_exhibitor ? (
                  // One a head: there is no number to change, only Remove.
                  <span
                    className="w-20 shrink-0 text-right tabular-nums px-2 py-1"
                    style={{ color: COLORS.text }}
                    title="One per exhibitor"
                  >
                    1
                  </span>
                ) : (
                  <input
                    type="number"
                    min={1}
                    max={max}
                    value={qtyOf(fee.id)}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [fee.id]: Math.max(1, Math.min(max, Number(e.target.value) || 1)),
                      }))
                    }
                    className="w-20 shrink-0 border rounded px-2 py-1 text-right tabular-nums"
                    style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface, color: COLORS.text }}
                    aria-label={`${fee.label}: quantity`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeLine(fee.id)}
                  disabled={saving}
                  className="shrink-0 text-xs hover:underline disabled:opacity-50"
                  style={{ color: 'var(--error)' }}
                  aria-label={`Remove ${fee.label}`}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {addable.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && addLine(e.target.value)}
            className="border rounded px-2 py-1"
            style={{ borderColor: COLORS.border, color: COLORS.accent, backgroundColor: COLORS.surface }}
            aria-label="Book a line they have not booked"
          >
            <option value="">+ Book…</option>
            {addable.map((fee) => (
              <option key={fee.id} value={fee.id} disabled={(allowanceOf(fee)?.cap ?? 1) === 0}>
                {fee.label}: {formatMoney(fee.amount_cents)}{' '}
                {fee.one_per_exhibitor ? 'per exhibitor' : unitLabel(fee.unit)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || passOver}
          title={
            passOver
              ? 'An Early Move-In Pass needs a stall of theirs in its period — book the stall, or Remove the pass.'
              : !dirty
                ? 'Nothing has changed.'
                : undefined
          }
          className="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: COLORS.accent, color: 'var(--surface)' }}
        >
          {saving ? 'Saving…' : 'Save bookings'}
        </button>
        {dirty && !saving && (
          <span className="text-xs" style={{ color: 'var(--warning)' }}>
            Not saved yet
          </span>
        )}
      </div>
    </div>
  );
}
