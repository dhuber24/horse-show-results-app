import Link from 'next/link';
import { fetchExhibitors, fetchExhibitorHorses } from '@/lib/api';
import CreateExhibitorForm from '../shows/[id]/CreateExhibitorForm';
import CreateHorseForm from '../shows/[id]/CreateHorseForm';

export default async function AdminExhibitorsPage() {
  const exhibitors = await fetchExhibitors();

  // Fetch horse counts per exhibitor in parallel
  const exhibitorsWithHorses = await Promise.all(
    exhibitors.map(async (exhibitor: any) => {
      const horses = await fetchExhibitorHorses(exhibitor.id).catch(() => []);
      return { ...exhibitor, horses };
    })
  );

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-10">
      <div>
        <Link href="/admin" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Admin
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Exhibitors & Horses</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Manage exhibitors and view the horses they've competed on.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Exhibitor</h2>
          <CreateExhibitorForm />
        </section>
        <section>
          <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Horse</h2>
          <CreateHorseForm />
        </section>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>
          All Exhibitors
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({exhibitorsWithHorses.length})
          </span>
        </h2>

        {exhibitorsWithHorses.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No exhibitors yet.</p>
        ) : (
          <ul className="space-y-3">
            {exhibitorsWithHorses.map((exhibitor: any) => (
              <li key={exhibitor.id}>
                <Link
                  href={`/admin/exhibitors/${exhibitor.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-amber-50"
                  style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
                >
                  <div>
                    <p className="font-semibold" style={{ color: '#2c1810' }}>{exhibitor.full_name}</p>
                    <p className="text-sm mt-0.5" style={{ color: '#8b7355' }}>
                      {exhibitor.horses.length === 0
                        ? 'No horses on record'
                        : exhibitor.horses.map((h: any) => h.name).join(', ')}
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
