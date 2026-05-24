import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import FeeScheduleEditor from './FeeScheduleEditor';

async function fetchShowFees(showId: string, headers: HeadersInit) {
  const res = await fetch(`${API_URL}/shows/${showId}/fees/`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function FeeSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, classes, fees] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchShowFees(id, headers || {}),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Fee Schedule' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Fee Schedule</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — all fees the show charges exhibitors. The app does not
          collect payment; amounts are shown on the exhibitor registration screen.
        </p>
      </div>

      <FeeScheduleEditor
        showId={id}
        initialFees={fees}
        initialOfficeChargeCents={show.office_charge_cents ?? 0}
        initialClasses={classes}
      />
    </main>
  );
}
