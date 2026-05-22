import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import ProfileTabs from './ProfileTabs';

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id;
  const role = (session.user as any).role;

  const headers = await getAuthHeaders();

  const userRes = await fetch(`${API_URL}/users/me`, { headers: headers!, cache: 'no-store' });
  const user = await userRes.json();

  let exhibitor: any = null;
  let horses: any[] = [];
  let exhibitorDocs: any[] = [];
  let exhibitorRegs: any[] = [];
  let trainerProfile: any = null;
  let trainerHorses: any[] = [];
  let trainerAffiliations: any[] = [];

  if (role === 'EXHIBITOR') {
    const dashRes = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, { headers: headers!, cache: 'no-store' });
    const dash = await dashRes.json();
    exhibitor = dash.exhibitor ?? null;

    // Auto-create the exhibitor record on first visit if it doesn't exist yet
    if (!exhibitor) {
      const createRes = await fetch(`${API_URL}/exhibitors/me`, {
        method: 'POST',
        headers: headers!,
      });
      if (createRes.ok) {
        exhibitor = await createRes.json();
      }
    }

    if (exhibitor) {
      const [horsesRes, docsRes, regsRes] = await Promise.all([
        fetch(`${API_URL}/exhibitors/${exhibitor.id}/my-horses`, { headers: headers!, cache: 'no-store' }),
        fetch(`${API_URL}/exhibitors/${exhibitor.id}/documents`, { headers: headers!, cache: 'no-store' }),
        fetch(`${API_URL}/exhibitors/${exhibitor.id}/registrations`, { headers: headers!, cache: 'no-store' }),
      ]);
      if (horsesRes.ok) horses = await horsesRes.json();
      if (docsRes.ok) exhibitorDocs = await docsRes.json();
      if (regsRes.ok) exhibitorRegs = await regsRes.json();
    }
  }

  if (role === 'TRAINER') {
    const [trainerRes, trainerHorsesRes, trainerAffiliationsRes] = await Promise.all([
      fetch(`${API_URL}/trainers/me`, { headers: headers!, cache: 'no-store' }),
      fetch(`${API_URL}/trainers/me/horses`, { headers: headers!, cache: 'no-store' }),
      fetch(`${API_URL}/trainers/me/registrations`, { headers: headers!, cache: 'no-store' }),
    ]);
    if (trainerRes.ok) trainerProfile = await trainerRes.json();
    if (trainerHorsesRes.ok) trainerHorses = await trainerHorsesRes.json();
    if (trainerAffiliationsRes.ok) trainerAffiliations = await trainerAffiliationsRes.json();
  }

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>My Account</h1>
      </div>

      <ProfileTabs
        user={user}
        role={role}
        exhibitor={exhibitor}
        initialRegistrations={exhibitorRegs}
        initialDocuments={exhibitorDocs}
        initialHorses={horses}
        trainerProfile={trainerProfile}
        trainerHorses={trainerHorses}
        trainerAffiliations={trainerAffiliations}
        initialTab={
          tab === 'memberships' || tab === 'horses' || tab === 'affiliations' ? tab : 'account'
        }
      />
    </main>
  );
}
