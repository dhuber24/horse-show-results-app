import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import NewHorseWizard from './NewHorseWizard';

/** Static segment, so this wins over `/profile/horses/[id]`. */
export default async function NewHorsePage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; association_id?: string; registration_number?: string }>;
}) {
  const { name, association_id, registration_number } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id;
  const role = (session.user as any).role;
  if (role !== 'EXHIBITOR') redirect('/profile');

  const headers = await getAuthHeaders();

  const dashRes = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, { headers: headers!, cache: 'no-store' });
  const dash = await dashRes.json();
  const exhibitorId: string | null = dash.exhibitor?.id ?? null;
  // /profile creates the exhibitor row on first visit — bounce there if it's missing.
  if (!exhibitorId) redirect('/profile?tab=horses');

  // Only the ids are needed, to mark search hits already on the profile.
  const horsesRes = await fetch(`${API_URL}/exhibitors/${exhibitorId}/my-horses`, { headers: headers!, cache: 'no-store' });
  const horses: { id: string }[] = horsesRes.ok ? await horsesRes.json() : [];

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/profile?tab=horses" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          {'<- Back to My Horses'}
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Add a Horse</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          A horse needs a registered name and an owner. Everything else can be skipped and filled in later.
        </p>
      </div>

      <NewHorseWizard
        exhibitorId={exhibitorId}
        profileHorseIds={horses.map((h) => h.id)}
        initialName={name}
        initialRegAssociationId={association_id}
        initialRegNumber={registration_number}
      />
    </main>
  );
}
