import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadPot, loadPotPayouts, loadPotStandings } from '../../loadPot';
import { BackToPot, potCrumbs } from '../../pot-shared';
import StandingsView from './StandingsView';

/**
 * Where the pot is ranked and where it is settled.
 *
 * Settling lives here rather than on the hub on purpose: it is irreversible, and
 * it freezes exactly the table shown above the button. Reviewing the standings
 * and committing them are one motion, not two screens apart.
 */
export default async function SidePotStandingsPage({
  params,
}: {
  params: Promise<{ id: string; potId: string }>;
}) {
  const { id, potId } = await params;
  const [show, pot, standings, payouts] = await Promise.all([
    fetchShow(id),
    loadPot(id, potId),
    loadPotStandings(id, potId),
    loadPotPayouts(id, potId),
  ]);

  if (!pot) notFound();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={potCrumbs(id, show.name, pot, 'Standings')} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Standings
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {pot.name} — ranked from the results filed so far.
        </p>
      </div>

      <StandingsView
        showId={id}
        pot={pot}
        initialStandings={standings}
        initialPayouts={payouts}
      />

      <BackToPot showId={id} pot={pot} />
    </main>
  );
}
