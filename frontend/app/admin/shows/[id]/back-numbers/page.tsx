import { fetchShow, fetchRiders } from '@/lib/api';
import BackNumberForm from './BackNumberForm';
import Link from 'next/link';

async function fetchShowRiders(showId: string) {
  const API_URL = process.env.API_URL || 'http://backend:8000';
  const res = await fetch(`${API_URL}/shows/${showId}/back-numbers/`, { cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function fetchShowEntryRiders(showId: string) {
  const API_URL = process.env.API_URL || 'http://backend:8000';
  // Get all unique riders entered in any class of this show
  const classesRes = await fetch(`${API_URL}/shows/${showId}/classes/`);
  const classes = await classesRes.json();

  const riderMap = new Map<string, { rider_id: string; full_name: string; back_number: number | null }>();

  for (const cls of classes) {
    const entriesRes = await fetch(`${API_URL}/shows/${showId}/classes/${cls.id}/entries/`);
    const entries = await entriesRes.json();
    for (const entry of entries) {
      if (!riderMap.has(entry.rider_id)) {
        const riderRes = await fetch(`${API_URL}/riders/${entry.rider_id}`);
        const rider = await riderRes.json();
        riderMap.set(entry.rider_id, { rider_id: entry.rider_id, full_name: rider.full_name, back_number: null });
      }
    }
  }

  return Array.from(riderMap.values());
}

export default async function BackNumbersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, existingNumbers, riders] = await Promise.all([
    fetchShow(id),
    fetchShowRiders(id),
    fetchShowEntryRiders(id),
  ]);

  const existingMap = Object.fromEntries(existingNumbers.map((e: any) => [e.rider_id, e.back_number]));
  const enrichedRiders = riders.map((r: any) => ({
    ...r,
    back_number: existingMap[r.rider_id] ?? null,
  }));

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/admin/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to {show.name}
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Back Number Assignment</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — one back number per rider, valid across all classes
        </p>
      </div>
      {enrichedRiders.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No riders entered in this show yet.</p>
      ) : (
        <BackNumberForm showId={id} riders={enrichedRiders} />
      )}
    </main>
  );
}
