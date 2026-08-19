import { notFound } from 'next/navigation';
import { fetchShow, fetchClasses } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadPot } from '../../loadPot';
import { BackToPot, potCrumbs } from '../../pot-shared';
import SidePotSettingsForm from './SidePotSettingsForm';

/**
 * The pot's own configuration: buy-in, payback, how it scores, and which classes
 * it spans. Locked once the pot is settled — the payouts were computed from
 * these, so editing them afterwards would describe a pot that never paid out.
 */
export default async function SidePotSettingsPage({
  params,
}: {
  params: Promise<{ id: string; potId: string }>;
}) {
  const { id, potId } = await params;
  const [show, pot, classes] = await Promise.all([
    fetchShow(id),
    loadPot(id, potId),
    fetchClasses(id),
  ]);

  if (!pot) notFound();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={potCrumbs(id, show.name, pot, 'Settings')} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {pot.name} — buy-in, payback, scoring, and the classes this pot spans.
        </p>
      </div>

      <SidePotSettingsForm showId={id} pot={pot} classes={classes} />

      <BackToPot showId={id} pot={pot} />
    </main>
  );
}
