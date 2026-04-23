import Link from 'next/link';
import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import { API_URL } from '@/lib/backend-fetch';
import EditUserForm from './EditUserForm';
import ChangeRoleForm from './ChangeRoleForm';
import ResetPasswordForm from './ResetPasswordForm';
import DeleteUserButton from './DeleteUserButton';

async function getUser(id: string, headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/users/${id}`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const sessionUser = session.user as any;
  if (sessionUser.role !== 'ADMIN') redirect('/admin');

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.INTERNAL_API_KEY || '',
    'X-User-Id': sessionUser.id ?? '',
    'X-User-Role': sessionUser.role ?? '',
  };

  const user = await getUser(id, headers);
  if (!user) notFound();

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href="/admin/users" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Users
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          {user.full_name}
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{user.email}</p>
      </div>

      <section className="p-5 rounded-lg border space-y-1" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Profile</h2>
        <EditUserForm user={user} />
      </section>

      <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Role</h2>
        <ChangeRoleForm user={user} />
      </section>

      <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Reset Password</h2>
        <ResetPasswordForm userId={user.id} />
      </section>

      <section className="p-5 rounded-lg border" style={{ borderColor: '#fca5a5', backgroundColor: '#fff9f9' }}>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#991b1b' }}>Danger Zone</h2>
        <DeleteUserButton userId={user.id} userName={user.full_name} />
      </section>

      <p className="text-xs font-mono" style={{ color: '#8b7355' }}>ID: {user.id}</p>
    </main>
  );
}
