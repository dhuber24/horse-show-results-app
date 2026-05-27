import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';

const tiles = (showId: string) => [
  {
    href: `/admin/shows/${showId}/fees/entry`,
    title: 'Entry Fees',
    description: 'Office charges, per-judge fees, and per-class entry fees.',
    icon: '🎟️',
  },
  {
    href: `/admin/shows/${showId}/fees/boarding`,
    title: 'Boarding Fees',
    description: 'Stalls, campsites, shavings, late entry, and other surcharges.',
    icon: '🏕️',
  },
  {
    href: `/admin/shows/${showId}/side-pots`,
    title: 'Side Pots',
    description: 'Divisional jackpots that span multiple classes.',
    icon: '💰',
  },
];

export default async function FeeSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const show = await fetchShow(id);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Fee Schedule' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Fee Schedule</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — fees the show charges exhibitors. Payment is collected at the show;
          amounts here are informational.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {tiles(id).map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="block p-6 rounded-lg border transition-colors hover:bg-amber-50"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <div className="flex items-start gap-4">
              <div className="text-3xl" aria-hidden>{tile.icon}</div>
              <div>
                <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>
                  {tile.title}
                </h2>
                <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
                  {tile.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
