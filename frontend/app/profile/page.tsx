import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import type { MyShow } from '@/lib/my-shows';
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
  let exhibitorCards: any[] = [];
  let trainerProfile: any = null;
  let trainerHorses: any[] = [];
  let trainerAffiliations: any[] = [];
  let showHistory: MyShow[] = [];

  if (role === 'EXHIBITOR') {
    // The exhibitor record itself, not the dashboard's summary of it.
    //
    // This used to read `GET /dashboard/exhibitor/{userId}`, whose payload is
    // `{id, full_name}` and nothing else -- it is the entry list for the
    // dashboard, and the exhibitor on it is there to name the page. So every
    // contact box on this screen rendered empty however much was on file, and
    // pressing Save wrote a null over each one, because the form sends what the
    // boxes hold. Somebody who filled in their details during show registration
    // saw a blank profile, retyped the fields they noticed, and silently lost
    // the ones they did not. `by-user` returns the whole `ExhibitorOut`, which
    // is the same row `/shows/[id]/register` prefills its step one from.
    const exRes = await fetch(`${API_URL}/exhibitors/by-user/${userId}`, { headers: headers!, cache: 'no-store' });
    if (exRes.ok) exhibitor = await exRes.json();

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
      const [horsesRes, docsRes, regsRes, cardsRes, showsRes] = await Promise.all([
        fetch(`${API_URL}/exhibitors/${exhibitor.id}/my-horses`, { headers: headers!, cache: 'no-store' }),
        fetch(`${API_URL}/exhibitors/${exhibitor.id}/documents`, { headers: headers!, cache: 'no-store' }),
        fetch(`${API_URL}/exhibitors/${exhibitor.id}/registrations`, { headers: headers!, cache: 'no-store' }),
        fetch(`${API_URL}/exhibitors/${exhibitor.id}/competition-cards`, { headers: headers!, cache: 'no-store' }),
        fetch(`${API_URL}/my-shows/`, { headers: headers!, cache: 'no-store' }),
      ]);
      if (horsesRes.ok) horses = await horsesRes.json();
      if (docsRes.ok) exhibitorDocs = await docsRes.json();
      if (regsRes.ok) exhibitorRegs = await regsRes.json();
      if (cardsRes.ok) exhibitorCards = await cardsRes.json();
      // Same payload the My Shows page reads, so history and bills agree.
      if (showsRes.ok) showHistory = ((await showsRes.json())?.shows ?? []) as MyShow[];
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
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>My Account</h1>
      </div>

      <ProfileTabs
        user={user}
        role={role}
        exhibitor={exhibitor}
        initialRegistrations={exhibitorRegs}
        initialDocuments={exhibitorDocs}
        initialCompetitionCards={exhibitorCards}
        initialHorses={horses}
        trainerProfile={trainerProfile}
        trainerHorses={trainerHorses}
        trainerAffiliations={trainerAffiliations}
        showHistory={showHistory}
        initialTab={
          tab === 'memberships' || tab === 'horses' || tab === 'affiliations' || tab === 'history'
            ? tab
            : 'account'
        }
      />
    </main>
  );
}
