import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import MyCompanyStaff, { type MyCompany } from './MyCompanyStaff';

/**
 * My Company Staff — who works for the caller's show company, managed by the
 * company's own managers and secretaries. A GaitDesk admin manages every
 * company, and its features, from Show Companies instead.
 */
export default async function MyCompanyPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role === 'ADMIN') redirect('/admin/companies');
  if (role !== 'SHOW_MANAGER' && role !== 'SHOW_SECRETARY') redirect('/admin');

  const headers = await getAuthHeaders();
  let companies: MyCompany[] = [];
  let loadFailed = false;
  if (headers) {
    const res = await fetch(`${API_URL}/my-company`, { headers, cache: 'no-store' }).catch(() => null);
    if (res?.ok) companies = (await readJsonBody(res)) ?? [];
    else loadFailed = true;
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'My Company Staff' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>My Company Staff</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          The show managers and secretaries who work for your company. Everyone here shares the
          company&apos;s paid features, so a GaitDesk admin approves each new member you ask for.
          Removing somebody who has left takes effect straight away. Below the staff, choose how late
          exhibitors can cancel their own registration at your shows.
        </p>
      </div>
      {loadFailed ? (
        <p className="text-sm rounded border p-3" style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          Your company could not be loaded. Refresh in a moment.
        </p>
      ) : (
        <MyCompanyStaff initialCompanies={companies} />
      )}
    </main>
  );
}
