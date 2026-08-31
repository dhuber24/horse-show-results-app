import Link from 'next/link';
import { fetchHorsePatterns } from '@/lib/api';
import HorsePatternForm from './HorsePatternForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function AdminHorsePatternsPage() {
  const patterns = await fetchHorsePatterns();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Horses', href: '/admin/horses' },
          { label: 'Patterns' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Horse Coat Patterns</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          The spotting patterns offered alongside colour when adding or editing a horse. A Paint is a colour AND a pattern — the two were one list until migration 116.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Pattern</h2>
        <HorsePatternForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>
          All Patterns
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({patterns.length})
          </span>
        </h2>
        {patterns.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No patterns yet.</p>
        ) : (
          <ul className="space-y-2">
            {patterns.map((c: any) => (
              <li key={c.id}>
                <Link
                  href={`/admin/horses/patterns/${c.id}`}
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
