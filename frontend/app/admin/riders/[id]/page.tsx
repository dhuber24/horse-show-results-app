import Link from 'next/link';
import { fetchRider, fetchRiderHorses } from '@/lib/api';
import { auth } from '@/auth';
import { notFound } from 'next/navigation';
import EditRiderForm from './EditRiderForm';
import EditHorseCard from './EditHorseCard';

const API_URL = process.env.API_URL || 'http://backend:8000';

async function fetchRiderEntries(riderId: string) {
  const res = await fetch(`${API_URL}/riders/${riderId}/entries`).catch(() => null);
  if (!res || !res.ok) return [];
  return res.json();
}

async function fetchRiderShowHistory(riderId: string) {
  // Get all entries for this rider and group them by show
  // We'll use the dashboard endpoint which already enriches entries
  return [];
}

export default async function AdminRiderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== 'ADMIN') notFound();

  const [rider, horses] = await Promise.all([
    fetchRider(id).catch(() => null),
    fetchRiderHorses(id).catch(() => []),
  ]);

  if (!rider) notFound();

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href="/admin/riders" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Riders & Horses
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          {rider.full_name}
        </h1>
        {rider.user_id && (
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            Linked to a user account
          </p>
        )}
      </div>

      {/* Edit name */}
      <section>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Rider Name</h2>
        <EditRiderForm rider={rider} />
      </section>

      {/* Horses */}
      <section>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>
          Horses Competed On
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({horses.length})
          </span>
        </h2>

        {horses.length === 0 ? (
          <p className="text-sm" style={{ color: '#8b7355' }}>
            No horses on record — horses are linked automatically when entries are created.
          </p>
        ) : (
          <ul className="space-y-2">
            {horses.map((horse: any) => (
              <EditHorseCard key={horse.id} horse={horse} />
            ))}
          </ul>
        )}

        <p className="text-xs mt-3" style={{ color: '#8b7355' }}>
          Horses appear here when this rider is entered in a class with that horse.
          To add a new horse to the system, use the{' '}
          <Link href="/admin/riders" className="underline" style={{ color: '#8b4513' }}>
            Riders & Horses
          </Link>{' '}
          page, then add an entry using that horse.
        </p>
      </section>

      {/* Rider ID for reference */}
      <section className="pt-4 border-t" style={{ borderColor: '#d4b896' }}>
        <p className="text-xs" style={{ color: '#8b7355' }}>
          Rider ID: <span className="font-mono">{rider.id}</span>
        </p>
        {rider.user_id && (
          <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
            User ID: <span className="font-mono">{rider.user_id}</span>
          </p>
        )}
      </section>
    </main>
  );
}
