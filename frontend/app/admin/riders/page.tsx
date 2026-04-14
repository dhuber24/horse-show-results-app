import Link from 'next/link';
import { fetchRiders, fetchRiderHorses } from '@/lib/api';
import CreateRiderForm from '../shows/[id]/CreateRiderForm';
import CreateHorseForm from '../shows/[id]/CreateHorseForm';

export default async function AdminRidersPage() {
  const riders = await fetchRiders();

  // Fetch horse counts per rider in parallel
  const ridersWithHorses = await Promise.all(
    riders.map(async (rider: any) => {
      const horses = await fetchRiderHorses(rider.id).catch(() => []);
      return { ...rider, horses };
    })
  );

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-10">
      <div>
        <Link href="/admin" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Admin
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Riders & Horses</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Manage riders and view the horses they've competed on.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Rider</h2>
          <CreateRiderForm />
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Horse</h2>
          <CreateHorseForm />
        </section>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>
          All Riders
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({ridersWithHorses.length})
          </span>
        </h2>

        {ridersWithHorses.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No riders yet.</p>
        ) : (
          <ul className="space-y-3">
            {ridersWithHorses.map((rider: any) => (
              <li key={rider.id}>
                <Link
                  href={`/admin/riders/${rider.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-amber-50"
                  style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
                >
                  <div>
                    <p className="font-semibold" style={{ color: '#2c1810' }}>{rider.full_name}</p>
                    <p className="text-sm mt-0.5" style={{ color: '#8b7355' }}>
                      {rider.horses.length === 0
                        ? 'No horses on record'
                        : rider.horses.map((h: any) => h.name).join(', ')}
                    </p>
                  </div>
                  <span className="text-sm ml-4 shrink-0" style={{ color: '#8b4513' }}>
                    Manage →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
