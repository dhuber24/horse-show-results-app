import Link from 'next/link';
import { fetchEntries, fetchResults, fetchHorse, fetchRider } from '@/lib/api';

export default async function ClassPage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  const [entries, results] = await Promise.all([
    fetchEntries(id, classId),
    fetchResults(id, classId),
  ]);

  const enriched = await Promise.all(
    entries.map(async (entry: any) => {
      const [rider, horse] = await Promise.all([
        fetchRider(entry.rider_id),
        fetchHorse(entry.horse_id),
      ]);
      return { ...entry, riderName: rider.full_name, horseName: horse.name };
    })
  );

  const resultsByEntryId = Object.fromEntries(results.map((r: any) => [r.entry_id, r]));

  return (
    <main className="max-w-3xl mx-auto p-6">
      <Link href={`/shows/${id}`} className="text-sm text-blue-500 hover:underline">← Back to Classes</Link>
      <h1 className="text-3xl font-bold my-6">Results</h1>

      {enriched.length === 0 ? (
        <p className="text-gray-500">No entries found.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">Place</th>
              <th className="py-2 pr-4">Back #</th>
              <th className="py-2 pr-4">Rider</th>
              <th className="py-2">Horse</th>
            </tr>
          </thead>
          <tbody>
            {enriched
              .sort((a: any, b: any) => {
                const ra = resultsByEntryId[a.id];
                const rb = resultsByEntryId[b.id];
                if (!ra) return 1;
                if (!rb) return -1;
                return ra.place - rb.place;
              })
              .map((entry: any) => {
                const result = resultsByEntryId[entry.id];
                return (
                  <tr key={entry.id} className="border-b hover:bg-gray-50">
                    <td className="py-3 pr-4 font-semibold">
                      {result ? `${result.place}${result.is_tie ? ' (T)' : ''}` : '—'}
                    </td>
                    <td className="py-3 pr-4">{entry.back_number ?? '—'}</td>
                    <td className="py-3 pr-4">{entry.riderName}</td>
                    <td className="py-3">{entry.horseName}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </main>
  );
}
