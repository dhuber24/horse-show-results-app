import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import { fetchMyFeatures } from '@/lib/show-companies';
import MyCompanyStaff, { type MyCompany } from './MyCompanyStaff';

/**
 * My Company — the caller's show company, run by its own managers and
 * secretaries: its plan, staff, crew and invites (migration 169). A GaitDesk
 * admin manages every company, and records Pro+ years, from Show Companies.
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

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'My Company' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>My Company</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Your company&apos;s plan, its staff — the show managers and secretaries who work every show it
          runs — and its crew of scribes and gate stewards, whom you assign show by show. Adding or
          removing somebody takes effect straight away. Below, choose how late exhibitors can cancel their
          own registration at your shows.
        </p>
      </div>
      {loadFailed ? (
        <p className="text-sm rounded border p-3" style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          Your company could not be loaded. Refresh in a moment.
        </p>
      ) : (
        <MyCompanyStaff initialCompanies={companies} plans={mine.plans} />
      )}
    </main>
  );
}
