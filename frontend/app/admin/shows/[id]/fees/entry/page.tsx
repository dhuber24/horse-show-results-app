import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import { isAutomaticUnit } from '@/lib/fee-units';
import type { ShowCharge } from '@/components/ShowChargesEditor';
import EntryFeesEditor from './EntryFeesEditor';

async function fetchShowFees(showId: string, headers: HeadersInit) {
  const res = await fetch(`${API_URL}/shows/${showId}/fees/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

async function fetchJudges(showId: string, headers: HeadersInit) {
  const res = await fetch(`${API_URL}/shows/${showId}/judges/`, { headers, cache: 'no-store' });
  if (!res.ok) return [];
  return res.json();
}

export default async function EntryFeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, classes, fees, judges] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchShowFees(id, headers || {}),
    fetchJudges(id, headers || {}),
  ]);

  // Picked out by unit, not by a list of codes: the whole point of these rows is
  // that the show manager names their own. See AUTOMATIC_FEE_UNITS in
  // backend/billing.py for what makes a unit one of these.
  const charges: ShowCharge[] = fees.filter((f: { unit: string }) => isAutomaticUnit(f.unit));

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Fee Schedule', href: `/admin/shows/${id}/fees` },
          { label: 'Entry Fees' },
        ]} />
        <div className="flex items-center gap-2 mt-2">
          <span className="text-2xl" aria-hidden>🎟️</span>
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Entry Fees</h1>
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          The office charge, any fee the show adds per exhibitor, horse or judge,
          and what each class costs to enter.
        </p>
      </div>

      <EntryFeesEditor
        showId={id}
        initialOfficeChargeCents={show.office_charge_cents ?? 0}
        initialOfficeChargeBasis={show.office_charge_basis ?? 'per_back_number'}
        initialCharges={charges}
        initialClasses={classes}
        judgeCount={judges.length}
      />
    </main>
  );
}
