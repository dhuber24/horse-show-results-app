import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadPot, loadPotEntries, loadPotRoster } from '../../loadPot';
import { BackToPot, formatCents, potCrumbs } from '../../pot-shared';
import SidePotEntriesPanel from './SidePotEntriesPanel';

/**
 * Who is in the pot.
 *
 * The roster comes down with the page so the picker offers the show's
 * exhibitors by name — the desk knows who is buying in, not what number they
 * were assigned. Removing someone puts them straight back in the list without a
 * round trip, which is why the whole roster is passed rather than just who is
 * left to add.
 */
export default async function SidePotEntriesPage({
  params,
}: {
  params: Promise<{ id: string; potId: string }>;
}) {
  const { id, potId } = await params;
  const [show, pot, entries, roster] = await Promise.all([
    fetchShow(id),
    loadPot(id, potId),
    loadPotEntries(id, potId),
    loadPotRoster(id, potId),
  ]);

  if (!pot) notFound();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={potCrumbs(id, show.name, pot, 'Side Pot Entries')} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Side Pot Entries
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {pot.name} — {formatCents(pot.entry_fee_cents)} per exhibitor. Exhibitors join the
          pot at the show level, so one entry here covers every bundled class.
        </p>
      </div>

      <SidePotEntriesPanel
        showId={id}
        pot={pot}
        initialEntries={entries}
        roster={roster}
      />

      <BackToPot showId={id} pot={pot} />
    </main>
  );
}
