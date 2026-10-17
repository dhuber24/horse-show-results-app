import Breadcrumbs from '@/components/Breadcrumbs';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import type { ShowCompany } from '@/lib/show-companies';
import CompaniesManager from './CompaniesManager';

/**
 * Show companies — the business a plan is sold to (migrations 142, 168).
 *
 * GaitDesk sets a company's plan, and it reaches every account in the company. The app takes no payment itself: the
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
          The clubs and firms that run shows, the staff accounts that work for them, and the plan
          each is on — GaitDesk Basic or GaitDesk Pro, both charged per exhibitor registered to a
          show. GaitDesk doesn&apos;t take payment in the app yet, so a plan is in effect when you
          set it here; each company&apos;s page has the usage statement to invoice from.
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
