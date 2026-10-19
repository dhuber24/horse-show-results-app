import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import type { GaitDeskInvoice, SettleUp } from '@/lib/payments';
import { fetchMyFeatures } from '@/lib/show-companies';
import CompanyBilling, { type OnlinePayments } from './CompanyBilling';
import MyCompanyStaff, { type MyCompany } from './MyCompanyStaff';

/**
 * My Company — the caller's show company, run by its own managers and
 * secretaries: its plan, staff, crew and invites (migration 169), and its
 * money (migration 172) — the invoices GaitDesk sends it, and its own Stripe
 * account for exhibitors' payments. A GaitDesk admin manages every company,
 * issues invoices and records Pro+ years, from Show Companies.
 */
export default async function MyCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string; invoice?: string }>;
}) {
  const { stripe, invoice } = await searchParams;
  const session = await auth();
  // An invoice email links here (`?invoice=`); signing in brings them back to it.
  if (!session?.user) {
    const here = invoice ? `/admin/my-company?invoice=${encodeURIComponent(invoice)}` : '/admin/my-company';
    redirect(`/login?next=${encodeURIComponent(here)}`);
  }
  const role = (session.user as { role?: string }).role;
  if (role === 'ADMIN') redirect('/admin/companies');
  if (role !== 'SHOW_MANAGER' && role !== 'SHOW_SECRETARY') redirect('/admin');

  const headers = await getAuthHeaders();
  let companies: MyCompany[] = [];
  let loadFailed = false;
  // The plans and their prices ride on the caller's features -- the one place
  // the frontend reads them from.
  const [res, mine] = await Promise.all([
    headers ? fetch(`${API_URL}/my-company`, { headers, cache: 'no-store' }).catch(() => null) : null,
    fetchMyFeatures(headers),
  ]);
  if (headers) {
    if (res?.ok) companies = (await readJsonBody(res)) ?? [];
    else loadFailed = true;
  }

  // Each company's invoices and Stripe account. A failure leaves that panel
  // out rather than taking the staff screen down with it.
  const billing = await Promise.all(
    companies.map(async (company) => {
      const [invoicesRes, onlineRes, settleRes] = await Promise.all([
        fetch(`${API_URL}/my-company/${company.id}/invoices`, { headers: headers!, cache: 'no-store' }).catch(() => null),
        fetch(`${API_URL}/my-company/${company.id}/online-payments`, { headers: headers!, cache: 'no-store' }).catch(() => null),
        fetch(`${API_URL}/my-company/${company.id}/settle-up`, { headers: headers!, cache: 'no-store' }).catch(() => null),
      ]);
      const invoices = (invoicesRes?.ok ? await readJsonBody(invoicesRes) : null) as GaitDeskInvoice[] | null;
      const online = (onlineRes?.ok ? await readJsonBody(onlineRes) : null) as OnlinePayments | null;
      const settleUp = (settleRes?.ok ? await readJsonBody(settleRes) : null) as SettleUp | null;
      return { company, invoices: invoices ?? [], online, settleUp };
    }),
  );

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'My Company' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>My Company</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Your company&apos;s plan, its staff — the show managers and secretaries who work every show it
          runs — and its crew of scribes and gate stewards, whom you assign show by show. Adding or
          removing somebody takes effect straight away. Below, choose how late exhibitors can cancel their
          own registration at your shows, pay GaitDesk&apos;s invoices, and set up online payments from exhibitors.
        </p>
      </div>
      {loadFailed ? (
        <p className="text-sm rounded border p-3" style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          Your company could not be loaded. Refresh in a moment.
        </p>
      ) : (
        <>
          <MyCompanyStaff initialCompanies={companies} plans={mine.plans} canBuyOnline={mine.can_pay_online === true} />
          {billing.map(({ company, invoices, online, settleUp }) => (
            <CompanyBilling
              key={company.id}
              companyId={company.id}
              companyName={company.name}
              showName={billing.length > 1}
              invoices={invoices}
              online={online}
              settleUp={settleUp}
              stripeReturn={stripe ?? null}
              openInvoiceId={invoice ?? null}
            />
          ))}
        </>
      )}
    </main>
  );
}
