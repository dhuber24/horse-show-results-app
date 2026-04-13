import { fetchShow, fetchClasses, fetchEntries, fetchResults, fetchHorse, fetchRider } from '@/lib/api';
import ScorekeeperForm from './ScorekeeperForm';

export default async function ScorekeeperPage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  const [show, classes, entries, results] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchEntries(id, classId),
    fetchResults(id, classId),
  ]);

  const cls = classes.find((c: any) => c.id === classId);

  const enriched = await Promise.all(
    entries.map(async (entry: any) => {
      const [rider, horse] = await Promise.all([
        fetchRider(entry.rider_id),
        fetchHorse(entry.horse_id),
      ]);
      return { ...entry, riderName: rider.full_name, horseName: horse.name };
    })
  );

  return (
    <main className="max-w-3xl mx-auto p-6">
      <a href={`/shows/${id}/classes/${classId}`} className="text-sm text-blue-500 hover:underline">
        ← Back to Results
      </a>
      <h1 className="text-3xl font-bold mt-4">
        {cls ? `${cls.class_number} — ${cls.class_name}` : 'Scorekeeper'}
      </h1>
      <p className="text-gray-500 mb-6">{show.name} · {cls?.class_date}</p>
      <ScorekeeperForm
        showId={id}
        classId={classId}
        entries={enriched}
        results={results}
      />
    </main>
  );
}
