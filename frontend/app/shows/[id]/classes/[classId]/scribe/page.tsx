import {
  fetchShow,
  fetchClasses,
  fetchEntries,
  fetchResults,
  fetchHorse,
  fetchExhibitor,
  fetchShowJudgesPublic,
} from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import ScribeForm from './ScribeForm';
import ScoredScribeForm from './ScoredScribeForm';

export default async function ScribePage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  // Staff headers: results for an unposted class are only returned to show
  // staff, and this screen is where the unposted draft is being written.
  const staffHeaders = await getAuthHeaders();
  const [show, classes, entries, results, judges] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchEntries(id, classId),
    fetchResults(id, classId, staffHeaders ?? undefined),
    fetchShowJudgesPublic(id),
  ]);

  const cls = classes.find((c: any) => c.id === classId);

  const apiHeaders = { 'X-API-Key': process.env.INTERNAL_API_KEY || '' };
  const enriched = await Promise.all(
    entries.map(async (entry: any) => {
      const [exhibitor, horse] = await Promise.all([
        fetchExhibitor(entry.exhibitor_id, apiHeaders),
        entry.horse_id ? fetchHorse(entry.horse_id, apiHeaders) : Promise.resolve(null),
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
        {cls ? `${cls.class_number} — ${cls.class_name}` : 'Scribe'}
      </h1>
      <p className="text-sm mb-5" style={{ color: '#8b7355' }}>{show.name} · {cls?.class_date}</p>
      {show.status !== 'ACTIVE' ? (
        <div className="p-4 rounded-lg text-sm"
          style={{ backgroundColor: '#fef3c7', border: '1px solid #d4b896', color: '#92400e' }}>
          This show is not active ({show.status}). Placings cannot be entered until the show is set to Active.
        </div>
      ) : cls?.score_type === 'pattern' || cls?.score_type === 'time' ? (
        <ScoredScribeForm
          showId={id}
          classId={classId}
          scoreType={cls.score_type}
          classes={classes}
          entries={enriched}
          results={results}
          judges={judges}
          resultsPublishedAt={cls.results_published_at ?? null}
        />
      ) : (
        <ScribeForm
          showId={id}
          classId={classId}
          classes={classes}
          entries={enriched}
          results={results}
          judges={judges}
          resultsPublishedAt={cls?.results_published_at ?? null}
        />
      )}
    </main>
  );
}
