import Link from 'next/link';
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
import { auth } from '@/auth';
import PlacingsTable, { type CardColumn, type PlacingRow } from './PlacingsTable';

const NO_JUDGE = '__none__';

export default async function ClassPage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  const canEnterPlacings = role === 'ADMIN' || role === 'SCRIBE';

  // Staff see a class's placings before it is posted; the public does not.
  // Passing headers is what distinguishes the two — see fetchResults.
  const staffHeaders = canEnterPlacings ? await getAuthHeaders() : null;
  const [show, classes, entries, results, judges] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchEntries(id, classId),
    fetchResults(id, classId, staffHeaders ?? undefined),
    fetchShowJudgesPublic(id),
  ]);

  const cls = classes.find((c: any) => c.id === classId);
  const isPosted = Boolean(cls?.results_published_at);

  // back_number comes resolved off the entries endpoint. This page used to
  // overlay it from /back-numbers/, which is staff-only and was being called
  // with no auth headers — it 422'd on every request, the helper swallowed it,
  // and the column fell back to the always-NULL entries.back_number column.
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
      };
    })
  );

  // placings[entryId][cardKey] — one placing per judge who has filed a card.
  const placingsByEntry: Record<string, PlacingRow['placings']> = {};
  for (const r of results) {
    const key = r.judge_id ?? NO_JUDGE;
    (placingsByEntry[r.entry_id] ??= {})[key] = { place: r.place, is_tie: Boolean(r.is_tie) };
  }

  // A column per card that actually holds placings. Judges who have not filed
  // are left off rather than shown as a row of dashes; the unattributed card
  // (results entered before a panel was assigned) gets a plain "Placing".
  const filedKeys = new Set<string>(results.map((r: any) => r.judge_id ?? NO_JUDGE));
  const judgeColumns: CardColumn[] = judges
    .filter((j: any) => filedKeys.has(j.id))
    .map((j: any, i: number) => ({
      key: j.id,
      label: `${j.first_name} ${j.last_name}`,
      shortLabel: `J${i + 1}`,
    }));
  if (filedKeys.has(NO_JUDGE)) {
    judgeColumns.push({ key: NO_JUDGE, label: 'Placing', shortLabel: '' });
  }

  const rows: PlacingRow[] = enriched.map((e: any) => ({
    id: e.id,
    back_number: e.back_number ?? null,
    exhibitorName: e.exhibitorName,
    horseName: e.horseName,
    placings: placingsByEntry[e.id] ?? {},
  }));

  const multiJudge = judgeColumns.length > 1;

  return (
    <main className={`${multiJudge ? 'max-w-5xl' : 'max-w-2xl'} mx-auto p-4 md:p-6`}>
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
          <Link href={`/shows/${id}/classes/${classId}/scribe`}
            className="text-sm px-4 py-2 rounded font-medium whitespace-nowrap"
            style={{ backgroundColor: '#8b4513', color: '#ffffff' }}>
            Enter Placings
          </Link>
        )}
      </div>

      {/* Staff-only: an unposted class looks identical to an unjudged one from
          the outside, so say which it is rather than leaving the office to
          guess whether the scribe has started. */}
      {canEnterPlacings && results.length > 0 && !isPosted && (
        <div
          className="mt-3 px-3 py-2 rounded text-sm"
          style={{ backgroundColor: '#faf7f2', border: '1px solid #d4b896', color: '#8b7355' }}
        >
          ○ <span className="font-medium" style={{ color: '#2c1810' }}>Not posted</span> — these
          placings are visible to show staff only.{' '}
          <Link
            href={`/shows/${id}/classes/${classId}/scribe`}
            className="font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            Post them
          </Link>
        </div>
      )}

      <div className="mt-6 rounded-lg border overflow-hidden" style={{ borderColor: '#d4b896' }}>
        {enriched.length === 0 ? (
          <p className="p-4" style={{ color: '#8b7355' }}>No entries found.</p>
        ) : (
          <PlacingsTable rows={rows} judgeColumns={judgeColumns} />
        )}
      </div>

      {enriched.length > 0 && (
        <p className="mt-3 text-xs" style={{ color: '#8b7355' }}>
          Tap a column heading to sort.
          {/* Each judge places independently, so the cards can and do disagree.
              The app does not judge and does not combine them into an overall —
              saying so is what stops the first row reading as a winner. */}
          {multiJudge && (
            <>
              {' '}Each judge places this class on their own card, and the default order is the
              average across the {judgeColumns.length} cards — a reading aid, not an official
              combined result.
            </>
          )}
        </p>
      )}
    </main>
  );
}
