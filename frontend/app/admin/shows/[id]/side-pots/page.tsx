import { fetchShow, fetchClasses } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadPots } from './loadPot';
import SidePotsManager from './SidePotsManager';

/**
 * The show's side pots. Reached from its own tile on the show dashboard — side
 * pots are money the office takes at the desk and standings it reads between
 * classes, not part of the fee schedule the show publishes in advance.
 */
export default async function SidePotsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [show, classes, pots] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    loadPots(id),
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
          {show.name} — optional money pools spanning several classes. Buy-ins are collected
          per pot and stay out of the exhibitor&rsquo;s show bill.
        </p>
      </div>

      <SidePotsManager showId={id} initialPots={pots} classes={classes} />
    </main>
  );
}
