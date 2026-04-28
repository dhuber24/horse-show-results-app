import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import { fetchShowTypes } from '@/lib/api';
import ShowList from '../ShowList';

export default async function ScorekeeperShowsPage() {
  const session = await auth();
  const role = (session?.user as any)?.role;

  if (!session || role !== 'SCOREKEEPER') {
    redirect('/');
  }

  const headers = await getAuthHeaders();
  const [showsRes, showTypes] = await Promise.all([
    fetch(`${API_URL}/shows/`, { headers: headers ?? {}, cache: 'no-store' }),
    fetchShowTypes(),
  ]);

  const shows = showsRes.ok ? await showsRes.json() : [];

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6 mt-2">
        <h2 className="text-2xl font-bold" style={{ color: '#2c1810' }}>My Shows</h2>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>Shows you are assigned to score</p>
      </div>
      {shows.filter((s: any) => s.status !== 'DRAFT').length === 0 ? (
        <p style={{ color: '#8b7355' }}>
          You haven&apos;t been assigned to any shows yet. Contact your show secretary.
        </p>
      ) : (
        <ShowList shows={shows} showTypes={showTypes} />
      )}
    </main>
  );
}
