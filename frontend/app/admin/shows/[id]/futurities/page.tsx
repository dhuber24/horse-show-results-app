import { fetchShow, fetchClasses } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadFuturities } from './loadFuturity';
import FuturitiesManager from './FuturitiesManager';

/**
 * The show's futurities. Reached from its own tile on the show dashboard, next
 * to Side Pots — a futurity is its own program with its own entry fees and
 * deadline, not a line on the fee schedule.
 */
export default async function FuturitiesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [show, classes, futurities] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    loadFuturities(id),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Futurities' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Futurities
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — a futurity runs its own classes at its own entry fees, which
          vary by the category the entrant qualifies for. Hi-Point awards are scored
          over a named subset of those classes.
        </p>
      </div>

      <FuturitiesManager showId={id} initialFuturities={futurities} classes={classes} />
    </main>
  );
}
