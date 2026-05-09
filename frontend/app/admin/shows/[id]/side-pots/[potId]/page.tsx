import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import SidePotDetail from './SidePotDetail';

async function fetchAuth(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export default async function SidePotDetailPage({
  params,
}: {
  params: Promise<{ id: string; potId: string }>;
}) {
  const { id, potId } = await params;
  const session = await auth();
  const user = session?.user as any;
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': INTERNAL_API_KEY,
    'X-User-Id': user?.id ?? '',
    'X-User-Role': user?.role ?? '',
  };

  const [show, classes, pot, entries, standings, payouts] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchAuth(`${API_URL}/shows/${id}/side-pots/${potId}`, headers),
    fetchAuth(`${API_URL}/shows/${id}/side-pots/${potId}/entries`, headers),
    fetchAuth(`${API_URL}/shows/${id}/side-pots/${potId}/standings`, headers),
    fetchAuth(`${API_URL}/shows/${id}/side-pots/${potId}/payouts`, headers),
  ]);

  if (!pot) notFound();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Side Pots', href: `/admin/shows/${id}/side-pots` },
            { label: pot.name },
          ]}
        />
      </div>

      <SidePotDetail
        showId={id}
        initialPot={pot}
        initialEntries={entries ?? []}
        initialStandings={standings}
        initialPayouts={payouts ?? []}
        classes={classes}
      />
    </main>
  );
}
