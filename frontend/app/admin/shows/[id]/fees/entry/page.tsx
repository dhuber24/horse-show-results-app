import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
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

  const perHorseFees = fees.filter((f: { unit: string }) => f.unit === 'per_horse');
  const perJudgeFees = fees.filter((f: { unit: string }) => f.unit === 'per_judge');
  const judgeTypes = [
    show.show_type_code && show.show_type_code !== 'OPEN'
      ? { code: show.show_type_code, name: show.show_type_name ?? show.show_type_code }
      : null,
    ...((show.affiliations ?? []).map((a: { show_type_code: string; show_type_name: string }) => (
      a.show_type_code && a.show_type_code !== 'OPEN'
        ? { code: a.show_type_code, name: a.show_type_name ?? a.show_type_code }
        : null
    ))),
  ].filter(Boolean);

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
          Office charges, per-judge fees, and per-class entry fees.
        </p>
      </div>

      <EntryFeesEditor
        showId={id}
        initialOfficeChargeCents={show.office_charge_cents ?? 0}
        initialPerHorseFees={perHorseFees}
        initialPerJudgeFees={perJudgeFees}
        initialClasses={classes}
        judges={judges}
        judgeTypes={judgeTypes}
      />
    </main>
  );
}
