import { fetchShow } from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';

export default async function ShowLeaderboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const show = await fetchShow(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={`/shows/${id}/live`} backLabel="Back to Show Menu" />

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Leaderboard</h2>

      <div className="rounded-lg border p-8 text-center" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
        <div className="text-4xl mb-3" aria-hidden="true">⭐</div>
        <p className="text-base font-medium" style={{ color: '#2c1810' }}>High-point standings are coming soon</p>
        <p className="text-sm mt-2 max-w-md mx-auto" style={{ color: '#8b7355' }}>
          Once results are posted, this page will rank exhibitors and horses by their
          placings across the show. Check the <span className="font-medium">Results</span> page for
          class-by-class placings in the meantime.
        </p>
      </div>
    </main>
  );
}
