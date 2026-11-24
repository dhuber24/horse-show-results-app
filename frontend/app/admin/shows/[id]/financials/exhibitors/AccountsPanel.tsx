'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { todayIso } from '@/lib/minor';
import {
  formatMoney,
  formatReceivedOn,
  PAYMENT_METHOD_LABELS,
  OFFICE_PAYMENT_METHODS,
  type FinancialAccount,
  type PaymentMethod,
} from '@/lib/financials';
import type { BillAdjustmentLine } from '@/lib/my-shows';
import { errorMessage } from '@/lib/api-error';
import AutoRefresh from '../AutoRefresh';
import OfficeBillBreakdown from '@/components/OfficeBillBreakdown';
import { backNumbersLabel } from '@/lib/back-numbers';

type Filter = 'owing' | 'settled' | 'all';

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
  focusExhibitorId = null,
}: {
  showId: string;
  accounts: FinancialAccount[];
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

  // The open account, if it is really in this show's accounts — a stale
  // `?exhibitor=` link, or a row deleted since, falls back to the list.
  const openAccount = openId ? accounts.find((a) => a.exhibitor_id === openId) ?? null : null;

  // Opening an account narrows the list to it (below), so a row opened from
  // far down the list would otherwise leave the window scrolled past the
  // shorter page. Bring the top of the panel — the way back to the list —
  // into view whenever one is opened and it is above the window. Keyed on the
  // id, not the account: a refresh after a payment hands back a new object for
  // the same person, and that must not move the page.
  const openKey = openAccount?.exhibitor_id ?? null;
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openKey) return;
    const section = sectionRef.current;
    if (section && section.getBoundingClientRect().top < 0) {
      section.scrollIntoView({ block: 'start' });
    }
  }, [openKey]);

  const visible = useMemo(() => {
    // One account open is the office working one person's money: only that
    // account is shown, so finishing with somebody from the bottom of the list
    // does not mean scrolling back past everybody else. Shown whatever the
    // filter says, too — a payment that settles an account would otherwise drop
    // it out of "Owing" while the office is still looking at it.
    if (openAccount) return [openAccount];
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
  }, [accounts, filter, search, openAccount]);

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
    <section ref={sectionRef} className="space-y-3 scroll-mt-4">
      {/* Paused while a row is expanded. State survives a refresh, but the list
          is sorted by balance — reordering under someone mid-entry would move
          the row they are typing into. Recording a payment refreshes explicitly,
          so nothing is missed by holding off here. */}
      <AutoRefresh paused={openAccount !== null} />

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
            onChange={(e) => {
              setSearch(e.target.value);
              // Searching is looking for somebody else: back to the list.
              setOpenId(null);
            }}
            placeholder="Name or back number"
            className="text-sm px-3 py-1.5 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
          {(['owing', 'settled', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setOpenId(null);
              }}
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

      {openAccount && (
        <button
          type="button"
          onClick={() => setOpenId(null)}
          className="text-sm hover:underline"
          style={{ color: 'var(--accent)' }}
          title="Close this account and go back to the list"
        >
          ← Back to all accounts
        </button>
      )}

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
  isOpen,
  onToggle,
  onChanged,
}: {
  showId: string;
  account: FinancialAccount;
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
          {/* An adjustment is listed once, as a line on the bill with Remove
              beside it; who added it is in the Adjustments Log report. */}
          <OfficeBillBreakdown
            bill={account.bill}
            lineAction={(line) => (
              <RemoveAdjustment key={line.id} showId={showId} line={line} onRemoved={onChanged} />
            )}
          />
          {/* What the office changes about what they owe here: a credit or a
              charge with its reason (migration 197). Bookings — stalls,
              shavings, camping — are set at the registration desk, with the
              rest of what the exhibitor signed up for; the bill above follows
              them. Payments and refunds are taken in the form above and listed
              below. */}
          <AdjustmentsEditor showId={showId} account={account} onChanged={onChanged} />
          <PaymentHistory showId={showId} account={account} onChanged={onChanged} />
        </div>
      )}
    </li>
  );
}

/** Remove, then Remove it / Keep, beside an office line on the bill. */
function RemoveAdjustment({
  showId,
  line,
  onRemoved,
}: {
  showId: string;
  line: BillAdjustmentLine;
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/adjustments/${line.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => null);
        setError(errorMessage(json, 'Could not remove it.'));
        return;
      }
      setConfirming(false);
      onRemoved();
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs underline"
        style={{ color: 'var(--muted)' }}
        aria-label={`Remove ${line.reason} from their bill`}
      >
        Remove
      </button>
    );
  }
  return (
    <span className="flex items-baseline gap-2">
      {error && (
        <span className="text-xs" style={{ color: 'var(--error-strong)' }} role="alert">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy}
        className="text-xs underline disabled:opacity-50"
        style={{ color: 'var(--error-strong)' }}
      >
        Remove it
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="text-xs underline"
        style={{ color: 'var(--muted)' }}
      >
        Keep
      </button>
    </span>
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
  const [kind, setKind] = useState<'credit' | 'charge'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: 'var(--muted)' }}>
        Adjustments
      </h3>
      <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
        A credit or a charge, added to their bill above as a line of its own with the reason you
        type. Remove one from beside it on the bill. To give money back as well, record a refund
        at the top.
      </p>
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
      <ul className="text-sm space-y-1 max-w-xl">
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
  // Paid more than they were billed: the show owes them this back. Never more
  // than they have paid: a credit larger than that (an office credit on an
  // unpaid bill) is a discount, with no money of theirs to hand back.
  const credit = Math.min(Math.max(-account.balance_cents, 0), Math.max(account.net_paid_cents, 0));
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

      {/* The quick refund: an account in credit is owed money back, and this
          fills in the form for exactly that. Not recorded on the click: the
          office still says how it went back (cash, a check and its number). */}
      {credit > 0 && !(isRefund && Math.round(parsed * 100) === credit) && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 mb-2 text-sm"
          style={{ borderColor: 'var(--warning)', backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}
        >
          <span>
            They have a <strong className="tabular-nums">{formatMoney(credit)}</strong> credit to
            refund.
          </span>
          <button
            type="button"
            onClick={() => {
              setIsRefund(true);
              setAmount((credit / 100).toFixed(2));
              setError(null);
            }}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{ backgroundColor: 'var(--warning)', color: 'var(--bg-subtle)' }}
            title="Fill in a refund of their whole credit. Pick how it went back, then Record refund."
          >
            Refund {formatMoney(credit)}
          </button>
        </div>
      )}

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
            {OFFICE_PAYMENT_METHODS.map((m) => (
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
            placeholder="Check #, last 4, Venmo…"
            className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </label>

        <label className="text-xs" style={{ color: 'var(--text-deep)' }}>
          {isRefund ? 'Paid back' : 'Received'}
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
