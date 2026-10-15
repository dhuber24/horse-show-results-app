import Link from 'next/link';
import { fetchShows, fetchShowTypes } from '@/lib/api';
import ShowList from '../../ShowList';

export default async function PastShowsPage() {
  const [showsResult, showTypesResult] = await Promise.allSettled([fetchShows(), fetchShowTypes()]);
  const shows = showsResult.status === 'fulfilled' ? showsResult.value : [];
  const showTypes = showTypesResult.status === 'fulfilled' ? showTypesResult.value : [];
  const loadError = showsResult.status === 'rejected' || showTypesResult.status === 'rejected';
  // The API lists shows oldest first; looking back, the most recent show is
  // the one people came for.
  const past = shows
    .filter((s: any) => s.status === 'COMPLETED')
    .sort((a: any, b: any) => b.start_date.localeCompare(a.start_date));

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Home
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Past Shows</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Select a show to view its results and standings</p>
      </div>
      {loadError && (
        <div className="rounded-lg border p-3 mb-4 text-sm" style={{ borderColor: 'var(--warning-border)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}>
          Shows are temporarily unavailable while the server finishes starting. Refresh in a moment.
        </div>
      )}
      <ShowList shows={past} showTypes={showTypes} />
    </main>
  );
}
