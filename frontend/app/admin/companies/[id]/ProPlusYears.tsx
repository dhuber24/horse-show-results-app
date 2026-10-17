'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { formatDay, formatRate, type PlanInfo, type ShowCompany, type Subscription } from '@/lib/show-companies';

type Payment = 'received' | 'owed' | 'complimentary';

const EMPTY_FORM = { starts_on: '', price: '', payment: 'received' as Payment, method: '', reference: '' };

/**
 * A company's GaitDesk Pro+ years (migration 169), and starting one.
 *
 * **A GaitDesk admin starts the year, paid for or not** (migration 171): the
 * payment received, still owed (it starts now and shows *Unpaid* until it is
 * marked paid), or complimentary (nothing owed). The year is in force from its
 * first day whichever it is. The dates default to the next year -- from today,
 * or from the day after the current year ends, so a renewal paid early loses
 * nothing -- and the price to the plan's. The company's show managers are
 * emailed, and reminded a month before it ends. A year typed in error is
 * removed with an inline confirm.
 */
export default function ProPlusYears({
  company,
  plan,
  onChange,
  onError,
}: {
  company: ShowCompany;
  plan: PlanInfo | undefined;
  onChange: (company: ShowCompany) => void;
  onError: (message: string | null) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const years = [...(company.subscriptions ?? [])].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const label = plan?.label ?? 'GaitDesk Pro+';
  const listPrice = plan?.annual_cents ?? 149900;

  async function send(url: string, init: RequestInit, fallback: string) {
    setBusy(true);
    onError(null);
    const res = await fetch(url, init).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      onError(errorMessage(body, fallback));
      return false;
    }
    onChange(body as ShowCompany);
    return true;
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    let priceCents: number | null = null;
    if (form.payment === 'complimentary') priceCents = 0;
    else if (form.price.trim()) {
      const dollars = Number(form.price.replace(/[$,]/g, ''));
      if (!Number.isFinite(dollars) || dollars < 0) {
        onError('Type the price in dollars, like 1499.');
        return;
      }
      priceCents = Math.round(dollars * 100);
    }
    const ok = await send(
      `/api/show-companies/${company.id}/subscriptions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          starts_on: form.starts_on || null,
          price_cents: priceCents,
          payment_received: form.payment !== 'owed',
          payment_method: form.payment === 'received' ? form.method || null : null,
          payment_reference: form.payment === 'received' ? form.reference || null : null,
        }),
      },
      'The Pro+ year could not be started.',
    );
    if (ok) {
      setStarting(false);
      setForm(EMPTY_FORM);
    }
  }

  const markPaid = (year: Subscription) =>
    send(
      `/api/show-companies/${company.id}/subscriptions/${year.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      'The year could not be marked paid.',
    );

  const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
  const choices: { key: Payment; label: string; hint: string }[] = [
    { key: 'received', label: 'Payment received', hint: 'Paid for now.' },
    { key: 'owed', label: 'Not yet — invoice later', hint: 'Starts now and shows as unpaid until you mark it paid.' },
    { key: 'complimentary', label: 'Complimentary', hint: 'Nothing is owed.' },
  ];

  return (
    <section className="p-5 rounded-lg border space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>{label}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            {formatRate(listPrice)} a year for unlimited shows and exhibitors. Start a year whether or not it has
            been paid for — it is in force straight away, emails the company&apos;s show managers, and they&apos;re
            reminded a month before it ends. When a year runs out unrenewed the company returns to{' '}
            {company.plan_label}.
          </p>
        </div>
        {!starting && (
          <button type="button" onClick={() => setStarting(true)} className="text-sm font-medium hover:underline" style={{ color: 'var(--accent)' }}>
            Start a Pro+ year
          </button>
        )}
      </div>

      {company.pro_plus_requested_at && (
        <div
          className="rounded border p-2.5 text-xs"
          style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--text-deep)' }}
          suppressHydrationWarning
        >
          <span className="font-semibold">{company.pro_plus_requested_by_name ?? 'Somebody'}</span> asked for {label} on{' '}
          {new Date(company.pro_plus_requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {company.pro_plus_requested_by_email && (
            <>
              {' '}·{' '}
              <a href={`mailto:${company.pro_plus_requested_by_email}`} className="underline">
                {company.pro_plus_requested_by_email}
              </a>
            </>
          )}
          . Starting a year answers it.
        </div>
      )}

      {starting && (
        <form onSubmit={start} className="space-y-3 rounded border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium mb-1" style={{ color: 'var(--text-deep)' }}>Payment</legend>
            {choices.map((choice) => (
              <label key={choice.key} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-deep)' }}>
                <input
                  type="radio"
                  name={`pro-plus-payment-${company.id}`}
                  checked={form.payment === choice.key}
                  onChange={() => setForm({ ...form, payment: choice.key })}
                  className="mt-1"
                />
                <span>
                  {choice.label}
                  <span className="block text-xs" style={{ color: 'var(--muted)' }}>{choice.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs space-y-1" style={{ color: 'var(--text-deep)' }}>
              <span className="block font-medium">Year starts</span>
              <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm" style={inputStyle} />
              <span className="block" style={{ color: 'var(--muted)' }}>Blank: today, or the day after the current year ends</span>
            </label>
            {form.payment !== 'complimentary' && (
              <label className="text-xs space-y-1" style={{ color: 'var(--text-deep)' }}>
                <span className="block font-medium">{form.payment === 'received' ? 'Amount paid ($)' : 'Amount owed ($)'}</span>
                <input inputMode="decimal" placeholder={String(listPrice / 100)} value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full border rounded px-2 py-1.5 text-sm" style={inputStyle} />
              </label>
            )}
            {form.payment === 'received' && (
              <>
                <label className="text-xs space-y-1" style={{ color: 'var(--text-deep)' }}>
                  <span className="block font-medium">Paid by</span>
                  <input placeholder="Check, card, transfer…" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                    className="w-full border rounded px-2 py-1.5 text-sm" style={inputStyle} />
                </label>
                <label className="text-xs space-y-1" style={{ color: 'var(--text-deep)' }}>
                  <span className="block font-medium">Reference</span>
                  <input placeholder="Check number, invoice…" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
                    className="w-full border rounded px-2 py-1.5 text-sm" style={inputStyle} />
                </label>
              </>
            )}
          </div>
          <div className="flex gap-3 items-center">
            <button type="submit" disabled={busy} title={busy ? 'Saving…' : 'Starts the year now and emails the company'}
              className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}>
              {busy ? 'Saving…' : 'Start Pro+ year'}
            </button>
            <button type="button" onClick={() => setStarting(false)} className="text-sm hover:underline" style={{ color: 'var(--muted)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {years.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No Pro+ years yet.</p>
      ) : (
        <ul className="divide-y rounded border text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
          {years.map((year) => {
            const owed = !year.payment_received_on && year.price_cents > 0;
            return (
              <li key={year.id} className="px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <span className="font-medium flex items-center gap-2 flex-wrap" style={{ color: 'var(--foreground)' }}>
                    {formatDay(year.starts_on)} – {formatDay(year.ends_on)}
                    {owed && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }}>
                        Unpaid
                      </span>
                    )}
                    {year.price_cents === 0 && (
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' }}>
                        Complimentary
                      </span>
                    )}
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                    {formatRate(year.price_cents)}
                    {year.payment_received_on && year.price_cents > 0 ? ` · paid ${formatDay(year.payment_received_on)}` : ''}
                    {year.payment_method ? ` · ${year.payment_method}` : ''}
                    {year.payment_reference ? ` · ${year.payment_reference}` : ''}
                    {year.renewal_reminder_sent_at ? ' · renewal reminder sent' : ''}
                  </span>
                </div>
                {confirmRemove === year.id ? (
                  <span className="flex gap-3">
                    <button type="button" disabled={busy}
                      onClick={async () => {
                        await send(`/api/show-companies/${company.id}/subscriptions/${year.id}`, { method: 'DELETE' }, 'The year could not be removed.');
                        setConfirmRemove(null);
                      }}
                      className="font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                      Confirm remove
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(null)} className="hover:underline" style={{ color: 'var(--muted)' }}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className="flex gap-3">
                    {owed && (
                      <button type="button" onClick={() => markPaid(year)} disabled={busy}
                        title={busy ? 'Saving…' : 'The payment arrived today'}
                        className="font-medium hover:underline disabled:opacity-50" style={{ color: 'var(--accent)' }}>
                        Mark paid
                      </button>
                    )}
                    <button type="button" onClick={() => setConfirmRemove(year.id)} disabled={busy}
                      title={busy ? 'Saving…' : 'For a year started in error'}
                      className="hover:underline disabled:opacity-50" style={{ color: 'var(--error)' }}>
                      Remove
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
