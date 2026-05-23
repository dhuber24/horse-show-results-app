import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { API_URL } from '@/lib/backend-fetch';
import UserTable from './UserTable';
import Breadcrumbs from '@/components/Breadcrumbs';

async function getUsers(headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/users/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const user = session.user as any;

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.INTERNAL_API_KEY || '',
    'X-User-Id': user.id ?? '',
    'X-User-Role': user.role ?? '',
  };

  const users = await getUsers(headers);

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-6">
      <div className="mb-8">
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Users' },
        ]} />
        <h1 className="text-3xl font-bold mt-2" style={{ color: '#2c1810' }}>User Management</h1>
      </div>

      <div className="flex justify-end mb-4">
        <Link
          href="/admin/users/new"
          className="px-4 py-2 rounded text-sm font-medium text-white"
          style={{ backgroundColor: '#8b4513' }}
        >
          + Add User
        </Link>
      </div>

      <div className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-4">
          <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>All Users</h2>
          {users.length > 0 && (
            <span className="text-xs" style={{ color: '#8b7355' }}>
              {(['ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY', 'SCOREKEEPER', 'EXHIBITOR', 'TRAINER'] as const)
                .map(role => {
                  const count = users.filter((u: any) => u.role === role).length;
                  if (count === 0) return null;
                  const labels: Record<string, string> = { ADMIN: 'Admin', SHOW_MANAGER: 'Manager', SHOW_SECRETARY: 'Secretary', SCOREKEEPER: 'Scorekeeper', EXHIBITOR: 'Exhibitor', TRAINER: 'Trainer' };
                  return `${count} ${labels[role]}${count !== 1 ? 's' : ''}`;
                })
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>
        <UserTable initialUsers={users} />
      </div>
    </main>
  );
}
