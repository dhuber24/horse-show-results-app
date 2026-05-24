import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumbs from '@/components/Breadcrumbs';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import AdminTrainerDetail from './AdminTrainerDetail';

export default async function AdminTrainerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  if (!headers) return notFound();

  const [trainerRes, regsRes, horsesRes] = await Promise.all([
    fetch(`${API_URL}/trainers/${id}`, { headers, cache: 'no-store' }).catch(() => null),
    fetch(`${API_URL}/trainers/${id}/registrations`, { headers, cache: 'no-store' }).catch(() => null),
    fetch(`${API_URL}/trainers/${id}/horses`, { headers, cache: 'no-store' }).catch(() => null),
  ]);

  // /trainers/{id} GET isn't exposed — the trainers list returns all. Find ours.
  const listRes = await fetch(`${API_URL}/trainers/`, { headers, cache: 'no-store' });
  if (!listRes.ok) return notFound();
  const all = await listRes.json();
  const trainer = all.find((t: { id: string }) => t.id === id);
  if (!trainer) return notFound();

  const affiliations = regsRes && regsRes.ok ? await regsRes.json() : [];
  const horses = horsesRes && horsesRes.ok ? await horsesRes.json() : [];
  // Silence unused — kept in case we add a dedicated GET later.
  void trainerRes;

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Trainers', href: '/admin/trainers' },
            { label: trainer.name },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>{trainer.name}</h1>
        {trainer.user_id && (
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            Linked user:{' '}
            <Link href={`/admin/users/${trainer.user_id}`} className="underline" style={{ color: '#8b4513' }}>
              {trainer.user_email ?? 'view user'}
            </Link>
          </p>
        )}
      </div>

      <AdminTrainerDetail trainer={trainer} initialAffiliations={affiliations} initialHorses={horses} />
    </main>
  );
}
