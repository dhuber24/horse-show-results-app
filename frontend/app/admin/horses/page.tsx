import Link from 'next/link';
import { fetchHorses, fetchBreeds, fetchHorseColors, fetchExhibitors } from '@/lib/api';
import CreateHorseForm from '../shows/[id]/CreateHorseForm';

export default async function AdminHorsesPage() {
  const [horses, breeds, colors, exhibitors] = await Promise.all([
    fetchHorses(),
    fetchBreeds(),
    fetchHorseColors(),
    fetchExhibitors(),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href="/admin" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Admin
        </Link>
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Horses</h1>
          <div className="flex gap-3">
            <Link
              href="/admin/horses/breeds"
              className="text-sm px-3 py-1.5 rounded border font-medium"
              style={{ borderColor: '#d4b896', color: '#8b4513' }}
            >
              Manage Breeds
            </Link>
            <Link
              href="/admin/horses/colors"
              className="text-sm px-3 py-1.5 rounded border font-medium"
              style={{ borderColor: '#d4b896', color: '#8b4513' }}
            >
              Manage Colors
            </Link>
          </div>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Horse</h2>
        <CreateHorseForm breeds={breeds} colors={colors} exhibitors={exhibitors} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>
          All Horses
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({horses.length})
          </span>
        </h2>

        {horses.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No horses yet.</p>
        ) : (
          <ul className="space-y-2">
            {horses.map((horse: any) => (
              <li key={horse.id}>
                <Link
                  href={`/admin/horses/${horse.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-amber-50"
                  style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
                >
                  <div>
                    <div className="font-semibold" style={{ color: '#2c1810' }}>
                      {horse.name}
                      {horse.sex && (
                        <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded" style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                          {horse.sex}
                        </span>
                      )}
                    </div>
                    <div className="text-sm mt-0.5 flex flex-wrap gap-x-3" style={{ color: '#8b7355' }}>
                      {horse.owner_name && <span>Owner: {horse.owner_name}</span>}
                      {horse.breed_name && <span>{horse.breed_name}</span>}
                      {horse.color_name && <span>{horse.color_name}</span>}
                      {horse.age !== null && horse.age !== undefined && <span>Age: {horse.age}</span>}
                    </div>
                  </div>
                  <span className="text-sm ml-4 shrink-0" style={{ color: '#8b4513' }}>
                    Edit →
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
