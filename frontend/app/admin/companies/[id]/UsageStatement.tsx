'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api-error';
import { formatMoney } from '@/lib/my-shows';
import { formatDay, formatRate, type CompanyUsage } from '@/lib/show-companies';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Open',
  ACTIVE: 'In progress',
  COMPLETED: 'Completed',
};

/** Today as `YYYY-MM-DD` in the reader's zone, for "has this show finished". */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * What GaitDesk invoices this company (migration 168): each show it runs, its
 * exhibitors on the roster, at the plan's rate — and, since migration 172,
 * the lines an invoice is issued from. Tick the shows that have finished and
 * any unpaid Pro+ year, and issue them as one invoice, due in 30 days.
 *
 * Every figure is the backend's (`billing.platform_usage`); nothing here adds
 * anything up, including the invoice's total, which the backend prices off
 * this same statement. Re-read whenever the plan or the invoices change.
 */
export default function UsageStatement({
  companyId,
  plan,
  onInvoiced,
}: {
  companyId: string;
  plan: string;
  onInvoiced?: () => void;
}) {
  const [usage, setUsage] = useState<CompanyUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosenShows, setChosenShows] = useState<Set<string>>(new Set());
  const [chosenYears, setChosenYears] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => setToday(todayIso()), []);

  useEffect(() => {
    let live = true;
    setError(null);
    fetch(`/api/show-companies/${companyId}/usage`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!live) return;
        if (res.ok) setUsage(body as CompanyUsage);
        else setError(errorMessage(body, 'The usage statement could not be loaded.'));
      })
      .catch(() => live && setError('The usage statement could not be loaded.'));
    return () => {
      live = false;
    };
  }, [companyId, plan]);

  const toggle = (set: Set<string>, id: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const chosen = chosenShows.size + chosenYears.size;

  const issue = async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/show-companies/${companyId}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        show_ids: [...chosenShows],
        subscription_ids: [...chosenYears],
        note: note.trim() || null,
      }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      setMessage({ ok: false, text: errorMessage(body, 'The invoice could not be issued.') });
      return;
    }
    setChosenShows(new Set());
    setChosenYears(new Set());
    setNote('');
    setMessage({
      ok: true,
      text: `Invoice ${body.label} issued for ${formatMoney(body.amount_cents)}, due ${formatDay(body.due_on)}. The company's show managers were emailed.`,
    });
    onInvoiced?.();
  };

  return (
    <section
      className="p-5 rounded-lg border space-y-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
          Usage
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          Every show this company runs, and the exhibitors on its roster — signed up and not
          cancelled — each at the highest plan the company held across the show&apos;s dates. A show
          that starts inside a Pro+ year costs nothing per exhibitor; the year is its own line. Tick
          finished shows and unpaid Pro+ years to invoice them, net 30.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      ) : !usage ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Loading…
        </p>
      ) : usage.shows.length === 0 && (usage.subscriptions ?? []).length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No shows yet.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
                  <th className="py-1.5 pr-2 font-medium w-8">
                    <span className="sr-only">Invoice</span>
                  </th>
                  <th className="py-1.5 pr-3 font-medium">Show</th>
                  <th className="py-1.5 pr-3 font-medium">Billed at</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Exhibitors</th>
                  <th className="py-1.5 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {usage.shows.map((show) => {
                  const running = !!today && !!show.end_date && show.end_date > today;
                  const why = show.invoice_label
                    ? `Already on invoice ${show.invoice_label}`
                    : running
                      ? 'The show has not finished — it can still gain exhibitors'
                      : undefined;
                  return (
                    <tr key={show.show_id}>
                      <td className="py-2 pr-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Invoice ${show.show_name}`}
                          checked={chosenShows.has(show.show_id)}
                          disabled={!!why}
                          title={why}
                          onChange={() => toggle(chosenShows, show.show_id, setChosenShows)}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Link
                          href={`/admin/shows/${show.show_id}`}
                          className="hover:underline"
                          style={{ color: 'var(--foreground)' }}
                        >
                          {show.show_name}
                        </Link>
                        <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                          {formatDay(show.start_date)}
                          {STATUS_LABEL[show.status] ? ` · ${STATUS_LABEL[show.status]}` : ''}
                          {show.invoice_label ? ` · on ${show.invoice_label}` : ''}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs" style={{ color: 'var(--text-deep)' }}>
                        {show.billing_plan_label ?? usage.plan_label}
                        {show.rate_cents ? ` · ${formatRate(show.rate_cents)}` : ''}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{show.exhibitor_count}</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(show.amount_cents)}</td>
                    </tr>
                  );
                })}
                {(usage.subscriptions ?? []).map((year) => {
                  const why = year.invoice_label
                    ? `Already on invoice ${year.invoice_label}`
                    : year.payment_received_on
                      ? 'Already paid'
                      : year.price_cents <= 0
                        ? 'Complimentary'
                        : undefined;
                  return (
                    <tr key={year.id}>
                      <td className="py-2 pr-2 align-top">
                        <input
                          type="checkbox"
                          aria-label="Invoice this Pro+ year"
                          checked={chosenYears.has(year.id)}
                          disabled={!!why}
                          title={why}
                          onChange={() => toggle(chosenYears, year.id, setChosenYears)}
                        />
                      </td>
                      <td className="py-2 pr-3" style={{ color: 'var(--foreground)' }}>
                        Pro+ year
                        <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                          {formatDay(year.starts_on)} – {formatDay(year.ends_on)}
                          {year.price_cents > 0 && !year.payment_received_on ? ' · unpaid' : ''}
                          {year.invoice_label ? ` · on ${year.invoice_label}` : ''}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs" style={{ color: 'var(--text-deep)' }}>Unlimited</td>
                      <td className="py-2 pr-3 text-right">—</td>
                      <td className="py-2 text-right tabular-nums">{formatMoney(year.price_cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  <td className="pt-2 pr-2" />
                  <td className="pt-2 pr-3">Total</td>
                  <td className="pt-2 pr-3" />
                  <td className="pt-2 pr-3 text-right tabular-nums">{usage.exhibitor_count}</td>
                  <td className="pt-2 text-right tabular-nums">{formatMoney(usage.amount_cents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <label className="flex-1 min-w-[12rem] text-xs" style={{ color: 'var(--muted)' }}>
              Note on the invoice (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
              />
            </label>
            <button
              type="button"
              onClick={issue}
              disabled={busy || chosen === 0}
              title={chosen === 0 ? 'Tick the shows or Pro+ year to invoice' : busy ? 'Issuing…' : undefined}
              className="text-sm font-medium px-4 py-2 rounded disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
            >
              {busy ? 'Issuing…' : chosen === 0 ? 'Issue invoice' : `Issue invoice for ${chosen} line${chosen === 1 ? '' : 's'}`}
            </button>
          </div>
          {message && (
            <p className="text-sm" style={{ color: message.ok ? 'var(--success-strong)' : 'var(--error-strong)' }}>
              {message.text}
            </p>
          )}
        </>
      )}
    </section>
  );
}
