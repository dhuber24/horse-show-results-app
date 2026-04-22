import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { API_URL } from '@/lib/backend-fetch';
import UserTable from './UserTable';
import CreateUserForm from './CreateUserForm';

async function getUsers(headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/users/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const user = session.user as any;
  if (user.role !== 'ADMIN') redirect('/admin');

  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': INTERNAL_API_KEY,
    'X-User-Id': user.id ?? '',
    'X-User-Role': user.role ?? '',
  };

  const users = await getUsers(headers);

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold" style={{ color: '#2c1810' }}>User Management</h1>
        <a href="/admin" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Admin
        </a>
      </div>

      <div className="mb-8 p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Create New User</h2>
        <CreateUserForm />
      </div>

      <div className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>All Users</h2>
        <UserTable initialUsers={users} />
      </div>
    </main>
  );
}
