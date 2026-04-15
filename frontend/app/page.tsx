import { fetchShows } from '@/lib/api';
import ShowList from './ShowList';

export default async function Home() {
  const shows = await fetchShows();

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6 mt-2">
        <h2 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Upcoming Shows</h2>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>Select a show to view classes and results</p>
      </div>
      <ShowList shows={shows} />
    </main>
  );
}
