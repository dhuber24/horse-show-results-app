import {
  fetchShow,
  fetchClasses,
  fetchEntries,
  fetchResults,
  fetchHorse,
  fetchExhibitor,
  fetchShowJudgesPublic,
} from '@/lib/api';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import ScribeForm from './ScribeForm';
import ScoredScribeForm from './ScoredScribeForm';

/**
 * The card shape this class is judged on, and whatever has been marked on it.
 *
 * Both are optional in every sense: a class with no `judging_system_id` scores
 * the way it always did, with the scribe typing a total. Failures here are
 * swallowed for the same reason — a catalog that will not load must not take the
 * scribe screen down with it in the middle of a class.
 */
async function loadCards(showId: string, classId: string, systemId: string | null) {
  if (!systemId) return { system: null, cards: [] };
  const headers = { 'X-API-Key': process.env.INTERNAL_API_KEY || '' };
  try {
    const [systemsRes, cardsRes] = await Promise.all([
      fetch(`${API_URL}/judging-systems/`, { headers, cache: 'no-store' }),
      fetch(`${API_URL}/shows/${showId}/classes/${classId}/cards`, {
        headers: { ...headers, 'X-User-Role': 'ADMIN' },
        cache: 'no-store',
      }),
    ]);
    const systems = systemsRes.ok ? await readJsonBody(systemsRes) : [];
    const cards = cardsRes.ok ? await readJsonBody(cardsRes) : [];
    return {
      system: (systems ?? []).find((s: any) => s.id === systemId) ?? null,
      cards: cards ?? [],
    };
  } catch {
    return { system: null, cards: [] };
  }
}

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
  const { system: judgingSystem, cards } = await loadCards(
    id,
    classId,
    cls?.judging_system_id ?? null,
  );

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
          judgingSystem={judgingSystem}
          cards={cards}
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
