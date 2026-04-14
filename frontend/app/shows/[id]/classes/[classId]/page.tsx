import Link from 'next/link';
import { fetchShow, fetchClasses, fetchEntries, fetchResults, fetchHorse, fetchRider, fetchShowBackNumbers } from '@/lib/api';
import { auth } from '@/auth';

// Standard US horse show placement ribbon colors
const RIBBON_COLORS: Record<number, { main: string; dark: string; text: string; name: string }> = {
  1: { main: '#2563eb', dark: '#1e3a8a', text: '#ffffff', name: 'Blue' },
  2: { main: '#dc2626', dark: '#7f1d1d', text: '#ffffff', name: 'Red' },
  3: { main: '#facc15', dark: '#a16207', text: '#1a1a1a', name: 'Yellow' },
  4: { main: '#f1f5f9', dark: '#94a3b8', text: '#1e293b', name: 'White' },
  5: { main: '#f472b6', dark: '#9d174d', text: '#ffffff', name: 'Pink' },
  6: { main: '#16a34a', dark: '#14532d', text: '#ffffff', name: 'Green' },
  7: { main: '#7c3aed', dark: '#3b0764', text: '#ffffff', name: 'Purple' },
  8: { main: '#b45309', dark: '#451a03', text: '#ffffff', name: 'Brown' },
};

const DEFAULT_RIBBON = { main: '#6b7280', dark: '#1f2937', text: '#ffffff', name: 'Gray' };

function placeOrdinal(n: number) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function Ribbon({ place }: { place: number }) {
  const { main, dark, text } = RIBBON_COLORS[place] ?? DEFAULT_RIBBON;
  const cx = 22, cy = 22;

  // Scalloped rosette: small alternating circles around the outer ring
  const numPetals = 14;
  const petalR = 18;
  const petals = Array.from({ length: numPetals }, (_, i) => {
    const angle = (i / numPetals) * 2 * Math.PI - Math.PI / 2;
    return { x: cx + petalR * Math.cos(angle), y: cy + petalR * Math.sin(angle) };
  });

  return (
    <svg width="44" height="62" viewBox="0 0 44 62" aria-hidden="true">
      {/* Tails */}
      <polygon points={`14,37 9,62 22,53`} fill={dark} />
      <polygon points={`30,37 35,62 22,53`} fill={dark} />
      {/* Scalloped petal ring */}
      {petals.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5.5} fill={i % 2 === 0 ? main : dark} />
      ))}
      {/* Base circle */}
      <circle cx={cx} cy={cy} r={14} fill={main} />
      {/* Inner button ring */}
      <circle cx={cx} cy={cy} r={10} fill={dark} />
      {/* Center fill */}
      <circle cx={cx} cy={cy} r={8} fill={main} />
      {/* Place number */}
      <text
        x={cx} y={cy + 4}
        textAnchor="middle"
        fill={text}
        fontSize="10"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        {place}
      </text>
    </svg>
  );
}

export default async function ClassPage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  const canEnterPlacings = role === 'ADMIN' || role === 'SCOREKEEPER';

  const [show, classes, entries, results, backNumbers] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchEntries(id, classId),
    fetchResults(id, classId),
    fetchShowBackNumbers(id),
  ]);

  const cls = classes.find((c: any) => c.id === classId);
  const backNumberMap = Object.fromEntries(backNumbers.map((b: any) => [b.rider_id, b.back_number]));

  const enriched = await Promise.all(
    entries.map(async (entry: any) => {
      const [rider, horse] = await Promise.all([fetchRider(entry.rider_id), fetchHorse(entry.horse_id)]);
      return {
        ...entry,
        riderName: rider.full_name,
        horseName: horse.name,
        back_number: backNumberMap[entry.rider_id] ?? entry.back_number,
      };
    })
  );

  const resultsByEntryId = Object.fromEntries(results.map((r: any) => [r.entry_id, r]));
  const hasTies = results.some((r: any) => r.is_tie);

  // Collect which ribbon places actually appear, for the legend
  const placesUsed = [...new Set(results.map((r: any) => r.place as number))].sort((a, b) => a - b);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
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
          <Link href={`/shows/${id}/classes/${classId}/scorekeeper`}
            className="text-sm px-4 py-2 rounded font-medium whitespace-nowrap"
            style={{ backgroundColor: '#8b4513', color: '#ffffff' }}>
            Enter Placings
          </Link>
        )}
      </div>

      <div className="mt-6 rounded-lg border overflow-hidden" style={{ borderColor: '#d4b896' }}>
        {enriched.length === 0 ? (
          <p className="p-4" style={{ color: '#8b7355' }}>No entries found.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}>
                <th className="py-3 px-4 text-left text-sm font-semibold">Place</th>
                <th className="py-3 px-4 text-left text-sm font-semibold">Back #</th>
                <th className="py-3 px-4 text-left text-sm font-semibold">Rider</th>
                <th className="py-3 px-4 text-left text-sm font-semibold hidden md:table-cell">Horse</th>
              </tr>
            </thead>
            <tbody>
              {enriched
                .sort((a: any, b: any) => {
                  const ra = resultsByEntryId[a.id];
                  const rb = resultsByEntryId[b.id];
                  if (!ra) return 1;
                  if (!rb) return -1;
                  return ra.place - rb.place;
                })
                .map((entry: any, i: number) => {
                  const result = resultsByEntryId[entry.id];
                  return (
                    <tr key={entry.id}
                      style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#faf7f2', borderTop: '1px solid #d4b896' }}>
                      <td className="py-2 px-4 font-bold" style={{ color: '#8b4513' }}>
                        {result ? (
                          <span className="flex items-center gap-2">
                            <Ribbon place={result.place} />
                            <span>
                              {placeOrdinal(result.place)}
                              {result.is_tie && <span className="ml-1 text-xs font-normal" style={{ color: '#8b7355' }}>(T)</span>}
                            </span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 px-4" style={{ color: '#2c1810' }}>{entry.back_number ?? '—'}</td>
                      <td className="py-3 px-4" style={{ color: '#2c1810' }}>{entry.riderName}</td>
                      <td className="py-3 px-4 hidden md:table-cell" style={{ color: '#8b7355' }}>{entry.horseName}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>

      {/* Legend — only shown when there are results */}
      {placesUsed.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs" style={{ color: '#8b7355' }}>
          {placesUsed.map((place) => {
            const color = RIBBON_COLORS[place] ?? DEFAULT_RIBBON;
            return (
              <span key={place} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-3 rounded-full border"
                  style={{ backgroundColor: color.main, borderColor: color.dark }}
                />
                {color.name} — {placeOrdinal(place)}
              </span>
            );
          })}
          {hasTies && <span><span className="font-semibold">(T)</span> — Tie</span>}
        </div>
      )}
    </main>
  );
}
