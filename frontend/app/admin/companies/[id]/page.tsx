import { notFound } from 'next/navigation';
import Breadcrumbs from '@/components/Breadcrumbs';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import { fetchMyFeatures, type ShowCompany } from '@/lib/show-companies';
import CompanyDetail, { type StaffAccount } from './CompanyDetail';

/**
 * One show company: its plan and what it has used (migration 168), its add-on
 * features, the accounts they reach, and the admin's notes on the arrangement.
 *
 * The accounts offered are show managers and show secretaries — the roles that
 * create shows, which is where every paid feature so far is used.
 */
async function fetchStaff(headers: Record<string, string>, role: string): Promise<StaffAccount[]> {
  const res = await fetch(`${API_URL}/users/by-role?role=${role}`, { headers, cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return [];
  return (await readJsonBody(res)) ?? [];
}

export default async function AdminCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  if (!headers) notFound();

  // `plans` rides on the caller's features -- the one place the frontend reads
  // what each plan includes and costs (migration 168).
  const [companyRes, managers, secretaries, mine] = await Promise.all([
    fetch(`${API_URL}/show-companies/${id}`, { headers, cache: 'no-store' }).catch(() => null),
    fetchStaff(headers, 'SHOW_MANAGER'),
    fetchStaff(headers, 'SHOW_SECRETARY'),
    fetchMyFeatures(headers),
  ]);
  if (!companyRes?.ok) notFound();
  const company: ShowCompany | null = await readJsonBody(companyRes);
  if (!company) notFound();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Show Companies', href: '/admin/companies' },
            { label: company.name },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>{company.name}</h1>
      </div>
      <CompanyDetail initialCompany={company} staff={[...managers, ...secretaries]} plans={mine.plans} />
    </main>
  );
}
