import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import ShowStatusControl from './ShowStatusControl';

const tiles = (showId: string) => [
  {
    href: `/admin/shows/${showId}/edit`,
    title: 'Edit Show Details',
    description: 'Update name, venue, dates, and status.',
    icon: '📝',
  },
  {
    href: `/admin/shows/${showId}/classes`,
    title: 'Add / Modify Classes',
    description: 'Create new classes and edit existing ones.',
    icon: '📋',
  },
  {
    href: `/admin/shows/${showId}/entries`,
    title: 'Add / Modify Entries',
    description: 'Enter horses and exhibitors in classes.',
    icon: '🎟️',
  },
  {
    href: `/admin/shows/${showId}/back-numbers`,
    title: 'Assign Back Numbers',
    description: 'Assign back numbers to exhibitors for this show.',
    icon: '🔢',
  },
];

export default async function AdminShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const show = await fetchShow(id);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href="/admin/shows" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Shows
        </Link>
        <div className="flex items-center gap-2 mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
          {show.show_type_code && (
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {show.show_type_code}
            </span>
          )}
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          📍 {show.venue} · 📅 {show.start_date} – {show.end_date}
        </p>
        <div className="mt-2">
          <ShowStatusControl showId={id} currentStatus={show.status} />
        </div>
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
