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

/**
 * What GaitDesk invoices this company (migration 168): each show it runs, its
 * exhibitors on the roster, at the plan's rate.
 *
 * Every figure is the backend's (`billing.platform_usage`); nothing here adds
 * anything up. Re-read whenever the plan changes, since the rate does.
 */
export default function UsageStatement({ companyId, plan }: { companyId: string; plan: string }) {
  const [usage, setUsage] = useState<CompanyUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          that starts inside a Pro+ year costs nothing per exhibitor; the year is its own line.
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs" style={{ color: 'var(--muted)' }}>
                <th className="py-1.5 pr-3 font-medium">Show</th>
                <th className="py-1.5 pr-3 font-medium">Billed at</th>
                <th className="py-1.5 pr-3 font-medium text-right">Exhibitors</th>
                <th className="py-1.5 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
              {usage.shows.map((show) => (
                <tr key={show.show_id}>
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
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs" style={{ color: 'var(--text-deep)' }}>
                    {show.billing_plan_label ?? usage.plan_label}
                    {show.rate_cents ? ` · ${formatRate(show.rate_cents)}` : ''}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{show.exhibitor_count}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(show.amount_cents)}</td>
                </tr>
              ))}
              {(usage.subscriptions ?? []).map((year) => (
                <tr key={year.id}>
                  <td className="py-2 pr-3" style={{ color: 'var(--foreground)' }}>
                    Pro+ year
                    <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                      {formatDay(year.starts_on)} – {formatDay(year.ends_on)}
                      {year.price_cents > 0 && !year.payment_received_on ? ' · unpaid' : ''}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs" style={{ color: 'var(--text-deep)' }}>Unlimited</td>
                  <td className="py-2 pr-3 text-right">—</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(year.price_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold" style={{ color: 'var(--foreground)' }}>
                <td className="pt-2 pr-3">Total</td>
                <td className="pt-2 pr-3" />
                <td className="pt-2 pr-3 text-right tabular-nums">{usage.exhibitor_count}</td>
                <td className="pt-2 text-right tabular-nums">{formatMoney(usage.amount_cents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
