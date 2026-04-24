import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import EditProfileForm from './EditProfileForm';
import ChangePasswordForm from './ChangePasswordForm';

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id;
  const role = (session.user as any).role;

  const headers = await getAuthHeaders();

  const userRes = await fetch(`${API_URL}/users/me`, { headers: headers!, cache: 'no-store' });
  const user = await userRes.json();

  let exhibitor: any = null;
  let horses: any[] = [];

  if (role === 'EXHIBITOR') {
    const dashRes = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, { cache: 'no-store' });
    const dash = await dashRes.json();
    exhibitor = dash.exhibitor ?? null;

    if (exhibitor) {
      const horsesRes = await fetch(`${API_URL}/exhibitors/${exhibitor.id}/horses`, { cache: 'no-store' });
      if (horsesRes.ok) horses = await horsesRes.json();
    }
  }

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>My Account</h1>
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Account Information</h2>
          <EditProfileForm user={user} />
        </div>

        {role === 'EXHIBITOR' && (
          <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
            <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>My Horses</h2>
            {!exhibitor || horses.length === 0 ? (
              <p className="text-sm" style={{ color: '#8b7355' }}>No horses have been linked to your profile yet.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: '#f0e4d0' }}>
                {horses.map((horse: any) => (
                  <li key={horse.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="text-xl">🐴</span>
                    <div>
                      <div className="font-medium text-sm" style={{ color: '#2c1810' }}>{horse.name}</div>
                      {horse.owner_name && (
                        <div className="text-xs" style={{ color: '#8b7355' }}>Owner: {horse.owner_name}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>Change Password</h2>
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  );
}
