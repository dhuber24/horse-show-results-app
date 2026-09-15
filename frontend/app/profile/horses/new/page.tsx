import Link from 'next/link';
import { auth } from '@/auth';
import { loadExhibitor } from '@/lib/exhibitor-access';
import { redirect } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import NewHorseWizard from './NewHorseWizard';

/** Static segment, so this wins over `/profile/horses/[id]`. */
export default async function NewHorsePage({
  searchParams,
}: {
  searchParams: Promise<{
    name?: string;
    association_id?: string;
    registration_number?: string;
    /** Where to go when the wizard finishes — the registration step
     *  somebody left to come here. Sanitised in `NewHorseWizard`. */
    next?: string;
  }>;
}) {
  const { name, association_id, registration_number, next } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const headers = await getAuthHeaders();

  // Keeping horses follows the exhibitor record rather than the role, so a show
  // manager who also competes can keep their own. This replaced a role check
  // plus a `GET /dashboard/exhibitor/{userId}` read — that payload is the
  // dashboard's entry list and the exhibitor on it is there to name the page.
  // /profile creates the row on first visit, so a missing one bounces there.
  const exhibitor = await loadExhibitor();
  if (!exhibitor) redirect('/profile?tab=horses');
  const exhibitorId = exhibitor.id;

  // Only the ids are needed, to mark search hits already on the profile.
  const horsesRes = await fetch(`${API_URL}/exhibitors/${exhibitorId}/my-horses`, { headers: headers!, cache: 'no-store' });
  const horses: { id: string }[] = horsesRes.ok ? await horsesRes.json() : [];

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/profile?tab=horses" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          {'<- Back to My Horses'}
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Add a Horse</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          A horse needs a registered name and an owner. Everything else can be skipped and filled in later.
        </p>
      </div>

      <NewHorseWizard
        exhibitorId={exhibitorId}
        profileHorseIds={horses.map((h) => h.id)}
        initialName={name}
        initialRegAssociationId={association_id}
        initialRegNumber={registration_number}
        nextPath={next}
      />
    </main>
  );
}
