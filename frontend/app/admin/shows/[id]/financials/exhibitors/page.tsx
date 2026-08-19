import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { formatMoney } from '@/lib/financials';
import { loadFinancials } from '../loadFinancials';
import AccountsPanel from './AccountsPanel';

/**
 * Per-exhibitor accounts: what each one was billed, what they have paid, and
 * what they still owe — plus the desk's record-a-payment form.
 *
 * Split out from the Financials overview because this is the working screen.
 * The overview answers "how did the show do"; this answers "who do I chase, and
 * here is the check they just handed me", which is a list the office scrolls and
 * types into rather than a set of totals it reads.
 */
export default async function FinancialExhibitorsPage({
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
        { label: 'Financials', href: `/admin/shows/${id}/financials` },
        { label: 'Exhibitors' },
      ]}
    />
  );

  if (!financials) {
    return (
      <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          {crumbs}
          <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
            Exhibitors
          </h1>
        </div>
        <div
          className="rounded border p-4 text-sm"
          style={{ backgroundColor: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}
        >
          Couldn&rsquo;t load the accounts for this show. Reload the page, and if it keeps
          happening check that you&rsquo;re assigned to this show.
        </div>
      </main>
    );
  }

  const { totals } = financials;

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        {crumbs}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
            Exhibitors
          </h1>
          <Link
            href={`/admin/shows/${id}/financials/reports/outstanding-balances`}
            className="px-3 py-2 rounded text-sm font-medium border"
            style={{ borderColor: '#d4b896', color: '#8b4513', backgroundColor: '#ffffff' }}
            title="The same accounts as a printable report with CSV export"
          >
            🧾 Outstanding report
          </Link>
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — what each exhibitor owes, and the payments your office has recorded.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: 'Billed', value: formatMoney(totals.billed_cents), color: '#2c1810' },
          { label: 'Collected', value: formatMoney(totals.net_paid_cents), color: '#2f6b3f' },
          { label: 'Outstanding', value: formatMoney(totals.outstanding_cents), color: '#b42318' },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border p-4"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <p
              className="text-xs font-medium uppercase tracking-wide"
              style={{ color: '#8b7355' }}
            >
              {tile.label}
            </p>
            <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: tile.color }}>
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      <div
        className="rounded border px-4 py-3 text-sm"
        style={{ backgroundColor: '#faf7f2', borderColor: '#d4b896', color: '#5d4a37' }}
      >
        Expand an exhibitor to see their itemized bill and record what they paid. The app
        doesn&rsquo;t process payments — this is where you write down the cash, checks, and
        transfers your office collected.
      </div>

      <AccountsPanel showId={id} accounts={financials.accounts} />
    </main>
  );
}
