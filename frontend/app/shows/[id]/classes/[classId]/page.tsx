import Link from 'next/link';
import { fetchShow, fetchClasses, fetchEntries, fetchResults, fetchHorse, fetchRider, fetchShowBackNumbers } from '@/lib/api';
import { auth } from '@/auth';

export default async function ClassPage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  const canEnterPlacings = role === 'ADMIN' || role === 'SCOREKEEPER';

  const [show, classes, entries, results, backNumbers] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchEntries(id, classId),
    fetchResults(id, classId),
    fetchShowBackNumbers(id),
  ]);

  const cls = classes.find((c: any) => c.id === classId);
  const backNumberMap = Object.fromEntries(backNumbers.map((b: any) => [b.rider_id, b.back_number]));

  const enriched = await Promise.all(
    entries.map(async (entry: any) => {
      const [rider, horse] = await Promise.all([fetchRider(entry.rider_id), fetchHorse(entry.horse_id)]);
      return {
        ...entry,
        riderName: rider.full_name,
        horseName: horse.name,
        back_number: backNumberMap[entry.rider_id] ?? entry.back_number,
      };
    })
  );

  const resultsByEntryId = Object.fromEntries(results.map((r: any) => [r.entry_id, r]));

  const placeLabel = (place: number) => {
    if (place === 1) return '🥇';
    if (place === 2) return '🥈';
    if (place === 3) return '🥉';
    return `${place}th`;
  };

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to {show.name}
      </Link>
      <div className="flex items-start justify-between mt-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
            {cls ? `${cls.class_number} — ${cls.class_name}` : 'Class Results'}
          </h1>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            📅 {cls?.class_date} &nbsp;·&nbsp;
            <span className="font-medium" style={{ color: '#8b4513' }}>{cls?.status}</span>
          </p>
        </div>
        {canEnterPlacings && (
          <Link href={`/shows/${id}/classes/${classId}/scorekeeper`}
            className="text-sm px-4 py-2 rounded font-medium whitespace-nowrap"
            style={{ backgroundColor: '#8b4513', color: '#ffffff' }}>
            Enter Placings
          </Link>
        )}
      </div>

      <div className="mt-6 rounded-lg border overflow-hidden" style={{ borderColor: '#d4b896' }}>
        {enriched.length === 0 ? (
          <p className="p-4" style={{ color: '#8b7355' }}>No entries found.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
                <th className="py-3 px-4 text-left text-sm font-semibold">Place</th>
                <th className="py-3 px-4 text-left text-sm font-semibold">Back #</th>
                <th className="py-3 px-4 text-left text-sm font-semibold">Rider</th>
                <th className="py-3 px-4 text-left text-sm font-semibold hidden md:table-cell">Horse</th>
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
                .map((entry: any, i: number) => {
                  const result = resultsByEntryId[entry.id];
                  return (
                    <tr key={entry.id}
                      style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#faf7f2', borderTop: '1px solid #d4b896' }}>
                      <td className="py-3 px-4 font-bold" style={{ color: '#8b4513' }}>
                        {result ? `${placeLabel(result.place)}${result.is_tie ? ' (T)' : ''}` : '—'}
                      </td>
                      <td className="py-3 px-4" style={{ color: '#2c1810' }}>{entry.back_number ?? '—'}</td>
                      <td className="py-3 px-4" style={{ color: '#2c1810' }}>{entry.riderName}</td>
                      <td className="py-3 px-4 hidden md:table-cell" style={{ color: '#8b7355' }}>{entry.horseName}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
