import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadFuturity, loadFuturityStandings } from '../../loadFuturity';
import {
  BackToFuturity,
  COLORS,
  SCORING_LABEL,
  futurityCrumbs,
  type Standings,
} from '../../futurity-shared';

/**
 * Hi-Point standings, one table per division.
 *
 * Computed on read from the placings on file, like side pot standings — nothing
 * is materialized, because a futurity has no settle step. An entrant missing a
 * counting class is listed unplaced rather than dropped: "who still needs a
 * class" is the question the office asks of this screen.
 */
export default async function FuturityStandingsPage({
  params,
}: {
  params: Promise<{ id: string; futurityId: string }>;
}) {
  const { id, futurityId } = await params;
  const [show, futurity] = await Promise.all([fetchShow(id), loadFuturity(id, futurityId)]);
  if (!futurity) notFound();

  const standings = (
    await Promise.all(
      futurity.divisions.map((d) => loadFuturityStandings(id, futurityId, d.id)),
    )
  ).filter((s): s is Standings => s !== null);

  return (
    <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={futurityCrumbs(id, show.name, futurity, 'Standings')} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
          Hi-Point standings
        </h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
          {futurity.name} — computed from the placings on file right now. Each judge
          places independently; where a horse has several cards in one class, its
          best is taken.
        </p>
      </div>

      {futurity.divisions.length === 0 ? (
        <p className="text-sm" style={{ color: COLORS.muted }}>
          No award divisions set up yet.
        </p>
      ) : (
        standings.map((division) => (
          <section key={division.division_id} className="space-y-2">
            <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
              {division.division_name}
              <span className="ml-2 text-sm font-normal" style={{ color: COLORS.muted }}>
                {SCORING_LABEL[division.scoring_method]}
              </span>
            </h2>
            {division.standings.length === 0 ? (
              <p className="text-sm" style={{ color: COLORS.muted }}>
                Nobody entered in the futurity yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: COLORS.muted }}>
                      <th className="text-left font-medium py-1 pr-3">Place</th>
                      <th className="text-left font-medium py-1 pr-3">#</th>
                      <th className="text-left font-medium py-1 pr-3">Horse</th>
                      <th className="text-left font-medium py-1 pr-3">Exhibitor</th>
                      <th className="text-right font-medium py-1 pr-3">Total</th>
                      <th className="text-left font-medium py-1">Counted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {division.standings.map((row) => (
                      <tr
                        key={row.futurity_entry_id}
                        className="border-t"
                        style={{ color: COLORS.text }}
                      >
                        <td className="py-2 pr-3 tabular-nums font-semibold">
                          {row.place ?? '—'}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">
                          {row.back_number ?? '—'}
                        </td>
                        <td className="py-2 pr-3">{row.horse_name ?? '—'}</td>
                        <td className="py-2 pr-3">{row.exhibitor_name ?? '—'}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {row.aggregate_value ?? '—'}
                        </td>
                        <td className="py-2 text-xs">
                          {row.counted.length > 0 && (
                            <span style={{ color: COLORS.muted }}>
                              {row.counted.map((c) => `#${c.class_number}`).join(', ')}
                            </span>
                          )}
                          {row.missing_class_numbers.length > 0 && (
                            <span className="block" style={{ color: '#922' }}>
                              still needs{' '}
                              {row.missing_class_numbers
                                .map((n) => (n.includes('(any)') ? n : `#${n}`))
                                .join(', ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}

      <BackToFuturity showId={id} futurity={futurity} />
    </main>
  );
}
