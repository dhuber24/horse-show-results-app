import { auth } from '@/auth';
import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import SidePotsManager from './SidePotsManager';

async function fetchPots(showId: string, headers: Record<string, string>) {
  const res = await fetch(`${API_URL}/shows/${showId}/side-pots/`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function SidePotsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = session?.user as any;
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': INTERNAL_API_KEY,
    'X-User-Id': user?.id ?? '',
    'X-User-Role': user?.role ?? '',
  };

  const [show, classes, pots] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchPots(id, headers),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Side Pots' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Side Pots
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name}
        </p>
      </div>

      <SidePotsManager showId={id} initialPots={pots} classes={classes} />
    </main>
  );
}
