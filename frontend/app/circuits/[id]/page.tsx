import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchCircuitLeaderboard } from '@/lib/api';
import AutoRefresh from '@/components/AutoRefresh';
import HighPointStandings from '@/components/HighPointStandings';

/**
 * A season circuit's standings (migration 147): every posted class at every
 * show in the circuit, added up under the circuit's own points system. Public,
 * like each show's own leaderboard; reached from those leaderboards.
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default async function CircuitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const circuit = await fetchCircuitLeaderboard(id);
  if (!circuit) notFound();

  const running = circuit.shows.some((s) => s.status === 'ACTIVE');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      {running && <AutoRefresh />}
      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
        ← Back to Shows
      </Link>

      <div className="mt-4 mb-6 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{circuit.name}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Season circuit{circuit.season ? ` · ${circuit.season}` : ''}
          {circuit.point_system ? ` · ${circuit.point_system.name}` : ''}
        </p>
        {circuit.notes && (
          <p className="text-sm mt-2" style={{ color: 'var(--text-deep)' }}>{circuit.notes}</p>
        )}
      </div>

      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Season standings</h2>
      {!circuit.point_system ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          The circuit has no points system chosen yet, so there are no standings to show.
        </p>
      ) : circuit.divisions.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No points yet. Standings appear as soon as a class at one of the circuit&apos;s shows is
          judged and its placings are posted.
        </p>
      ) : (
        <HighPointStandings divisions={circuit.divisions} pointSystem={circuit.point_system} showShowCount />
      )}

      <h2 className="text-lg font-semibold mt-8 mb-3" style={{ color: 'var(--foreground)' }}>
        Shows in this circuit
      </h2>
      {circuit.shows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No shows have been added yet.</p>
      ) : (
        <ul className="space-y-2">
          {circuit.shows.map((s) => (
            <li key={s.id}>
              <Link
                href={`/shows/${s.id}`}
                className="block p-3 rounded-lg border transition hover:shadow-md"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="font-medium" style={{ color: 'var(--foreground)' }}>{s.name}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {formatDate(s.start_date)}
                  {s.end_date && s.end_date !== s.start_date ? ` – ${formatDate(s.end_date)}` : ''}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
