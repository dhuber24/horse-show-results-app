import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import { isAutomaticUnit } from '@/lib/fee-units';
import BoardingFeesEditor from './BoardingFeesEditor';

async function fetchShowFees(showId: string, headers: HeadersInit) {
  const res = await fetch(`${API_URL}/shows/${showId}/fees/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function BoardingFeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, fees] = await Promise.all([
    fetchShow(id),
    fetchShowFees(id, headers || {}),
  ]);

  // Everything except the charges the show applies automatically — those are
  // edited on Entry Fees and in setup Step 5, and offering them here as well
  // would be two screens writing one row in two vocabularies.
  const boardingFees = fees.filter((f: { unit: string }) => !isAutomaticUnit(f.unit));

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Fee Schedule', href: `/admin/shows/${id}/fees` },
          { label: 'Boarding Fees' },
        ]} />
        <div className="flex items-center gap-2 mt-2">
          <span className="text-2xl" aria-hidden>🏕️</span>
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Boarding Fees</h1>
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Stalls, campsites, shavings, late entry, cross-entry surcharges, etc.
        </p>
      </div>

      <BoardingFeesEditor showId={id} initialFees={boardingFees} />
    </main>
  );
}
