import Link from 'next/link';
import { fetchBreeds } from '@/lib/api';
import BreedForm from './BreedForm';

export default async function AdminBreedsPage() {
  const breeds = await fetchBreeds();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href="/admin/horses" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Horses
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Breeds</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Manage the breed options available when adding or editing a horse.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Breed</h2>
        <BreedForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>
          All Breeds
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({breeds.length})
          </span>
        </h2>
        {breeds.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No breeds yet.</p>
        ) : (
          <ul className="space-y-2">
            {breeds.map((b: any) => (
              <li key={b.id}>
                <Link
                  href={`/admin/horses/breeds/${b.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-amber-50"
                  style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
                >
                  <div>
                    <div className="font-semibold" style={{ color: '#2c1810' }}>{b.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>Sort: {b.sort_order}</div>
                  </div>
                  <span className="text-sm ml-4 shrink-0" style={{ color: '#8b4513' }}>Edit →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
