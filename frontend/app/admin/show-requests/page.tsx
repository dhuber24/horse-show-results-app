import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import AdminShowRequestsClient from './AdminShowRequestsClient';

export default async function AdminShowRequestsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.role !== 'ADMIN') redirect('/');

  const headers = await getAuthHeaders();
  let requests = [];
  if (headers) {
    try {
      const res = await fetch(`${API_URL}/show-requests/`, { headers, cache: 'no-store' });
      if (res.ok) requests = await res.json();
    } catch {}
  }

  const pendingCount = requests.filter((r: { status: string }) => r.status === 'PENDING').length;

  return (
    <main className="min-h-screen p-6" style={{ backgroundColor: '#faf7f2' }}>
      <div className="max-w-3xl mx-auto">
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Show Requests' },
          ]}
        />

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Show Requests</h1>
            <p className="text-sm mt-0.5" style={{ color: '#8b7355' }}>
              Review and approve show hosting requests from Show Managers
            </p>
          </div>
          {pendingCount > 0 && (
            <span
              className="text-sm font-semibold px-3 py-1 rounded-full"
              style={{ backgroundColor: '#fffbeb', color: '#92400e' }}
            >
              {pendingCount} pending
            </span>
          )}
        </div>

        <AdminShowRequestsClient initialRequests={requests} />
      </div>
    </main>
  );
}
