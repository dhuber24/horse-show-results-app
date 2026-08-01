import Link from 'next/link';
import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import EditMyHorseForm, { HorseSectionKey } from './EditMyHorseForm';

/** `?section=` deep-links to a collapsible section. `documents` is the older
 *  spelling still used by the Documents link on the My Horses list. */
const SECTION_ALIASES: Record<string, HorseSectionKey> = {
  details: 'details',
  people: 'people',
  health: 'health',
  documents: 'health',
  associations: 'associations',
};

export default async function ExhibitorHorsePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { id } = await params;
  const { section } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const userId = (session.user as any).id;
  const role = (session.user as any).role;
  if (role !== 'EXHIBITOR') redirect('/profile');

  const headers = await getAuthHeaders();

  // Fetch the caller's exhibitor record so we can compare against horse.owner_exhibitor_id
  const dashRes = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, { headers: headers!, cache: 'no-store' });
  const dash = await dashRes.json();
  const exhibitorId: string | null = dash.exhibitor?.id ?? null;

  const [horseRes, regsRes] = await Promise.all([
    fetch(`${API_URL}/horses/${id}`, { headers: headers!, cache: 'no-store' }),
    fetch(`${API_URL}/horses/${id}/registrations`, { headers: headers!, cache: 'no-store' }),
  ]);

  if (!horseRes.ok) notFound();
  const horse = await horseRes.json();
  const registrations = regsRes.ok ? await regsRes.json() : [];

  const isOwner = !!exhibitorId && horse.owner_exhibitor_id === exhibitorId;

  // Documents are owner-only - only fetch if the caller is the owner.
  let docs: any[] = [];
  if (isOwner) {
    const docsRes = await fetch(`${API_URL}/horses/${id}/documents`, { headers: headers!, cache: 'no-store' });
    if (docsRes.ok) docs = await docsRes.json();
  }

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/profile?tab=horses" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          {'<- Back to My Horses'}
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>{horse.name}</h1>
        {!isOwner && (
          <p className="text-sm mt-2 px-3 py-2 rounded" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
            View only - only the registered owner can modify this horse.
          </p>
        )}
      </div>

      <EditMyHorseForm
        horse={horse}
        registrations={registrations}
        documents={docs}
        isOwner={isOwner}
        initialSection={section ? SECTION_ALIASES[section] : undefined}
      />
    </main>
  );
}
