'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatMoney,
  formatReceivedOn,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type FinancialAccount,
  type PaymentMethod,
} from '@/lib/financials';
import AutoRefresh from '../AutoRefresh';

type Filter = 'owing' | 'settled' | 'all';

/**
 * Per-exhibitor accounts, with the desk's record-a-payment form.
 *
 * Opens on the accounts that owe money, because that is the question the office
 * comes here with. Recording a payment writes it down — no card is charged and
 * no processor is called.
 */
export default function AccountsPanel({
  showId,
  accounts,
}: {
  showId: string;
  accounts: FinancialAccount[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('owing');
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === 'owing' && a.balance_cents <= 0) return false;
      if (filter === 'settled' && a.balance_cents > 0) return false;
      if (!term) return true;
      return (
        a.exhibitor_name.toLowerCase().includes(term) ||
        String(a.back_number ?? '').includes(term)
      );
    });
  }, [accounts, filter, search]);

  const owingCount = accounts.filter((a) => a.balance_cents > 0).length;

  if (accounts.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-6 text-center"
        style={{ borderColor: '#d4b896' }}
      >
        {/* Kept in this branch too: an empty roster is exactly when someone
            leaves this screen open waiting for sign-ups to land. */}
        <AutoRefresh />
        <p className="text-sm font-medium" style={{ color: '#2c1810' }}>
          Nobody is registered yet
        </p>
        <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
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
        <p className="text-sm" style={{ color: '#8b7355' }}>
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
            style={{ borderColor: '#d4b896', color: '#2c1810' }}
          />
          {(['owing', 'settled', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-sm font-medium px-3 py-1.5 rounded-full border transition"
              style={
                filter === f
                  ? { backgroundColor: '#8b4513', borderColor: '#8b4513', color: '#ffffff' }
                  : { backgroundColor: '#ffffff', borderColor: '#d4b896', color: '#8b4513' }
              }
            >
              {f === 'owing' ? `Owing (${owingCount})` : f === 'settled' ? 'Settled' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: '#8b7355' }}>
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
      className="rounded-lg border"
      style={{
        borderColor: owes ? '#e0b4a0' : '#e8d5b7',
        backgroundColor: owes ? '#fffdfb' : '#fdfbf7',
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={isOpen}
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center flex-wrap gap-2" style={{ color: '#2c1810' }}>
            {account.back_number !== null && (
              <span
                className="text-xs font-mono px-1.5 py-0.5 rounded"
                style={{ backgroundColor: '#f0e4d0', color: '#5d4a37' }}
              >
                #{account.back_number}
              </span>
            )}
            {account.exhibitor_name}
            {!account.signed_up && (
              <span
                className="text-xs px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: '#f3f4f6', color: '#6b7280' }}
                title="Added by the show office — this exhibitor did not complete online sign-up"
              >
                Office-added
              </span>
            )}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
            {account.entry_count} entr{account.entry_count === 1 ? 'y' : 'ies'} ·{' '}
            {account.horse_count} horse{account.horse_count === 1 ? '' : 's'} ·{' '}
            {account.payments.length} payment{account.payments.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center gap-5 text-right">
          <div>
            <p className="text-xs" style={{ color: '#8b7355' }}>
              Billed
            </p>
            <p className="text-sm font-medium tabular-nums" style={{ color: '#2c1810' }}>
              {formatMoney(account.bill.total_cents)}
            </p>
          </div>
          <div>
            <p className="text-xs" style={{ color: '#8b7355' }}>
              Paid
            </p>
            <p className="text-sm font-medium tabular-nums" style={{ color: '#2f6b3f' }}>
              {formatMoney(account.net_paid_cents)}
            </p>
          </div>
          <div>
            <p className="text-xs" style={{ color: '#8b7355' }}>
              {overpaid ? 'Credit' : 'Balance'}
            </p>
            <p
              className="text-sm font-bold tabular-nums"
              style={{ color: owes ? '#b42318' : overpaid ? '#92400e' : '#2f6b3f' }}
            >
              {formatMoney(Math.abs(account.balance_cents))}
            </p>
          </div>
          <span aria-hidden style={{ color: '#8b7355' }}>
            {isOpen ? '▾' : '▸'}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-4 border-t pt-3" style={{ borderColor: '#f0e4d0' }}>
          <BillBreakdown account={account} />
          <PaymentHistory showId={showId} account={account} onChanged={onChanged} />
          <RecordPaymentForm
            showId={showId}
            account={account}
            onRecorded={onChanged}
          />
        </div>
      )}
    </li>
  );
}

function BillBreakdown({ account }: { account: FinancialAccount }) {
  const { bill } = account;
  const rows = [
    { label: 'Class entry fees', cents: bill.class_fee_total_cents },
    { label: 'NSBA sanction fees', cents: bill.nsba_sanction_total_cents },
    {
      label: `Office charge (${
        bill.office_charge_basis === 'per_horse' ? 'per horse' : 'per back number'
      })`,
      cents: bill.office_charge_total_cents,
    },
    ...bill.reservation_lines.map((line) => ({
      label: `${line.label} — ${line.quantity} × ${formatMoney(line.amount_cents)}${
        line.is_early_rate ? ' (early rate)' : ''
      }`,
      cents: line.line_total_cents,
    })),
    // Futurity money is its own line per horse, because the per-class rate is
    // the entrant's category rate and appears nowhere in `class_lines` — those
    // classes are $0. Reading the two together is how you check a futurity
    // bill, so the horse and the category are both named.
    ...(bill.futurity_lines ?? []).map((line) => ({
      label:
        `${line.futurity_name} — ${line.horse_name ?? 'horse'}` +
        (line.fee_tier_name ? ` (${line.fee_tier_name})` : '') +
        `, ${line.class_count} ${line.class_count === 1 ? 'class' : 'classes'}` +
        (line.is_late ? ' + late fee' : '') +
        (line.membership_fee_cents > 0
          ? ` + ${line.membership_name ?? 'membership'}`
          : ''),
      cents: line.line_total_cents,
    })),
  ].filter((r) => r.cents !== 0);

  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#8b7355' }}>
        Bill
      </h3>
      <dl className="text-sm space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt style={{ color: '#5d4a37' }}>{row.label}</dt>
            <dd className="tabular-nums" style={{ color: '#2c1810' }}>
              {formatMoney(row.cents)}
            </dd>
          </div>
        ))}
        <div
          className="flex justify-between gap-4 pt-1.5 mt-1.5 border-t font-semibold"
          style={{ borderColor: '#f0e4d0' }}
        >
          <dt style={{ color: '#2c1810' }}>Total billed</dt>
          <dd className="tabular-nums" style={{ color: '#2c1810' }}>
            {formatMoney(bill.total_cents)}
          </dd>
        </div>
      </dl>
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
      <p className="text-sm" style={{ color: '#8b7355' }}>
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
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#8b7355' }}>
        Payments
      </h3>
      {error && (
        <p className="text-xs mb-1.5" style={{ color: '#991b1b' }}>
          {error}
        </p>
      )}
      <ul className="text-sm space-y-1">
        {account.payments.map((payment) => {
          const isRefund = payment.amount_cents < 0;
          return (
            <li key={payment.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span style={{ color: '#5d4a37' }}>
                {formatReceivedOn(payment.received_on)} ·{' '}
                {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                {payment.reference && <> · {payment.reference}</>}
                {payment.recorded_by_name && (
                  <span style={{ color: '#8b7355' }}> · {payment.recorded_by_name}</span>
                )}
                {payment.note && (
                  <span style={{ color: '#8b7355' }}> · {payment.note}</span>
                )}
              </span>
              <span className="flex items-center gap-3">
                <span
                  className="tabular-nums font-medium"
                  style={{ color: isRefund ? '#92400e' : '#2f6b3f' }}
                >
                  {isRefund ? '−' : ''}
                  {formatMoney(Math.abs(payment.amount_cents))}
                </span>
                {confirmId === payment.id ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span style={{ color: '#8b7355' }}>Remove?</span>
                    <button
                      onClick={() => remove(payment.id)}
                      disabled={busy}
                      className="font-medium hover:underline disabled:opacity-50"
                      style={{ color: '#b42318' }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      disabled={busy}
                      className="hover:underline disabled:opacity-50"
                      style={{ color: '#8b7355' }}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmId(payment.id)}
                    className="text-xs hover:underline"
                    style={{ color: '#8b7355' }}
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
  const [receivedOn, setReceivedOn] = useState('');
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
    setReceivedOn('');
    setIsRefund(false);
    onRecorded();
  };

  return (
    <div className="rounded border p-3" style={{ borderColor: '#e8d5b7', backgroundColor: '#ffffff' }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#8b7355' }}>
          {isRefund ? 'Record a refund' : 'Record a payment'}
        </h3>
        <button
          onClick={() => setIsRefund(!isRefund)}
          className="text-xs hover:underline"
          style={{ color: '#8b4513' }}
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
        <label className="text-xs" style={{ color: '#5d4a37' }}>
          Amount
          <div className="flex items-center mt-0.5">
            <span className="px-2 text-sm" style={{ color: '#8b7355' }}>
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
              style={{ borderColor: '#d4b896', color: '#2c1810' }}
            />
          </div>
        </label>

        <label className="text-xs" style={{ color: '#5d4a37' }}>
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
            style={{ borderColor: '#d4b896', color: '#2c1810', backgroundColor: '#ffffff' }}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs" style={{ color: '#5d4a37' }}>
          Reference
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Check #, last 4…"
            className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
            style={{ borderColor: '#d4b896', color: '#2c1810' }}
          />
        </label>

        <label className="text-xs" style={{ color: '#5d4a37' }}>
          Received
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
            style={{ borderColor: '#d4b896', color: '#2c1810' }}
            title="Leave blank for today"
          />
        </label>
      </div>

      <label className="text-xs block mt-2" style={{ color: '#5d4a37' }}>
        Note
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
          className="w-full mt-0.5 text-sm px-2 py-1.5 rounded border"
          style={{ borderColor: '#d4b896', color: '#2c1810' }}
        />
      </label>

      {error && (
        <p className="text-xs mt-2" style={{ color: '#991b1b' }}>
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button
          onClick={submit}
          disabled={busy || !validAmount}
          className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: isRefund ? '#92400e' : '#2c1810', color: '#f5ede0' }}
          title={!validAmount ? 'Enter an amount greater than zero' : undefined}
        >
          {busy ? 'Saving…' : isRefund ? 'Record refund' : 'Record payment'}
        </button>
        {!isRefund && owed > 0 && (
          <button
            onClick={() => setAmount((owed / 100).toFixed(2))}
            className="text-xs hover:underline"
            style={{ color: '#8b4513' }}
          >
            Pay balance in full ({formatMoney(owed)})
          </button>
        )}
      </div>
    </div>
  );
}
