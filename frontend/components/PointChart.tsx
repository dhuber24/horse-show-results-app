'use client';

import {
  addChartBand,
  bandLabel,
  chartBands,
  formatPoints,
  ordinal,
  placeLimit,
  rangeText,
  removeChartBand,
  rowTop,
  setChartCell,
  setChartFrom,
  setChartPlaces,
  setChartTo,
  widestRow,
  type ChartDraft,
  type PointAward,
} from '@/lib/high-point';

const inputStyle = { borderColor: 'var(--border)', backgroundColor: 'var(--background)' } as const;
const labelStyle = { color: 'var(--text-deep)' } as const;
const quietButton = { borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' } as const;

/**
 * A points chart as it will score: a row per range of class sizes, a column per
 * place. Read-only — what a show office looks at before choosing a template, and
 * what the Points Systems library prints under each system.
 */
export function ChartPreview({ awards }: { awards: PointAward[] }) {
  const bands = chartBands(awards);
  const places = Math.max(0, ...bands.map((b) => b.points.length));
  if (bands.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        An empty chart — you enter every class size and place yourself.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr style={{ color: 'var(--accent)' }}>
            <th className="text-left font-semibold py-1 pr-4">Class size</th>
            {Array.from({ length: places }, (_, i) => (
              <th key={i} className="text-right font-semibold py-1 px-2">{ordinal(i + 1)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bands.map((band, index) => (
            <tr key={band.minEntries} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="py-1 pr-4 whitespace-nowrap" style={labelStyle}>{bandLabel(bands, index)}</td>
              {Array.from({ length: places }, (_, i) => (
                <td key={i} className="py-1 px-2 text-right" style={labelStyle}>
                  {band.points[i] ? formatPoints(band.points[i]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The chart as an editable grid. Controlled: the caller holds the `ChartDraft`
 * and turns it into award rows with `awardsFromChart` when it saves, so the
 * library and a show's own chart (migration 153) validate identically.
 */
export function ChartGridEditor({
  chart,
  onChange,
}: {
  chart: ChartDraft;
  onChange: (next: ChartDraft) => void;
}) {
  const widest = widestRow(chart.bands);
  const { bands } = chart;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide" style={labelStyle}>Points by place</div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        One row per range of class sizes, the way the rules print them &mdash; 3&ndash;4, 5&ndash;9,
        10&ndash;14. Typing where a row ends starts the next row one higher. A row pays as many
        places as the largest class in its range, so a 5&ndash;9 row can pay down to 9th; the last
        row covers every bigger class and pays as many places as its first size. A class
        smaller than the first row earns nothing. A flat 6-5-4-3-2-1 scale is two rows,
        1&ndash;6 and 7 &amp; over. Leave a place blank for no points.
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr style={{ color: 'var(--accent)' }}>
              <th className="text-left text-xs font-semibold py-1 pr-2 whitespace-nowrap">Class size</th>
              {Array.from({ length: chart.places }, (_, i) => (
                <th key={i} className="text-xs font-semibold py-1 px-1 text-center">{ordinal(i + 1)}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {bands.map((band, bandIndex) => (
              <tr key={bandIndex}>
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={band.minEntries}
                      onChange={(e) => onChange(setChartFrom(chart, bandIndex, e.target.value))}
                      aria-label={`Row ${bandIndex + 1}: smallest class size`}
                      className="border rounded px-2 py-1 w-16 text-sm"
                      style={inputStyle}
                    />
                    <span aria-hidden="true" style={{ color: 'var(--muted)' }}>&ndash;</span>
                    {bandIndex === bands.length - 1 ? (
                      <span className="text-xs px-1" style={{ color: 'var(--muted)' }} title="The last row covers every bigger class">
                        &amp; over
                      </span>
                    ) : (
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={rowTop(bands, bandIndex) ?? ''}
                        onChange={(e) => onChange(setChartTo(chart, bandIndex, e.target.value))}
                        aria-label={`Row ${bandIndex + 1}: largest class size`}
                        title="Where this row ends. The next row starts one higher."
                        className="border rounded px-2 py-1 w-16 text-sm"
                        style={inputStyle}
                      />
                    )}
                  </div>
                </td>
                {Array.from({ length: chart.places }, (_, place) => {
                  const limit = placeLimit(bands, bandIndex);
                  const beyond = place + 1 > limit;
                  return (
                    <td key={place} className="py-1 px-1">
                      <input
                        inputMode="decimal"
                        value={beyond ? '' : (band.points[place] ?? '')}
                        onChange={(e) => onChange(setChartCell(chart, bandIndex, place, e.target.value))}
                        disabled={beyond}
                        placeholder={beyond ? '—' : undefined}
                        title={
                          beyond
                            ? limit
                              ? `Classes of ${rangeText(bands, bandIndex)} can pay at most ${limit} ${limit === 1 ? 'place' : 'places'}`
                              : 'Enter the class sizes, smallest row first'
                            : undefined
                        }
                        aria-label={`${ordinal(place + 1)} place, classes of ${rangeText(bands, bandIndex)}`}
                        className="border rounded px-1 py-1 w-14 text-sm text-center disabled:opacity-40"
                        style={beyond ? { ...inputStyle, backgroundColor: 'var(--bg-subtle)' } : inputStyle}
                      />
                    </td>
                  );
                })}
                <td className="py-1 pl-2">
                  <button
                    type="button"
                    onClick={() => onChange(removeChartBand(chart, bandIndex))}
                    disabled={bands.length === 1}
                    title={bands.length === 1 ? 'A chart needs at least one row' : 'Remove this row'}
                    className="text-xs hover:underline disabled:opacity-40"
                    style={{ color: 'var(--error)' }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(addChartBand(chart))}
          className="px-3 py-1.5 rounded border text-xs font-medium"
          style={quietButton}
        >
          + Class-size row
        </button>
        <button
          type="button"
          onClick={() => onChange(setChartPlaces(chart, chart.places + 1))}
          disabled={chart.places >= widest}
          title={
            chart.places >= widest
              ? `No row can pay a ${ordinal(chart.places + 1)} place: the widest range tops out at ${widest}. Widen a row's range, or add a row, first`
              : 'Add a place column'
          }
          className="px-3 py-1.5 rounded border text-xs font-medium disabled:opacity-40"
          style={quietButton}
        >
          + Place
        </button>
        <button
          type="button"
          onClick={() => onChange(setChartPlaces(chart, chart.places - 1))}
          disabled={chart.places <= 1}
          title={chart.places <= 1 ? 'A chart needs at least one place' : 'Remove the last place column'}
          className="px-3 py-1.5 rounded border text-xs font-medium disabled:opacity-40"
          style={quietButton}
        >
          − Place
        </button>
      </div>
    </div>
  );
}
