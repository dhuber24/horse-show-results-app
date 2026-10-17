import { fetchShow } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import ProLockedPanel from '@/components/ProLockedPanel';
import { FINANCIAL_REPORTS, fetchMyFeatures, fetchShowPlan, showHasFeature } from '@/lib/show-companies';

/**
 * Financial reports are GaitDesk Pro (migration 168); billing and payment
 * recording on the Financials screen are not. One check for the index and
 * every report under it. The endpoints refuse a Basic show themselves
 * (`require_show_feature`) -- this only decides what the page offers.
 */
export default async function FinancialReportsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const plan = await fetchShowPlan(id, headers);
  if (showHasFeature(plan, FINANCIAL_REPORTS)) return <>{children}</>;

  const [show, mine] = await Promise.all([fetchShow(id), fetchMyFeatures(headers)]);
  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Financials', href: `/admin/shows/${id}/financials` },
            { label: 'Reports' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          Reports
        </h1>
      </div>
      <ProLockedPanel
        feature={FINANCIAL_REPORTS}
        plan={plan}
        mine={mine}
        backHref={`/admin/shows/${id}/financials`}
        backLabel="Back to Financials"
      />
    </main>
  );
}
