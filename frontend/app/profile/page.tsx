import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import type { MyShow } from '@/lib/my-shows';
import { loadExhibitor } from '@/lib/exhibitor-access';
import ProfileTabs from './ProfileTabs';

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

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

  // Memoised per request, and the same lookup the navbar above this page made.
  const exhibitorRow = await loadExhibitor();

  // The exhibitor tabs follow the exhibitor *record*, not the role. A show
  // manager or secretary who ticked "I also compete" at signup holds one
  // account with an `exhibitors` row on it, and their horses and show history
  // have to be reachable from somewhere. The row is created on their behalf
  // only where the role guarantees one -- an EXHIBITOR account with no row is
  // an account that predates `_ensure_role_profile` and is repaired here, while
  // creating one for every scribe who opened their profile would hand out the
  // exhibitor profile the questionnaire exists to ask about.
  if (role === 'EXHIBITOR' || exhibitorRow) {
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
    exhibitor = exhibitorRow;

    // Auto-create the exhibitor record on first visit if it doesn't exist yet
    if (!exhibitor && role === 'EXHIBITOR') {
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
