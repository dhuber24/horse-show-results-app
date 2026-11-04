'use client';

import { useState } from 'react';
import LocalTime from '@/components/LocalTime';
import { errorMessage } from '@/lib/api-error';
import { formatDay, formatRate } from '@/lib/show-companies';
import { parseDollars, type PriceChange, type SubscriptionPrice } from '@/lib/subscriptions';

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;

type Result = { ok: boolean; text: string };

function resultText(change: PriceChange, label: string): Result {
  if (!change.notice_needed) return { ok: true, text: `${label} saved.` };
  if (!change.mail_configured) {
    return {
      ok: false,
      text: `${label} saved, but email isn't set up, so nobody was told. The Terms promise 30 days' notice by email: send it another way.`,
    };
  }
  return {
    ok: true,
    text: `${label} saved. ${change.companies_notified} ${change.companies_notified === 1 ? 'company is' : 'companies are'} being emailed the notice.`,
  };
}

function PriceRowEditor({
  price,
  onChange,
}: {
  price: SubscriptionPrice;
  onChange: (prices: SubscriptionPrice[], result: Result | null) => void;
}) {
  const [amount, setAmount] = useState('');
  const [effective, setEffective] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Result | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const cents = parseDollars(amount);
  const invalid = cents === null || cents < price.minimum_cents;

  async function save() {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/subscriptions/prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: price.key, amount_cents: cents, effective_on: effective || null }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) {
      setMessage({ ok: false, text: errorMessage(body, 'The price could not be saved.') });
      return;
    }
    const change = body as PriceChange;
    setAmount('');
    setEffective('');
    setMessage(resultText(change, price.label));
    onChange(change.prices, null);
  }

  async function cancelScheduled(id: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/subscriptions/prices/${id}`, { method: 'DELETE' }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    setCancelling(null);
    if (!res?.ok) {
      setMessage({ ok: false, text: errorMessage(body, 'The change could not be cancelled.') });
      return;
    }
    setMessage({ ok: true, text: 'Scheduled change cancelled. Anybody already emailed about it has not been told.' });
    onChange(body as SubscriptionPrice[], null);
  }

  const whenText = effective ? `from ${formatDay(effective)}` : 'from today';
  const scheduled = price.history.filter((row) => row.scheduled);

  return (
    <li className="border rounded p-4 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium" style={{ color: 'var(--foreground)' }}>{price.label}</h3>
        <p className="text-lg font-semibold tabular-nums" style={{ color: 'var(--foreground)' }}>
          {formatRate(price.current_cents)}
          <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}> / {price.per}</span>
        </p>
      </div>

      {scheduled.map((row) => (
        <div
          key={row.id}
          className="text-sm rounded border p-2 flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}
        >
          <span>{formatRate(row.amount_cents)} from {formatDay(row.effective_on)}</span>
          {cancelling === row.id ? (
            <span className="flex items-center gap-2">
              Cancel this change?
              <button type="button" disabled={busy} onClick={() => cancelScheduled(row.id)} className="font-medium hover:underline" style={{ color: 'var(--error-strong)' }}>
                Yes, cancel it
              </button>
              <button type="button" onClick={() => setCancelling(null)} className="hover:underline" style={{ color: 'var(--muted)' }}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setCancelling(row.id)} className="hover:underline" style={{ color: 'var(--error-strong)' }}>
              Cancel
            </button>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`price-${price.key}`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
            New price
          </label>
          <input
            id={`price-${price.key}`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirming(false);
            }}
            placeholder={(price.current_cents / 100).toFixed(2)}
            className="border rounded px-3 py-2 text-sm w-28"
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor={`price-${price.key}-from`} className="block text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>
            From
          </label>
          <input
            id={`price-${price.key}-from`}
            type="date"
            value={effective}
            onChange={(e) => {
              setEffective(e.target.value);
              setConfirming(false);
            }}
            className="border rounded px-3 py-2 text-sm"
            style={inputStyle}
          />
        </div>
        {!confirming && (
          <button
            type="button"
            disabled={invalid || busy}
            title={
              cents === null
                ? 'Type the new price'
                : invalid
                  ? `Paid by card, so at least ${formatRate(price.minimum_cents)}`
                  : busy
                    ? 'Working…'
                    : undefined
            }
            onClick={() => setConfirming(true)}
            className="px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            Change price
          </button>
        )}
      </div>

      {confirming && cents !== null && (
        <div className="text-sm rounded border p-3 space-y-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}>
          <p className="font-medium" style={{ color: 'var(--foreground)' }}>
            Set {price.label} to {formatRate(cents)} / {price.per} {whenText}?
          </p>
          <p>
            {price.audience === 'trainers'
              ? 'New subscribers pay this. A trainer already paying by card keeps the price they started at until they subscribe again.'
              : price.per === 'year'
                ? 'A Pro+ year already started keeps its price. A raise emails every company renewing Pro+ the notice the Terms promise, and it must be at least 30 days away.'
                : 'A show that starts before that day keeps the old price. A raise emails every company on this plan the notice the Terms promise, and it must be at least 30 days away.'}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              title={busy ? 'Saving…' : undefined}
              onClick={save}
              className="px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              {busy ? 'Saving…' : 'Yes, change it'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="hover:underline" style={{ color: 'var(--muted)' }}>
              Back
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role={message.ok ? 'status' : 'alert'} className="text-sm" style={{ color: message.ok ? 'var(--success-strong)' : 'var(--error-strong)' }}>
          {message.text}
        </p>
      )}

      <div>
        <button
          type="button"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((v) => !v)}
          className="text-xs hover:underline"
          style={{ color: 'var(--muted)' }}
        >
          {showHistory ? '▾' : '▸'} Price history
        </button>
        {showHistory && (
          <ul className="mt-2 text-xs space-y-1" style={{ color: 'var(--text-deep)' }}>
            {price.history.map((row) => (
              <li key={row.id}>
                {formatRate(row.amount_cents)} from{' '}
                {row.effective_on.startsWith('1970') ? 'the start' : formatDay(row.effective_on)}
                {row.set_by_name && (
                  <span style={{ color: 'var(--muted)' }}>
                    {' '}· set by {row.set_by_name}
                    {row.created_at && (
                      <>
                        {' '}on <LocalTime iso={row.created_at} format={{ month: 'short', day: 'numeric', year: 'numeric' }} />
                      </>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * What GaitDesk charges. A price is a history (`subscription_prices.py`): each
 * change starts on a day and nothing already in force moves, so the form asks
 * for a day and says, before it saves, who a change reaches.
 */
export default function PriceEditor({ initialPrices }: { initialPrices: SubscriptionPrice[] }) {
  const [prices, setPrices] = useState(initialPrices);
  const groups: { audience: SubscriptionPrice['audience']; title: string }[] = [
    { audience: 'companies', title: 'Show companies' },
    { audience: 'trainers', title: 'Trainer Registry' },
  ];

  return (
    <div className="space-y-6">
      <p
        className="text-sm rounded border p-3"
        style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}
      >
        The <a href="/terms" target="_blank" rel="noopener" className="underline">Terms of Service</a> print these prices
        in sections 6, 7 and 9, and don&apos;t follow a change made here. Update them with the change.
      </p>
      {groups.map(({ audience, title }) => (
        <section key={audience} className="space-y-3">
          <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>{title}</h2>
          <ul className="space-y-2">
            {prices
              .filter((p) => p.audience === audience)
              .map((price) => (
                <PriceRowEditor key={price.key} price={price} onChange={(next) => setPrices(next)} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
