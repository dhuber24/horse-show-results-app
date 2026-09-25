import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { API_URL, getAuthHeaders, readJsonBody } from '@/lib/backend-fetch';

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

const adminTiles = [
  { href: '/admin/shows', title: 'Shows', description: 'Create, edit, and manage horse shows, classes, and entries.', icon: 'T' },
  { href: '/admin/venues', title: 'Venues', description: 'Add and update venues where shows are held.', icon: 'V' },
  { href: '/admin/horses', title: 'Horse Registry', description: 'Add and edit horses in the system.', icon: 'H' },
  { href: '/admin/trainers', title: 'Trainer Registry', description: 'Manage trainer registry records used on horse profiles.', icon: 'R' },
  { href: '/admin/judges', title: 'Judge Registry', description: 'One record per judge, shared by every show they work.', icon: 'J' },
  { href: '/admin/users', title: 'Users', description: 'Create users, assign roles, and manage Show Secretaries and Scribes.', icon: 'U' },
  { href: '/admin/companies', title: 'Show Companies', description: 'The clubs and firms that run shows, and the paid features turned on for them.', icon: 'S' },
  { href: '/admin/exhibitors', title: 'Exhibitor Records', description: 'Everyone who competes, including walk-ups the office typed in and who have no login.', icon: 'E' },
  { href: '/admin/standard-classes', title: 'Class Codes', description: "Load an association's approved class list from their published file.", icon: 'C' },
];

const showSecretaryTiles = [
  { href: '/admin/shows', title: 'My Shows', description: 'Create and manage the shows you own.', icon: 'T' },
];

const showManagerTiles = [
  { href: '/admin/shows', title: 'My Shows', description: 'Create and manage the shows you run.', icon: 'T' },
  { href: '/admin/venues', title: 'Venues', description: 'Add and update venues where your shows are held.', icon: 'V' },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  SHOW_SECRETARY: 'Show Secretary',
  SHOW_MANAGER: 'Show Manager',
};

export default async function AdminPage() {
  const session = await auth();
  const role = (session?.user as any)?.role;

  if (!session?.user) redirect('/login');
  if (role !== 'ADMIN' && role !== 'SHOW_SECRETARY' && role !== 'SHOW_MANAGER') redirect('/');

  const tiles =
    role === 'SHOW_SECRETARY' ? showSecretaryTiles :
    role === 'SHOW_MANAGER' ? showManagerTiles :
    adminTiles;
  const waiting: Record<string, string | null> =
    role === 'ADMIN' ? { '/admin/companies': await pendingCompanyRequests() } : {};

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>{ROLE_LABELS[role] ?? 'Admin'}</h1>
        <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>Back to Shows</Link>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
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
