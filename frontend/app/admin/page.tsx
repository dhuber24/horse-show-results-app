import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';
import { MY_COMPANY_TILE, ROLE_LABELS, adminSections } from './sections';

/**
 * What is waiting on a GaitDesk admin at Show Companies — a request to join,
 * or a company asking for a paid feature (migration 144). This count on the
 * tile is how an admin hears about either when mail is not configured, so
 * anything short of a clean answer shows no badge rather than a wrong one.
 */
async function pendingCompanyRequests(): Promise<string | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API_URL}/show-companies/pending-requests`, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    const body = await readJsonBody(res);
    const parts = [
      body?.upgrade_requests > 0 ? `${body.upgrade_requests} asking to upgrade` : null,
      body?.join_requests > 0 ? `${body.join_requests} asking to join` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  } catch {
    return null;
  }
}

/**
 * Somebody waiting to join one of the caller's show companies -- they typed
 * its name at sign-up (migration 143), and the company's own staff answer
 * them on My Company Staff. Like the admin's count above, anything short of a
 * clean answer shows no badge rather than a wrong one.
 */
async function pendingJoinRequests(): Promise<string | null> {
  const headers = await getAuthHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${API_URL}/my-company`, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    // Only the ones waiting on the company. A request somebody here has
    // already approved is waiting on GaitDesk, which is not theirs to chase.
    const companies: { join_requests?: { vouched_by_name?: string | null }[] }[] =
      (await readJsonBody(res)) ?? [];
    const waiting = companies.reduce(
      (sum, c) => sum + (c.join_requests ?? []).filter((r) => !r.vouched_by_name).length,
      0,
    );
    return waiting > 0 ? `${waiting} asking to join` : null;
  } catch {
    return null;
  }
}

export default async function AdminPage() {
  const session = await auth();
  const role = (session?.user as any)?.role;

  if (!session?.user) redirect('/login');
  if (role !== 'ADMIN' && role !== 'SHOW_SECRETARY' && role !== 'SHOW_MANAGER') redirect('/');

  const tiles = adminSections(role);
  const waiting: Record<string, string | null> =
    role === 'ADMIN'
      ? { '/admin/companies': await pendingCompanyRequests() }
      : { [MY_COMPANY_TILE.href]: await pendingJoinRequests() };

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>{ROLE_LABELS[role] ?? 'Admin'}</h1>
        <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>Back to Shows</Link>
      </div>
      <div className="grid sm:grid-cols-2 desktop:grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="block p-6 rounded-lg border transition-colors hover:bg-amber-50" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <div className="flex items-start gap-4">
              <div className="text-3xl" aria-hidden>{tile.icon}</div>
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{tile.title}</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{tile.description}</p>
                {waiting[tile.href] && (
                  <p
                    className="inline-block text-xs font-medium mt-2 px-2 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-strong)' }}
                  >
                    {waiting[tile.href]}
                  </p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
