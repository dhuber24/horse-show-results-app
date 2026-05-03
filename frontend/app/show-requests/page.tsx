import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';

interface ShowRequest {
  id: string;
  show_name: string;
  show_type_code: string | null;
  show_type_name: string | null;
  venue_name: string | null;
  start_date: string;
  end_date: string;
  manager_association_id: string | null;
  association_approval_confirmed: boolean;
  notes: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_notes: string | null;
  created_show_id: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  PENDING:  { bg: '#fffbeb', color: '#92400e', label: 'Pending Review' },
  APPROVED: { bg: '#f0fdf4', color: '#166534', label: 'Approved' },
  REJECTED: { bg: '#fef2f2', color: '#991b1b', label: 'Rejected' },
};

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const e = new Date(end + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return s === e ? s : `${s} – ${e}`;
}

export default async function ShowRequestsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'SHOW_MANAGER') redirect('/');

  const headers = await getAuthHeaders();
  let requests: ShowRequest[] = [];
  if (headers) {
    try {
      const res = await fetch(`${API_URL}/show-requests/`, { headers, cache: 'no-store' });
      if (res.ok) requests = await res.json();
    } catch {}
  }

  const pending = requests.filter(r => r.status === 'PENDING');
  const decided = requests.filter(r => r.status !== 'PENDING');

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: '#faf7f2' }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>My Show Requests</h1>
            <p className="text-sm mt-0.5" style={{ color: '#8b7355' }}>
              Track the status of your show hosting requests
            </p>
          </div>
          <Link
            href="/show-requests/new"
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
          >
            + New Request
          </Link>
        </div>

        {requests.length === 0 ? (
          <div className="rounded-lg border p-8 text-center" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
            <p className="text-sm" style={{ color: '#8b7355' }}>
              You haven&apos;t submitted any show requests yet.
            </p>
            <Link
              href="/show-requests/new"
              className="inline-block mt-3 px-4 py-2 rounded-lg text-sm font-medium"
              style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
            >
              Submit your first request
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {pending.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: '#8b7355' }}>
                  Pending Review
                </h2>
                <div className="space-y-3">
                  {pending.map(req => <RequestCard key={req.id} req={req} />)}
                </div>
              </section>
            )}
            {decided.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold mb-3 uppercase tracking-wide" style={{ color: '#8b7355' }}>
                  Decided
                </h2>
                <div className="space-y-3">
                  {decided.map(req => <RequestCard key={req.id} req={req} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function RequestCard({ req }: { req: ShowRequest }) {
  const style = STATUS_STYLES[req.status] ?? STATUS_STYLES.PENDING;

  return (
    <div className="rounded-lg border p-4" style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold" style={{ color: '#2c1810' }}>{req.show_name}</p>
          <p className="text-sm mt-0.5" style={{ color: '#5a3e2b' }}>
            {req.show_type_name ?? req.show_type_code ?? '—'}
            {req.venue_name ? ` · ${req.venue_name}` : ''}
          </p>
          <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
            {formatDateRange(req.start_date, req.end_date)}
          </p>
        </div>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: style.bg, color: style.color }}
        >
          {style.label}
        </span>
      </div>

      {req.status === 'APPROVED' && req.created_show_id && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: '#f0e6d3' }}>
          <Link
            href={`/shows/${req.created_show_id}`}
            className="text-sm font-medium hover:underline"
            style={{ color: '#8b4513' }}
          >
            View show →
          </Link>
        </div>
      )}

      {req.status === 'REJECTED' && req.admin_notes && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: '#f0e6d3' }}>
          <p className="text-xs font-medium" style={{ color: '#991b1b' }}>Admin notes:</p>
          <p className="text-xs mt-0.5" style={{ color: '#5a3e2b' }}>{req.admin_notes}</p>
        </div>
      )}
    </div>
  );
}
