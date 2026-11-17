'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import LocalTime from '@/components/LocalTime';
import OfficeBillBreakdown from '@/components/OfficeBillBreakdown';
import { formatMoney } from '@/lib/financials';
import type { BillAdjustmentLine } from '@/lib/my-shows';
import { COLORS } from './types';
import type { Desk, DeskExhibitor } from './types';

type Run = (key: string, fn: () => Promise<Response>, fallback: string) => Promise<boolean>;

/**
 * The exhibitor's bill at the desk, and checking them out (migration 200).
 *
 * The whole bill, line by line as Financials lists it (`OfficeBillBreakdown`),
 * with **+ Add a line item** above the total: anything else they owe — a stall
 * left uncleaned, a lost stall card — typed as the line their bill prints, with
 * an amount. It is an office charge (`show_account_adjustments`, migration 197):
 * on the bill everywhere the bill is shown, in the total and the balance like
 * every other line, and removable from beside it. Then what they have paid and
 * still owe, and **Mark checked out**, which records when and by whom. Payments
 * are recorded on Financials, one link away.
 *
 * A record, never a gate: an exhibitor still owing can be checked out, and is
 * told apart only by the balance shown beside the button.
 */
export default function CheckoutSection({
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
  const [adding, setAdding] = useState(false);
  const [reason, setReason] = useState('');
  const [dollars, setDollars] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const reasonsId = useId();

  const balance = exhibitor.balance_cents;
  // What this show's office has charged anybody before, to pick rather than
  // type again: the show's own list, built as it is used.
  const usedReasons = Array.from(
    new Set(
      desk.exhibitors.flatMap((e) =>
        (e.bill?.adjustment_lines ?? []).filter((l) => l.amount_cents > 0).map((l) => l.reason),
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));

  function closeForm() {
    setAdding(false);
    setReason('');
    setDollars('');
    setFormError(null);
  }

  async function addLineItem() {
    const what = reason.trim();
    const amount = Number.parseFloat(dollars);
    if (!what) {
      setFormError('Say what the line is for — it prints on their bill.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('Enter an amount above $0.00.');
      return;
    }
    setFormError(null);
    const ok = await run(
      'checkout-charge',
      () =>
        fetch(`/api/shows/${showId}/adjustments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exhibitor_id: exhibitor.exhibitor_id,
            amount_cents: Math.round(amount * 100),
            reason: what,
          }),
        }),
      'Could not add the line to their bill.',
    );
    if (ok) closeForm();
  }

  async function removeLine(id: string) {
    await run(
      `checkout-remove-${id}`,
      () => fetch(`/api/shows/${showId}/adjustments/${id}`, { method: 'DELETE' }),
      'Could not take that line off their bill.',
    );
    setConfirmId(null);
  }

  /** Beside a line the office added: Remove, then Remove it / Keep. */
  const removeControls = (line: BillAdjustmentLine) =>
    confirmId === line.id ? (
      <span className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={() => void removeLine(line.id)}
          disabled={busy.has(`checkout-remove-${line.id}`)}
          className="text-xs underline disabled:opacity-50"
          style={{ color: 'var(--error)' }}
        >
          Remove it
        </button>
        <button type="button" onClick={() => setConfirmId(null)} className="text-xs underline" style={{ color: COLORS.muted }}>
          Keep
        </button>
      </span>
    ) : (
      <button
        type="button"
        onClick={() => setConfirmId(line.id)}
        className="text-xs underline"
        style={{ color: COLORS.muted }}
        aria-label={`Remove ${line.reason} from their bill`}
      >
        Remove
      </button>
    );

  const addLine = adding ? (
    <div className="rounded border p-3 space-y-2" style={{ borderColor: COLORS.border }}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block flex-1 min-w-[12rem]">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            What for (printed on their bill)
          </span>
          <input
            type="text"
            value={reason}
            maxLength={200}
            list={reasonsId}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Stall cleaning fee"
            className="w-full border rounded px-3 py-1.5"
            style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface, color: COLORS.text }}
            aria-label="Line item — what for"
          />
          <datalist id={reasonsId}>
            {usedReasons.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
        <label className="block w-28">
          <span className="block text-xs mb-1" style={{ color: COLORS.muted }}>
            Amount ($)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addLineItem();
            }}
            placeholder="50.00"
            className="w-full border rounded px-3 py-1.5"
            style={{ borderColor: COLORS.border, backgroundColor: COLORS.surface, color: COLORS.text }}
            aria-label="Line item — amount"
          />
        </label>
        <button
          type="button"
          onClick={() => void addLineItem()}
          disabled={busy.has('checkout-charge')}
          className="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: COLORS.accent, color: 'var(--surface)' }}
        >
          {busy.has('checkout-charge') ? 'Adding…' : 'Add to bill'}
        </button>
        <button type="button" onClick={closeForm} className="text-sm underline py-1.5" style={{ color: COLORS.muted }}>
          Cancel
        </button>
      </div>
      {formError && (
        <p className="text-xs" style={{ color: 'var(--error)' }} role="alert">
          {formError}
        </p>
      )}
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className="text-sm underline"
      style={{ color: COLORS.accent }}
      title="Anything else they owe — a stall left uncleaned, a lost stall card. It prints on their bill with what you type."
    >
      + Add a line item
    </button>
  );

  const paidAndOwing = (
    <>
      <div className="flex justify-between gap-4">
        <dt style={{ color: COLORS.muted }}>Paid</dt>
        <dd className="tabular-nums" style={{ color: COLORS.text }}>
          {formatMoney(exhibitor.net_paid_cents)}
        </dd>
      </div>
      <div className="flex justify-between gap-4 font-semibold">
        <dt style={{ color: COLORS.text }}>{balance < 0 ? 'Credit' : 'Owing'}</dt>
        <dd className="tabular-nums" style={{ color: balance > 0 ? 'var(--error)' : COLORS.text }}>
          {formatMoney(Math.abs(balance))}
        </dd>
      </div>
    </>
  );

  return (
    <div className="space-y-4 text-sm">
      {exhibitor.bill ? (
        <OfficeBillBreakdown
          bill={exhibitor.bill}
          lineAction={removeControls}
          beforeTotal={addLine}
          afterTotal={paidAndOwing}
        />
      ) : (
        <div className="space-y-2">
          <p style={{ color: COLORS.muted }}>No bill yet.</p>
          {addLine}
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href={`/admin/shows/${showId}/financials/exhibitors?exhibitor=${exhibitor.exhibitor_id}`}
          className="hover:underline"
          style={{ color: COLORS.accent }}
        >
          Record a payment →
        </Link>
      </div>

      <div className="pt-3 border-t" style={{ borderColor: COLORS.border }}>
        {exhibitor.checked_out_at ? (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ color: COLORS.text }}>
            <span>
              <span style={{ color: 'var(--success)' }}>✓ Checked out</span>{' '}
              <LocalTime iso={exhibitor.checked_out_at} />
              {exhibitor.checked_out_by_name && <> by {exhibitor.checked_out_by_name}</>}
            </span>
            <button
              type="button"
              onClick={() =>
                void run(
                  'checkout',
                  () => fetch(`/api/shows/${showId}/desk/exhibitors/${exhibitor.exhibitor_id}/checkout`, { method: 'DELETE' }),
                  'Could not undo the checkout.',
                )
              }
              disabled={busy.has('checkout')}
              className="text-xs underline disabled:opacity-50"
              style={{ color: COLORS.muted }}
            >
              Undo
            </button>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                void run(
                  'checkout',
                  () => fetch(`/api/shows/${showId}/desk/exhibitors/${exhibitor.exhibitor_id}/checkout`, { method: 'POST' }),
                  'Could not check them out.',
                )
              }
              disabled={busy.has('checkout')}
              className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: COLORS.accent, color: COLORS.accent }}
            >
              {busy.has('checkout') ? 'Checking out…' : 'Mark checked out'}
            </button>
            {balance > 0 && (
              <span className="text-xs" style={{ color: 'var(--error)' }}>
                Still owing {formatMoney(balance)} — record what they pay before they go.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
