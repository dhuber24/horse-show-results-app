import Link from 'next/link';
import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import { API_URL } from '@/lib/backend-fetch';
import { fetchExhibitorByUser } from '@/lib/api';
import EditUserForm from './EditUserForm';
import ChangeRoleForm from './ChangeRoleForm';
import ResetPasswordForm from './ResetPasswordForm';
import DeleteUserButton from './DeleteUserButton';

async function getUser(id: string, headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/users/${id}`, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function getExhibitorHorses(exhibitorId: string): Promise<any[]> {
  const res = await fetch(`${API_URL}/exhibitors/${exhibitorId}/owned-horses`);
  if (!res.ok) return [];
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

  let exhibitor: any = null;
  let exhibitorHorses: any[] = [];

  if (user.role === 'EXHIBITOR') {
    exhibitor = await fetchExhibitorByUser(user.id);
    if (exhibitor) {
      exhibitorHorses = await getExhibitorHorses(exhibitor.id);
    }
  }

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

      {user.role === 'EXHIBITOR' && (
        <section className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
          <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Horses</h2>
          {!exhibitor ? (
            <p className="text-sm" style={{ color: '#8b7355' }}>No exhibitor profile linked to this account.</p>
          ) : exhibitorHorses.length === 0 ? (
            <p className="text-sm" style={{ color: '#8b7355' }}>No horses registered to this exhibitor.</p>
          ) : (
            <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
              {exhibitorHorses.map((horse: any) => (
                <li key={horse.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <div className="font-medium text-sm" style={{ color: '#2c1810' }}>
                      {horse.name}
                      {horse.sex && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                          {horse.sex}
                        </span>
                      )}
                    </div>
                    <div className="text-xs mt-0.5 flex gap-x-2" style={{ color: '#8b7355' }}>
                      {horse.breed_name && <span>{horse.breed_name}</span>}
                      {horse.color_name && <span>{horse.color_name}</span>}
                      {horse.age !== null && horse.age !== undefined && <span>Age: {horse.age}</span>}
                    </div>
                  </div>
                  <Link
                    href={`/admin/horses/${horse.id}`}
                    className="text-sm ml-4 shrink-0 hover:underline"
                    style={{ color: '#8b4513' }}
                  >
                    Edit →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
