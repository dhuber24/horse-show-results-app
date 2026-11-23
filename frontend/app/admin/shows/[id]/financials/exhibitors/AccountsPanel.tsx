'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { todayIso } from '@/lib/minor';
import {
  formatMoney,
  formatReceivedOn,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type FinancialAccount,
  type PaymentMethod,
} from '@/lib/financials';
import { unitLabel } from '@/lib/fee-units';
import { errorMessage } from '@/lib/api-error';
import AutoRefresh from '../AutoRefresh';
import OfficeBillBreakdown from '@/components/OfficeBillBreakdown';
import { backNumbersLabel } from '@/lib/back-numbers';
import DotLeader from '@/components/DotLeader';

type Filter = 'owing' | 'settled' | 'all';

/** A line an exhibitor books a quantity of (stalls, passes, shavings,
 *  camping), for the office's booking editor. */
export type BookableLine = {
  id: string;
  label: string;
  unit: string;
  amount_cents: number;
  one_per_exhibitor?: boolean;
};

/**
 * Per-exhibitor accounts, with the desk's record-a-payment form.
 *
 * Opens on the accounts that owe money, because that is the question the office
 * comes here with. Recording a payment writes it down — no card is charged and
 * no processor is called. An exhibitor's online payment (migration 172) arrives
 * on its own, marked "Paid online", with any card fee shown beside it.
 */
export default function AccountsPanel({
  showId,
  accounts,
  bookable = [],
  focusExhibitorId = null,
}: {
  showId: string;
  accounts: FinancialAccount[];
  /** The show's bookable lines, for setting what an exhibitor has booked. */
  bookable?: BookableLine[];
  /** From `?exhibitor=` — the desk sent the office here to take money from one
   *  named person. Their row opens on arrival. */
  focusExhibitorId?: string | null;
}) {
  const router = useRouter();
  // "Owing" is the right default for somebody who came here to chase money.
  // Arriving with one exhibitor named is the other errand entirely — and a
  // settled account is not in the owing list, so defaulting there would land
  // them on an empty screen for a person who is standing in front of them.
  const [filter, setFilter] = useState<Filter>(focusExhibitorId ? 'all' : 'owing');
  const [openId, setOpenId] = useState<string | null>(focusExhibitorId);
  const [search, setSearch] = useState('');

  // Put the named row on screen. Once, and only if it is really in this show's
  // accounts — a stale link should leave the list alone rather than scroll to
  // nothing.
  const scrolledToFocus = useRef(false);
  useEffect(() => {
    if (scrolledToFocus.current || !focusExhibitorId) return;
    if (!accounts.some((a) => a.exhibitor_id === focusExhibitorId)) return;
    scrolledToFocus.current = true;
    document
      .getElementById(`account-${focusExhibitorId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [accounts, focusExhibitorId]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === 'owing' && a.balance_cents <= 0) return false;
      if (filter === 'settled' && a.balance_cents > 0) return false;
      if (!term) return true;
      return (
        a.exhibitor_name.toLowerCase().includes(term) ||
        (backNumbersLabel(a) ?? '').includes(term)
      );
    });
  }, [accounts, filter, search]);

  const owingCount = accounts.filter((a) => a.balance_cents > 0).length;

  if (accounts.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-6 text-center"
        style={{ borderColor: 'var(--border)' }}
      >
        {/* Kept in this branch too: an empty roster is exactly when someone
            leaves this screen open waiting for sign-ups to land. */}
        <AutoRefresh />
        <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Nobody is registered yet
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Accounts appear here as exhibitors sign up or the office enters them.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      {/* Paused while a row is expanded. State survives a refresh, but the list
          is sorted by balance — reordering under someone mid-entry would move
          the row they are typing into. Recording a payment refreshes explicitly,
          so nothing is missed by holding off here. */}
      <AutoRefresh paused={openId !== null} />

      {/* No heading here — the page title above is the heading. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {accounts.length} account{accounts.length === 1 ? '' : 's'} ·{' '}
          {owingCount === 0 ? 'all settled' : `${owingCount} owing`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or back number"
            className="text-sm px-3 py-1.5 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
          {(['owing', 'settled', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-sm font-medium px-3 py-1.5 rounded-full border transition"
              style={
                filter === f
                  ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--surface)' }
                  : { backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--accent)' }
              }
            >
              {f === 'owing' ? `Owing (${owingCount})` : f === 'settled' ? 'Settled' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Nothing in this view.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((account) => (
            <AccountRow
              key={account.exhibitor_id}
              showId={showId}
              account={account}
              bookable={bookable}
              isOpen={openId === account.exhibitor_id}
              onToggle={() =>
                setOpenId(openId === account.exhibitor_id ? null : account.exhibitor_id)
              }
              onChanged={() => router.refresh()}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountRow({
  showId,
  account,
  bookable,
  isOpen,
  onToggle,
  onChanged,
}: {
  showId: string;
  account: FinancialAccount;
  bookable: BookableLine[];
  isOpen: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const owes = account.balance_cents > 0;
  const overpaid = account.balance_cents < 0;

  return (
    <li
      id={`account-${account.exhibitor_id}`}
      className="rounded-lg border"
      style={{
        borderColor: owes ? 'var(--error-border)' : 'var(--border-subtle)',
        backgroundColor: owes ? 'var(--surface)' : 'var(--surface)',
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={isOpen}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center flex-wrap gap-2" style={{ color: 'var(--foreground)' }}>
            {backNumbersLabel(account, '#') && (
              <span
                className="text-xs font-mono px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
              >
                {backNumbersLabel(account, '#')}
              </span>
            )}
            {account.exhibitor_name}
            {!account.signed_up && (
              <span
                className="text-xs px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}
                title="Added by the show office — this exhibitor did not complete online sign-up"
              >
                Office-added
              </span>
            )}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {account.entry_count} entr{account.entry_count === 1 ? 'y' : 'ies'} ·{' '}
            {account.horse_count} horse{account.horse_count === 1 ? '' : 's'} ·{' '}
            {account.payments.length} payment{account.payments.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-5 text-right">
          <div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Billed
            </p>
            <p className="text-sm font-medium tabular-nums" style={{ color: 'var(--foreground)' }}>
              {formatMoney(account.bill.total_cents)}
            </p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Paid
            </p>
            <p className="text-sm font-medium tabular-nums" style={{ color: 'var(--success)' }}>
              {formatMoney(account.net_paid_cents)}
            </p>
          </div>
          <div>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {overpaid ? 'Credit' : 'Balance'}
            </p>
            <p
              className="text-sm font-bold tabular-nums"
              style={{ color: owes ? 'var(--error)' : overpaid ? 'var(--warning)' : 'var(--success)' }}
            >
              {formatMoney(Math.abs(account.balance_cents))}
            </p>
          </div>
          <span aria-hidden style={{ color: 'var(--muted)' }}>
            {isOpen ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-4 border-t pt-3" style={{ borderColor: 'var(--bg-subtle)' }}>
          {/* The other half of the desk's "Record a payment" link. Taking money
              and fixing what it is for are one conversation at the counter — a
              class to add, a stall booked, a pot to join — and without this the
              way back is the breadcrumbs plus finding them in the roster
              again. */}
          <Link
            href={`/admin/shows/${showId}/desk?exhibitor=${account.exhibitor_id}`}
            className="text-sm hover:underline inline-block"
            style={{ color: 'var(--accent)' }}
            title={`Open ${account.exhibitor_name} at the registration desk — classes, back number, side pots and paperwork`}
          >
            ← {account.exhibitor_name}&rsquo;s registration
          </Link>
          {/* First, because taking the money is what the office opened the
              row for; the bill underneath is what they check it against. */}
          <RecordPaymentForm
            showId={showId}
            account={account}
            onRecorded={onChanged}
          />
          <OfficeBillBreakdown bill={account.bill} />
          {/* What the office changes about what they owe (migration 197):
              their bookings, to match the stall chart the office keeps, and
              credits or charges with a reason. Payments and refunds are taken
              in the form above and listed below. */}
          {bookable.length > 0 && (
            <BookingsEditor
              showId={showId}
              account={account}
              bookable={bookable}
              onSaved={onChanged}
            />
          )}
          <AdjustmentsEditor showId={showId} account={account} onChanged={onChanged} />
          <PaymentHistory showId={showId} account={account} onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

/**
 * What the exhibitor has booked — stalls, passes, shavings, camping — as the
 * office sets it (migration 197). GaitDesk does not run the stall chart; this
 * is how the bill follows the one the office keeps: a tie stall for a box stall
 * when the boxes ran out, a walk-up's stalls. The whole booking is saved at
 * once, a line at nought dropped, as at sign-up. A line kept keeps its early
 * rate; one added now is today's.
 */
function BookingsEditor({
  showId,
  account,
  bookable,
  onSaved,
}: {
  showId: string;
  account: FinancialAccount;
  bookable: BookableLine[];
  onSaved: () => void;
}) {
  const booked: Record<string, number> = Object.fromEntries(
    account.bill.reservation_lines.map((line) => [line.show_fee_id, line.quantity]),
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(bookable.map((fee) => [fee.id, booked[fee.id] ?? 0])),
  );
  // Lines picked from "Add" since the last save. Only what they have booked is
  // listed — a dozen lines at 0 buries the two they bought — so a line they
  // have not booked shows once the office adds it, and stays while it is being
  // typed into even at 0.
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = bookable.some((fee) => (quantities[fee.id] ?? 0) !== (booked[fee.id] ?? 0));
  const shown = bookable.filter(
    (fee) => (booked[fee.id] ?? 0) > 0 || (quantities[fee.id] ?? 0) > 0 || added.includes(fee.id),
  );
  const addable = bookable.filter((fee) => !shown.includes(fee));

  function addLine(feeId: string) {
    setAdded((prev) => [...prev, feeId]);
    setQuantities((prev) => ({ ...prev, [feeId]: Math.max(prev[feeId] ?? 0, 1) }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/accounts/${account.exhibitor_id}/reservations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reservations: bookable
            .filter((fee) => (quantities[fee.id] ?? 0) > 0)
            .map((fee) => ({ show_fee_id: fee.id, quantity: quantities[fee.id] })),
        }),
      });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        setError(errorMessage(json, 'Could not save their bookings.'));
        return;
      }
      // A line saved at 0 goes back under "Add" once the refreshed bill lands.
      setAdded([]);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--muted)' }}>
        Stalls, shavings &amp; camping
      </h3>
      <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
        What they have booked. Change it to match your stall chart — their bill follows.
      </p>
      {shown.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Nothing booked.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((fee) => {
            const qty = quantities[fee.id] ?? 0;
            const basis = fee.one_per_exhibitor ? 'per exhibitor' : unitLabel(fee.unit);
            // A quantity like every other line, so the bill reads as one column
            // of numbers. One a head is the most anyone can have — the server
            // refuses more — so the box stops at 1.
            const max = fee.one_per_exhibitor ? 1 : 999;
            return (
              <li key={fee.id} className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0" style={{ color: 'var(--text-deep)' }}>
                  {fee.label}
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {' '}
                    {formatMoney(fee.amount_cents)} {basis}
                  </span>
                </span>
                <DotLeader />
                <input
                  type="number"
                  min={0}
                  max={max}
                  value={qty}
                  onChange={(e) =>
                    setQuantities((prev) => ({
                      ...prev,
                      [fee.id]: Math.max(0, Math.min(max, Number(e.target.value) || 0)),
                    }))
                  }
                  className="w-20 shrink-0 border rounded px-2 py-1 text-sm text-right tabular-nums"
                  style={{ borderColor: 'var(--border)' }}
                  aria-label={`${fee.label} — quantity`}
                  title={fee.one_per_exhibitor ? 'One per exhibitor — 0 or 1' : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
      {addable.length > 0 && (
        <select
          value=""
          onChange={(e) => e.target.value && addLine(e.target.value)}
          className="mt-2 border rounded px-2 py-1 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
          aria-label="Add a line they have not booked"
        >
          <option value="">+ Add a line…</option>
          {addable.map((fee) => (
            <option key={fee.id} value={fee.id}>
              {fee.label} — {formatMoney(fee.amount_cents)}{' '}
              {fee.one_per_exhibitor ? 'per exhibitor' : unitLabel(fee.unit)}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--error-strong)' }} role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void save()}
        disabled={!dirty || busy}
        title={!dirty ? 'Nothing has changed.' : undefined}
        className="mt-2 text-sm rounded px-3 py-1.5 disabled:opacity-50"
        style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
      >
        {busy ? 'Saving…' : 'Save bookings'}
      </button>
    </div>
  );
}

/**
 * The office's credits and charges (migration 197): a signed amount and the
 * reason the bill prints. A credit lowers what they owe — a tie stall given in
 * place of a box stall, a comped stall — and a charge raises it, such as the
 * cleaning fee for a stall nobody checked out. Not a payment: to give money
 * back too, record a refund in the payment form.
 */
function AdjustmentsEditor({
  showId,
  account,
  onChanged,
}: {
  showId: string;
  account: FinancialAccount;
  onChanged: () => void;
}) {
  const lines = account.bill.adjustment_lines ?? [];
  const [kind, setKind] = useState<'credit' | 'charge'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function add() {
    setError(null);
    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter the amount.');
      return;
    }
    if (!reason.trim()) {
      setError('Say what it is for — it is printed on their bill.');
      return;
    }
    setBusy(true);
    try {
      const cents = Math.round(dollars * 100) * (kind === 'credit' ? -1 : 1);
      const res = await fetch(`/api/shows/${showId}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exhibitor_id: account.exhibitor_id,
          amount_cents: cents,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(errorMessage(json, 'Could not add the adjustment.'));
        return;
      }
      setAmount('');
      setReason('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/adjustments/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        setError(errorMessage(json, 'Could not remove the adjustment.'));
        return;
      }
      setConfirmId(null);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--muted)' }}>
        Adjustments
      </h3>
      <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
        A credit or a charge, with the reason printed on their bill. To give money back as well,
        record a refund at the top.
      </p>
      {lines.length > 0 && (
        <ul className="space-y-1 mb-2">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 text-sm">
              <span style={{ color: 'var(--text-deep)' }}>
                {line.reason}
                {line.recorded_by_name && (
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {' '}
                    — {line.recorded_by_name}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3">
                <span
                  className="tabular-nums"
                  style={{ color: line.amount_cents < 0 ? 'var(--success)' : 'var(--foreground)' }}
                >
                  {line.amount_cents < 0
                    ? `−${formatMoney(-line.amount_cents)}`
                    : formatMoney(line.amount_cents)}
                </span>
                {confirmId === line.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void remove(line.id)}
                      disabled={busy}
                      className="text-xs underline"
                      style={{ color: 'var(--error-strong)' }}
                    >
                      Remove it
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="text-xs underline"
                      style={{ color: 'var(--muted)' }}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(line.id)}
                    className="text-xs underline"
                    style={{ color: 'var(--muted)' }}
                  >
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          <span className="block mb-1">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'credit' | 'charge')}
            className="border rounded px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="credit">Credit (they owe less)</option>
            <option value="charge">Charge (they owe more)</option>
          </select>
        </label>
        <label className="text-xs" style={{ color: 'var(--muted)' }}>
          <span className="block mb-1">Amount ($)</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28 border rounded px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
            placeholder="e.g. 50.00"
            aria-label="Adjustment amount"
          />
        </label>
        <label className="text-xs flex-1 min-w-[12rem]" style={{ color: 'var(--muted)' }}>
          <span className="block mb-1">Reason (printed on their bill)</span>
          <input
            type="text"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)' }}
            placeholder="e.g. Box stalls full — moved to a tie stall"
            aria-label="Adjustment reason"
          />
        </label>
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="text-sm rounded px-3 py-1.5 disabled:opacity-50"
          style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
        >
          Add
        </button>
      </div>
      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--error-strong)' }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PaymentHistory({
  showId,
  account,
  onChanged,
}: {
  showId: string;
  account: FinancialAccount;
  onChanged: () => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account.payments.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        No payments recorded against this account yet.
      </p>
    );
  }

  const remove = async (paymentId: string) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/shows/${showId}/payments/${paymentId}`, { method: 'DELETE' });
    setBusy(false);
    setConfirmId(null);
    if (!res.ok) {
      setError('Could not remove that payment. Try again.');
      return;
    }
    onChanged();
  };

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>
        Payments
      </h3>
      {error && (
        <p className="text-xs mb-1.5" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}
      <ul className="text-sm space-y-1">
        {account.payments.map((payment) => {
          const isRefund = payment.amount_cents < 0;
          return (
            <li key={payment.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span style={{ color: 'var(--text-deep)' }}>
                {formatReceivedOn(payment.received_on)} ·{' '}
                {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                {payment.reference && <> · {payment.reference}</>}
                {payment.recorded_by_name && (
                  <span style={{ color: 'var(--muted)' }}> · {payment.recorded_by_name}</span>
                )}
                {payment.note && (
                  <span style={{ color: 'var(--muted)' }}> · {payment.note}</span>
                )}
                {(payment.card_fee_cents ?? 0) > 0 && (
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}· plus {formatMoney(payment.card_fee_cents ?? 0)} card fee paid by the exhibitor
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3">
                <span
                  className="tabular-nums font-medium"
                  style={{ color: isRefund ? 'var(--warning)' : 'var(--success)' }}
                >
                  {isRefund ? '−' : ''}
                  {formatMoney(Math.abs(payment.amount_cents))}
                </span>
                {confirmId === payment.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span style={{ color: 'var(--muted)' }}>Remove?</span>
                    <button
                      onClick={() => remove(payment.id)}
                      disabled={busy}
                      className="font-medium hover:underline disabled:opacity-50"
                      style={{ color: 'var(--error)' }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      disabled={busy}
                      className="hover:underline disabled:opacity-50"
                      style={{ color: 'var(--muted)' }}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmId(payment.id)}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--muted)' }}
                    title="Only for a payment recorded in error. To give money back, record a refund instead."
                  >
                    Remove
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RecordPaymentForm({
  showId,
  account,
  onRecorded,
}: {
  showId: string;
  account: FinancialAccount;
  onRecorded: () => void;
}) {
  const owed = Math.max(account.balance_cents, 0);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('check');
  const [reference, setReference] = useState('');
  // Today, because the office nearly always records money as it is handed
  // over. Set after mount and in the reader's own zone: the server renders in
  // UTC, which is tomorrow by a US show's evening.
  const [receivedOn, setReceivedOn] = useState('');
  useEffect(() => setReceivedOn(todayIso()), []);
  const [note, setNote] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number.parseFloat(amount);
  const validAmount = Number.isFinite(parsed) && parsed > 0;

  const submit = async () => {
    if (!validAmount) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    setError(null);
    // Rounded rather than truncated: 12.345 entered by hand should not silently
    // become 12.34.
    const cents = Math.round(parsed * 100) * (isRefund ? -1 : 1);
    const res = await fetch(`/api/shows/${showId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exhibitor_id: account.exhibitor_id,
        amount_cents: cents,
        method,
        reference: reference.trim() || null,
        received_on: receivedOn || null,
        note: note.trim() || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.detail || 'Could not record that payment. Try again.');
      return;
    }
    setAmount('');
    setReference('');
    setNote('');
    setReceivedOn(todayIso());
    setIsRefund(false);
    onRecorded();
  };

  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          {isRefund ? 'Record a refund' : 'Record a payment'}
        </h3>
        <button
          onClick={() => setIsRefund(!isRefund)}
          className="text-xs hover:underline"
          style={{ color: 'var(--accent)' }}
          title={
            isRefund
              ? 'Switch back to recording money taken in'
              : 'Record money paid back out — it stays on the account as a negative line'
          }
        >
          {isRefund ? 'Switch to payment' : 'Refund instead'}
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <label className="text-xs" style={{ color: 'var(--text-deep)' }}>
          Amount
          <div className="flex items-center mt-0.5">
            <span className="px-2 text-sm" style={{ color: 'var(--muted)' }}>
              $
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full text-sm px-2 py-1.5 rounded border tabular-nums"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </div>
        </label>

        <label className="text-xs" style={{ color: 'var(--text-deep)' }}>
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--surface)' }}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs" style={{ color: 'var(--text-deep)' }}>
          Reference
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Check #, last 4…"
            className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </label>

        <label className="text-xs" style={{ color: 'var(--text-deep)' }}>
          Received
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
            title="Today unless you change it — set the day the money actually came in"
          />
        </label>
      </div>

      <label className="text-xs block mt-2" style={{ color: 'var(--text-deep)' }}>
        Note
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
          className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
        />
      </label>

      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--error-strong)' }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button
          onClick={submit}
          disabled={busy || !validAmount}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: isRefund ? 'var(--warning)' : 'var(--foreground)', color: 'var(--bg-subtle)' }}
          title={!validAmount ? 'Enter an amount greater than zero' : undefined}
        >
          {busy ? 'Saving…' : isRefund ? 'Record refund' : 'Record payment'}
        </button>
        {!isRefund && owed > 0 && (
          <button
            onClick={() => setAmount((owed / 100).toFixed(2))}
            className="text-xs hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Pay balance in full ({formatMoney(owed)})
          </button>
        )}
      </div>
    </div>
  );
}
