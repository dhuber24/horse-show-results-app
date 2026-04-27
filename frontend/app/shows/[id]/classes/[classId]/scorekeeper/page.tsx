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
        entry.horse_id ? fetchHorse(entry.horse_id) : Promise.resolve(null),
      ]);
      return {
        ...entry,
        exhibitorName: exhibitor.full_name,
        horseName: horse?.name ?? '—',
        is_disqualified: entry.is_disqualified ?? false,
      };
    })
  );

  return (
    <main className="max-w-3xl mx-auto p-6">
      <a href={`/shows/${id}/classes/${classId}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to Results
      </a>
      <h1 className="text-2xl font-bold mt-4" style={{ color: '#2c1810' }}>
        {cls ? `${cls.class_number} — ${cls.class_name}` : 'Scorekeeper'}
      </h1>
      <p className="text-sm mb-5" style={{ color: '#8b7355' }}>{show.name} · {cls?.class_date}</p>
      {show.status !== 'ACTIVE' ? (
        <div className="p-4 rounded-lg text-sm"
          style={{ backgroundColor: '#fef3c7', border: '1px solid #d4b896', color: '#92400e' }}>
          This show is not active ({show.status}). Placings cannot be entered until the show is set to Active.
        </div>
      ) : (
        <ScorekeeperForm
          showId={id}
          classId={classId}
          classes={classes}
          entries={enriched}
          results={results}
        />
      )}
    </main>
  );
}
