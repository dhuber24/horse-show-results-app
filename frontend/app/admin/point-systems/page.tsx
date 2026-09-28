import { auth } from '@/auth';
import Breadcrumbs from '@/components/Breadcrumbs';
import { fetchAssociations, fetchPointSystemOwners, fetchPointSystems } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import PointSystemsManager, { type AssociationOption } from './PointSystemsManager';

/**
 * Points systems (migrations 147, 148) — the charts that turn posted placings
 * into high-point points, entered one association at a time by the show
 * company whose shows score by them. Nothing is seeded: a chart the app made up
 * would be read at the rail as the association's. A company's people see only
 * their own company's; a GaitDesk admin sees every one.
 */
export default async function AdminPointSystemsPage() {
  const session = await auth();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'ADMIN';
  const headers = await getAuthHeaders();
  const [systems, owners, associations] = await Promise.all([
    fetchPointSystems(headers),
    fetchPointSystemOwners(headers),
    fetchAssociations(headers ?? undefined).catch(() => [] as AssociationOption[]),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Points Systems' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Points Systems</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          How a posted placing becomes high-point points. Each association scores its own way, so
          enter each chart from its rule book. A show chooses one for its leaderboard, and a season
          circuit chooses one for its standings.{' '}
          {isAdmin
            ? 'You see every show company’s systems, and the GaitDesk standard ones — the associations’ own charts — which every company can choose.'
            : 'Your show company’s systems are yours alone. The GaitDesk standard ones are the associations’ own charts: choose one as it is, or use it as a template for your own.'}
        </p>
      </div>
      <PointSystemsManager
        initialSystems={systems}
        owners={owners}
        isAdmin={isAdmin}
        associations={(associations as AssociationOption[]).map((a) => ({ id: a.id, code: a.code, name: a.name }))}
      />
    </main>
  );
}
