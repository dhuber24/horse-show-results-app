import Link from 'next/link';
import { fetchShows, fetchShowTypes } from '@/lib/api';
import ShowList from '../../ShowList';

export default async function UpcomingShowsPage() {
  const [showsResult, showTypesResult] = await Promise.allSettled([fetchShows(), fetchShowTypes()]);
  const shows = showsResult.status === 'fulfilled' ? showsResult.value : [];
  const showTypes = showTypesResult.status === 'fulfilled' ? showTypesResult.value : [];
  const loadError = showsResult.status === 'rejected' || showTypesResult.status === 'rejected';

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to Home
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Upcoming Shows</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>Select a show to view classes and results</p>
      </div>
      {loadError && (
        <div className="rounded-lg border p-3 mb-4 text-sm" style={{ borderColor: '#fbbf24', backgroundColor: '#fffbeb', color: '#92400e' }}>
          Shows are temporarily unavailable while the server finishes starting. Refresh in a moment.
        </div>
      )}
      <ShowList shows={shows} showTypes={showTypes} />
    </main>
  );
}
