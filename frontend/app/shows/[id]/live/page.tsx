import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';

const TILES = [
  {
    slug: 'schedule',
    icon: '📋',
    title: 'Class Schedule',
    description: 'Browse the full class list by day and ring.',
  },
  {
    slug: 'results',
    icon: '🏆',
    title: 'Results',
    description: 'See posted placings as classes finish.',
  },
  {
    slug: 'leaderboard',
    icon: '⭐',
    title: 'Leaderboard',
    description: 'High-point standings across the show.',
  },
  {
    slug: 'showbill',
    icon: '📄',
    title: 'Show Bill',
    description: 'Classes, judges, fees and rules — print it or save a PDF.',
  },
  {
    slug: 'details',
    icon: 'ℹ️',
    title: 'Show Details',
    description: 'Venue, dates, associations, and policies.',
  },
];

export default async function ShowLiveHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const show = await fetchShow(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref="/shows/active" backLabel="Back to Active Shows" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TILES.map((tile) => (
          <Link
            key={tile.slug}
            href={`/shows/${id}/${tile.slug}`}
            className="block p-5 rounded-lg border transition hover:shadow-md hover:bg-amber-50"
            style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
          >
            <div className="text-3xl mb-2" aria-hidden="true">{tile.icon}</div>
            <div className="font-semibold text-lg" style={{ color: '#2c1810' }}>{tile.title}</div>
            <div className="text-sm mt-1" style={{ color: '#8b7355' }}>{tile.description}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
