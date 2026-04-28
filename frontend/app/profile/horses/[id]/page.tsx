import Link from 'next/link';
import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import HorseDocuments from '@/components/HorseDocuments';
import EditMyHorseForm from './EditMyHorseForm';

export default async function ExhibitorHorsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as any).role;
  if (role !== 'EXHIBITOR') redirect('/profile');

  const headers = await getAuthHeaders();

  const [horseRes, docsRes, regsRes] = await Promise.all([
    fetch(`${API_URL}/horses/${id}`, { cache: 'no-store' }),
    fetch(`${API_URL}/horses/${id}/documents`, { headers: headers!, cache: 'no-store' }),
    fetch(`${API_URL}/horses/${id}/registrations`, { cache: 'no-store' }),
  ]);

  if (!horseRes.ok) notFound();
  const horse = await horseRes.json();
  const docs = docsRes.ok ? await docsRes.json() : [];
  const registrations = regsRes.ok ? await regsRes.json() : [];

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/profile" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Profile
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>{horse.name}</h1>
      </div>

      <EditMyHorseForm horse={horse} registrations={registrations} />

      <div id="documents" className="rounded-lg border p-5" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: '#2c1810' }}>
          Health &amp; Registration Documents
        </h2>
        <HorseDocuments horseId={id} initialDocuments={docs} />
      </div>
    </main>
  );
}
