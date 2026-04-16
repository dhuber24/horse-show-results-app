import { fetchShow, fetchClasses, fetchEntries, fetchResults, fetchHorse, fetchExhibitor } from '@/lib/api';
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
      const [exhibitor, horse] = await Promise.all([
        fetchExhibitor(entry.exhibitor_id),
        fetchHorse(entry.horse_id),
      ]);
      return { ...entry, exhibitorName: exhibitor.full_name, horseName: horse.name };
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
      {show.status !== 'ACTIVE' ? (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-300 text-amber-800">
          This show is not active ({show.status}). Placings cannot be entered until the show is set to Active.
        </div>
      ) : (
        <ScorekeeperForm
          showId={id}
          classId={classId}
          entries={enriched}
          results={results}
        />
      )}
    </main>
  );
}
