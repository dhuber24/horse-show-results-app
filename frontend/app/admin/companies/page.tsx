import Breadcrumbs from '@/components/Breadcrumbs';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import type { ShowCompany } from '@/lib/show-companies';
import CompaniesManager from './CompaniesManager';

/**
 * Show companies — the business a paid feature is sold to (migration 142).
 *
 * GaitDesk turns a feature on for a company once the company has paid, and it
 * reaches every account in the company. The app takes no payment itself: the
 * arrangement is written in the company's notes.
 */
export default async function AdminCompaniesPage() {
  const headers = await getAuthHeaders();
  let companies: ShowCompany[] = [];
  let loadFailed = false;
  if (headers) {
    const res = await fetch(`${API_URL}/show-companies/`, { headers, cache: 'no-store' }).catch(() => null);
    if (res?.ok) companies = (await readJsonBody(res)) ?? [];
    else loadFailed = true;
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Show Companies' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Show Companies</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          The clubs and firms that run shows, the staff accounts that work for them, and the paid
          features you&apos;ve turned on for them. GaitDesk doesn&apos;t take payment yet, so a
          feature is on when you turn it on here.
        </p>
      </div>
      {loadFailed ? (
        <p className="text-sm rounded border p-3" style={{ borderColor: 'var(--error-border)', backgroundColor: 'var(--error-bg)', color: 'var(--error-strong)' }}>
          The show companies could not be loaded.
        </p>
      ) : (
        <CompaniesManager initialCompanies={companies} />
      )}
    </main>
  );
}
