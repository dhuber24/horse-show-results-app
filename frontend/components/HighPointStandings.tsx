import {
  bandLabel,
  chartBands,
  formatPoints,
  ordinal,
  type DivisionStandings,
  type PointSystem,
} from '@/lib/high-point';

/**
 * High-point standings, one table per division within a discipline — Amateur
 * Western Pleasure and Amateur Halter are two — and the chart that produced
 * them. Shared by a show's leaderboard and a season circuit's, which are the
 * same computation over a different set of shows (`backend/high_point.py`).
 *
 * The chart is printed under the tables because the first question anybody
 * asks of a leaderboard is why somebody has the points they have.
 */
export default function HighPointStandings({
  divisions,
  pointSystem,
  showShowCount = false,
}: {
  divisions: DivisionStandings[];
  pointSystem: PointSystem;
  /** On a circuit, how many of its shows each pair earned points at. */
  showShowCount?: boolean;
}) {
  const bands = chartBands(pointSystem.awards);

  return (
    <div className="space-y-6">
      {divisions.map((division) => (
        <section key={division.name}>
          <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            {division.name}
          </h3>
          <div className="rounded-lg border overflow-x-auto" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left" style={{ color: 'var(--accent)' }}>
                  <th className="font-semibold py-2 pl-3 pr-2 w-12">#</th>
                  <th className="font-semibold py-2 pr-3">Exhibitor</th>
                  <th className="font-semibold py-2 pr-3">Horse</th>
                  <th className="font-semibold py-2 pr-3 text-right">Points</th>
                  <th className="font-semibold py-2 pr-3 text-right whitespace-nowrap">
                    {showShowCount ? 'Shows' : 'Classes'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {division.standings.map((row) => (
                  <tr
                    key={`${row.exhibitor_id}:${row.horse_id ?? ''}`}
                    className="border-t"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <td className="py-2 pl-3 pr-2 font-semibold" style={{ color: 'var(--foreground)' }}>
                      {row.rank}
                    </td>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-deep)' }}>{row.exhibitor_name}</td>
                    <td className="py-2 pr-3" style={{ color: 'var(--foreground)' }}>{row.horse_name || '—'}</td>
                    <td className="py-2 pr-3 text-right font-semibold" style={{ color: 'var(--foreground)' }}>
                      {formatPoints(row.points)}
                    </td>
                    <td className="py-2 pr-3 text-right" style={{ color: 'var(--muted)' }}>
                      {showShowCount ? row.show_count : row.class_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <details className="rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium" style={{ color: 'var(--accent)' }}>
          How points are earned — {pointSystem.name}
        </summary>
        <div className="px-4 pb-4 space-y-3 text-sm" style={{ color: 'var(--text-deep)' }}>
          {pointSystem.notes && <p>{pointSystem.notes}</p>}
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr style={{ color: 'var(--accent)' }}>
                  <th className="text-left font-semibold py-1 pr-4">Class size</th>
                  {Array.from({ length: Math.max(0, ...bands.map((b) => b.points.length)) }, (_, i) => (
                    <th key={i} className="text-right font-semibold py-1 px-2">{ordinal(i + 1)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bands.map((band, index) => (
                  <tr key={band.minEntries} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <td className="py-1 pr-4 whitespace-nowrap">{bandLabel(bands, index)}</td>
                    {band.points.map((points, i) => (
                      <td key={i} className="py-1 px-2 text-right">{points ? formatPoints(points) : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {bands[0] && bands[0].minEntries > 1 && (
              <>Classes of fewer than {bands[0].minEntries} earn no points. </>
            )}
            Only posted classes count. Each judge&apos;s card earns points on its own, a tie earns
            both horses that place&apos;s points, and an entry a judge did not place earns nothing
            from that card. Class size is the entries in the class.
          </p>
        </div>
      </details>
    </div>
  );
}
