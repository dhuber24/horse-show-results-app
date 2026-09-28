import { fetchShow, fetchClasses } from '@/lib/api';
import StepLayout from '../setup/_lib/StepLayout';
import { fetchStepCounts } from '../setup/_lib/fetchStepCounts';
import { DeclineFeature } from '../setup/_lib/SkipStep';
import { buildSteps, featureDeclined } from '../../_wizard/steps';
import { loadFuturities } from './loadFuturity';
import FuturitiesManager from './FuturitiesManager';
import { loadPots } from '../side-pots/loadPot';
import SidePotsManager from '../side-pots/SidePotsManager';

/**
 * Setup Step 6: Futurities & Side Pots. A futurity is set up while the show is,
 * so it belongs in the wizard — but it comes after the Class Builder, because a
 * futurity is defined by which classes belong to it and there is nothing to
 * pick from until the schedule exists. And before Fees, which shows its pricing
 * beside the show's own class fees.
 *
 * **Side pots share the step**, for the same reasons: a pot is a set of classes
 * with money of its own, decided while the show is built, and its buy-in lands
 * on the bill. Before, side pots were reachable only from the dashboard, so a
 * manager walking the wizard was never asked about them at all.
 *
 * Each is declined on its own (migration 154) — plenty of shows run a futurity
 * and no jackpot, or the other way round — and a declined one greys out its own
 * tile on the show dashboard. Skipping the whole step declines both, and only
 * then does the step fold away in the wizard.
 *
 * The route is unchanged: the dashboard's Futurities tile links straight here,
 * and its Side Pots tile goes to `/side-pots`, where the pots are run on the day.
 * A step is a position in the flow rather than a folder — the same arrangement
 * as Step 1 (`/edit`) and Step 4 (`/classes`).
 *
 * What this replaced was a single "futurity fee" box on the fees step, which could not
 * describe a futurity — the same class is priced three ways depending on how
 * the horse got there, entries close on a stated day after which each class
 * carries a late fee, the office fee per horse depends on club membership, and
 * the programme hands out Hi-Point awards over a named subset of its classes.
 */
export default async function FuturitiesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [classes, futurities, pots, counts] = await Promise.all([
    fetchClasses(id),
    loadFuturities(id),
    loadPots(id),
    fetchStepCounts(id),
  ]);
  const stepsInput = { ...counts, futurityCount: futurities.length, sidePotCount: pots.length };
  const stepSkipped = buildSteps(stepsInput).find((s) => s.key === 'futurities')?.skipped ?? false;

  const card = { borderColor: 'var(--border)', backgroundColor: 'var(--surface)' } as const;

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="futurities"
      title="Futurities & Side Pots"
      subtitle="Optional, both of them. A futurity runs its own classes at its own prices, closes entries on its own deadline and hands out Hi-Point awards. A side pot is a money pool over several classes — a divisional jackpot — whose buy-in goes on the exhibitor's bill."
      stepsInput={stepsInput}
      skip={
        futurities.length === 0 && pots.length === 0
          ? {
              label: 'Skip — no futurities or side pots',
              note: 'Most shows run neither. Nothing else in setup depends on this step.',
            }
          : undefined
      }
    >
      <div className="space-y-6">
        <section className="border rounded-lg p-4 space-y-4" style={card}>
          <div className="space-y-2">
            <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>Futurities</h2>
            {futurities.length === 0 && !stepSkipped && (
              <DeclineFeature
                showId={id}
                feature="futurities"
                declined={featureDeclined(stepsInput, 'futurities')}
                question="Not running a futurity at this show?"
                action="No futurity at this show"
                tile="Futurities"
              />
            )}
          </div>
          <FuturitiesManager showId={id} initialFuturities={futurities} classes={classes} />
        </section>

        <section className="border rounded-lg p-4 space-y-4" style={card}>
          <div className="space-y-2">
            <h2 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>Side Pots</h2>
            {pots.length === 0 && !stepSkipped && (
              <DeclineFeature
                showId={id}
                feature="sidepots"
                declined={featureDeclined(stepsInput, 'sidepots')}
                question="Not running a side pot at this show?"
                action="No side pots at this show"
                tile="Side Pots"
              />
            )}
          </div>
          <SidePotsManager showId={id} initialPots={pots} classes={classes} />
        </section>
      </div>
    </StepLayout>
  );
}
