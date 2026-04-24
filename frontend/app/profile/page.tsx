import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import EditProfileForm from './EditProfileForm';
import ChangePasswordForm from './ChangePasswordForm';
import MyHorsesPanel from './MyHorsesPanel';

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
      const horsesRes = await fetch(`${API_URL}/exhibitors/${exhibitor.id}/owned-horses`, { headers: headers!, cache: 'no-store' });
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

        {role === 'EXHIBITOR' && exhibitor && (
          <div className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
            <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>My Horses</h2>
            <MyHorsesPanel
              exhibitorId={exhibitor.id}
              initialHorses={horses}
            />
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
