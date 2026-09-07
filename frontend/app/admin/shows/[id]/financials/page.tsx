import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { formatMoney } from '@/lib/financials';
import { loadFinancials } from './loadFinancials';
import AutoRefresh from './AutoRefresh';

/**
 * Financials for one show: what has been billed, what the office recorded
 * collecting, and who still owes.
 *
 * This page is deliberately thin: the headline money figures, and two buttons to
 * the screens that do the work — Exhibitors (per-account balances and payment
 * entry) and Reports. Everything else it once carried is a report now.
 * Registration counts and the revenue-by-category breakdown live in the
 * `registrations` and `revenue-summary` reports, where they can also be printed
 * and exported; keeping a second copy here meant two places to maintain the same
 * story and a summary you had to scroll past to reach anything.
 *
 * Every figure comes from `backend/billing.py` — the same `build_bill` the
 * exhibitor's My Shows page quotes — so nothing here is re-derived and the two
 * screens cannot disagree.
 */

function StatTile({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: 'owed' | 'paid';
}) {
  const valueColor =
    emphasis === 'owed' ? 'var(--error)' : emphasis === 'paid' ? 'var(--success)' : 'var(--foreground)';
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </p>
      <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: valueColor }}>
        {value}
      </p>
      {detail && (
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          {detail}
        </p>
      )}
    </div>
  );
}

export default async function ShowFinancialsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [show, financials] = await Promise.all([fetchShow(id), loadFinancials(id)]);

  const crumbs = (
    <Breadcrumbs
      crumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Shows', href: '/admin/shows' },
        { label: show.name, href: `/admin/shows/${id}` },
        { label: 'Financials' },
      ]}
    />
  );

  if (!financials) {
    return (
      <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          {crumbs}
          <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
            Financials
          </h1>
        </div>
        <div
          className="rounded border p-4 text-sm"
          style={{ backgroundColor: 'var(--error-bg)', borderColor: 'var(--error-border)', color: 'var(--error-strong)' }}
        >
          Couldn&rsquo;t load the financials for this show. Reload the page, and if it keeps
          happening check that you&rsquo;re assigned to this show.
        </div>
      </main>
    );
  }

  // Registration counts and the revenue-by-category breakdown are not shown
  // here — both are reports (`registrations`, `revenue-summary`), and repeating
  // them on the summary meant two places to keep telling the same story.
  const { totals } = financials;

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-8">
      {/* Read-only screen, so nothing here can be interrupted by a refresh. */}
      <AutoRefresh />

      <div>
        {crumbs}
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          Financials
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          {show.name} — what the show has billed, collected, and is still owed.
        </p>
      </div>

      {/* The two working screens. Exhibitors carries the owing count because
          "who do I still need to chase" is the reason staff open this page. */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Link
          href={`/admin/shows/${id}/financials/exhibitors`}
          className="block p-5 rounded-lg border transition-colors hover:bg-amber-50"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <div className="flex items-start gap-3">
            <div className="text-2xl" aria-hidden>
              👤
            </div>
            <div>
              <h2
                className="text-lg font-semibold flex items-center flex-wrap gap-2"
                style={{ color: 'var(--foreground)' }}
              >
                Exhibitors
                {totals.accounts_outstanding > 0 && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--error)', color: 'var(--surface)' }}
                  >
                    {totals.accounts_outstanding} owing
                  </span>
                )}
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                What each exhibitor owes, their itemized bill, and recording what they paid.
              </p>
            </div>
          </div>
        </Link>

        <Link
          href={`/admin/shows/${id}/financials/reports`}
          className="block p-5 rounded-lg border transition-colors hover:bg-amber-50"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          <div className="flex items-start gap-3">
            <div className="text-2xl" aria-hidden>
              📈
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
                Reports
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                Revenue, balances, registrations, payments, and fees sold — with CSV and print.
              </p>
            </div>
          </div>
        </Link>
      </div>

      <div
        className="rounded border px-4 py-3 text-sm"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
      >
        The app doesn&rsquo;t process payments. Amounts billed come from the show&rsquo;s own fee
        schedule, and payments are what your office records collecting at the desk — cash,
        checks, and transfers you write down here.
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
          Money
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            label="Billed"
            value={formatMoney(totals.billed_cents)}
            detail={`${totals.accounts} account${totals.accounts === 1 ? '' : 's'}`}
          />
          <StatTile
            label="Collected"
            value={formatMoney(totals.net_paid_cents)}
            detail={
              totals.refunded_cents > 0
                ? `${formatMoney(totals.collected_cents)} in, ${formatMoney(
                    totals.refunded_cents,
                  )} refunded`
                : 'Recorded at the desk'
            }
            emphasis="paid"
          />
          <StatTile
            label="Outstanding"
            value={formatMoney(totals.outstanding_cents)}
            detail={`${totals.accounts_outstanding} still owing · ${totals.accounts_unpaid} paid nothing`}
            emphasis="owed"
          />
          <StatTile
            label="Settled"
            value={String(totals.accounts_paid_in_full)}
            detail={
              totals.credit_cents > 0
                ? `includes ${formatMoney(totals.credit_cents)} overpaid`
                : 'accounts paid in full'
            }
          />
        </div>
        {totals.credit_cents > 0 && (
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Outstanding counts only what is owed. The {formatMoney(totals.credit_cents)} in
            overpayments is deliberately not netted off it — one exhibitor paying twice
            doesn&rsquo;t reduce what anyone else owes.
          </p>
        )}
      </section>

      {financials.side_pots.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
            Side pots
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Pot money is tracked separately and is not part of any exhibitor&rsquo;s bill or
            balance above — buy-ins are collected per pot, not on the show bill.
          </p>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm" style={{ backgroundColor: 'var(--surface)' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--background)' }}>
                  {['Side pot', 'Status', 'Paid entries', 'Buy-ins', 'Payout pool', 'Show keeps'].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2 font-semibold ${i === 0 || i === 1 ? 'text-left' : 'text-right'}`}
                        style={{ color: 'var(--text-deep)' }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--bg-subtle)' }}>
                {financials.side_pots.map((pot) => (
                  <tr key={pot.side_pot_id}>
                    <td className="px-3 py-2" style={{ color: 'var(--foreground)' }}>
                      {pot.name}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--muted)' }}>
                      {pot.status}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-deep)' }}>
                      {pot.paid_count} / {pot.entry_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--foreground)' }}>
                      {formatMoney(pot.buy_ins_cents)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-deep)' }}>
                      {formatMoney(pot.payout_pool_cents)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-deep)' }}>
                      {formatMoney(pot.retained_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            <Link href={`/admin/shows/${id}/side-pots`} className="underline" style={{ color: 'var(--accent)' }}>
              Manage side pots
            </Link>
          </p>
        </section>
      )}
    </main>
  );
}
