import Link from 'next/link';
import { fetchHorseColors } from '@/lib/api';
import HorseColorForm from './HorseColorForm';

export default async function AdminHorseColorsPage() {
  const colors = await fetchHorseColors();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href="/admin/horses" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Horses
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Horse Colors</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Manage the color options available when adding or editing a horse.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Color</h2>
        <HorseColorForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>
          All Colors
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({colors.length})
          </span>
        </h2>
        {colors.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No colors yet.</p>
        ) : (
          <ul className="space-y-2">
            {colors.map((c: any) => (
              <li key={c.id}>
                <Link
                  href={`/admin/horses/colors/${c.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:bg-amber-50"
                  style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
                >
                  <div>
                    <div className="font-semibold" style={{ color: '#2c1810' }}>{c.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>Sort: {c.sort_order}</div>
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
