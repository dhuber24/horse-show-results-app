import type { ReactNode } from 'react';
import { formatPoints, type HighPointClass } from '@/lib/high-point';

/**
 * Each class, how many horses it was shown to, and the points it put up for
 * grabs (migration 167) — the figures the standings above it are added up
 * from, so a total can be checked against the classes that made it.
 *
 * Read off the backend (`summarize_class` in `backend/high_point.py`), never
 * worked out here: the class size, the chart band and the judge panel are the
 * standings' own, and a second copy of that arithmetic is how a table comes to
 * disagree with the totals beside it.
 *
 * The public leaderboard prints the posted classes. The show office's High
 * Point page prints every class with `control`, a "counts" tick per row.
 */

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function pts(points: number): string {
  return `${formatPoints(points)} ${points === 1 ? 'pt' : 'pts'}`;
}

/** The line under a class's name: its division, the panel, how deep it pays,
 *  or why it puts nothing up. */
function detail(cls: HighPointClass): string {
  const parts: string[] = [];
  // Most class names already say their division ("Showmanship Senior 19 &
  // Over"); it is named here only where the name does not.
  if (cls.division_name && !cls.class_name.toLowerCase().includes(cls.division_name.toLowerCase())) {
    parts.push(cls.division_name);
  }
  if (!cls.eligible) {
    parts.push('doesn’t count toward high point');
    return parts.join(' · ');
  }
  if (cls.points_by_place === null) return parts.join(' · ');
  if (cls.points_by_place.length === 0 || (cls.points_per_card ?? 0) === 0) {
    parts.push(cls.entries === 0 ? 'no entries yet' : 'too few entries to earn points');
    return parts.join(' · ');
  }
  if (cls.cards > 1) parts.push(`${cls.cards} judges, each card earns its own`);
  if (cls.places_paid) parts.push(`pays ${cls.places_paid} ${cls.places_paid === 1 ? 'place' : 'places'}`);
  return parts.join(' · ');
}

export default function HighPointClassPoints({
  classes,
  control,
  controlHeading,
}: {
  classes: HighPointClass[];
  /** The office's tick per row, where it may choose which classes count. */
  control?: (cls: HighPointClass) => ReactNode;
  controlHeading?: string;
}) {
  const days = new Map<string, HighPointClass[]>();
  for (const cls of classes) days.set(cls.class_date, [...(days.get(cls.class_date) ?? []), cls]);

  return (
    <div className="space-y-4">
      {Array.from(days.entries()).map(([day, dayClasses]) => (
        <div key={day}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--muted)' }}>
            {formatDay(day)}
          </p>
          <div className="rounded-lg border overflow-x-auto" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left" style={{ color: 'var(--accent)' }}>
                  {control && (
                    <th className="font-semibold py-2 pl-3 pr-1 w-10 text-xs" scope="col">
                      {controlHeading ?? 'Counts'}
                    </th>
                  )}
                  <th className={`font-semibold py-2 pr-3 ${control ? '' : 'pl-3'}`} scope="col">Class</th>
                  <th className="font-semibold py-2 pr-3 text-right" scope="col">Entries</th>
                  <th
                    className="font-semibold py-2 pr-3 text-right whitespace-nowrap"
                    scope="col"
                    title="What first place earns on one judge's card"
                  >
                    1st
                  </th>
                  <th
                    className="font-semibold py-2 pr-3 text-right whitespace-nowrap"
                    scope="col"
                    title="Every place's points on every judge's card, added together"
                  >
                    Up for grabs
                  </th>
                </tr>
              </thead>
              <tbody>
                {dayClasses.map((cls) => {
                  const muted = !cls.eligible;
                  const ink = muted ? 'var(--muted)' : 'var(--foreground)';
                  const line = detail(cls);
                  return (
                    <tr key={cls.class_id} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                      {control && <td className="py-2 pl-3 pr-1">{control(cls)}</td>}
                      <td className={`py-2 pr-3 ${control ? '' : 'pl-3'}`}>
                        <span style={{ color: ink }}>
                          <span className="font-mono" style={{ color: muted ? 'var(--muted)' : 'var(--accent)' }}>
                            {cls.class_number}
                          </span>{' '}
                          {cls.class_name}
                        </span>
                        {line && (
                          <span className="block text-xs" style={{ color: 'var(--muted)' }}>{line}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums" style={{ color: ink }}>{cls.entries}</td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap" style={{ color: ink }}>
                        {cls.first_place_points ? pts(cls.first_place_points) : '—'}
                      </td>
                      <td
                        className="py-2 pr-3 text-right tabular-nums whitespace-nowrap font-semibold"
                        style={{ color: ink }}
                      >
                        {cls.points_available === null ? '—' : muted ? '—' : pts(cls.points_available)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
