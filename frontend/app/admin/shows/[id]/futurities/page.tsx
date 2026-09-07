import { fetchShow, fetchClasses } from '@/lib/api';
import StepLayout from '../setup/_lib/StepLayout';
import { fetchStepCounts } from '../setup/_lib/fetchStepCounts';
import { loadFuturities } from './loadFuturity';
import FuturitiesManager from './FuturitiesManager';

/**
 * Setup Step 7. A futurity is set up while the show is, so it belongs in the
 * wizard — but it comes after the Class Builder, because a futurity is defined
 * by which classes belong to it and there is nothing to pick from until the
 * schedule exists.
 *
 * The route is unchanged: the show dashboard links straight here, and a step is
 * a position in the flow rather than a folder. Same arrangement as Step 1
 * (`/edit`) and Step 5 (`/classes`).
 *
 * Most shows run no futurity at all, so the step offers a **Skip** alongside
 * the Next link. It goes to the same place; what it adds is the manager being
 * told on the step that walking past it is a supported answer, rather than
 * being left to wonder whether the tick that never goes green is a job they
 * have forgotten. Offered only while the show has none — a show that has set
 * one up is not skipping anything.
 *
 * What this replaced was a single "futurity fee" box in Step 5, which could not
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
  const [classes, futurities, stepsInput] = await Promise.all([
    fetchClasses(id),
    loadFuturities(id),
    fetchStepCounts(id),
  ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="futurities"
      title="Step 7: Futurities"
      subtitle="Optional. A futurity runs its own classes at its own prices, closes entries on its own deadline, and hands out Hi-Point awards — everything its entry form states is set up here."
      stepsInput={stepsInput}
      skipLabel={
        futurities.length === 0 ? 'Skip — no futurity at this show' : undefined
      }
    >
      <FuturitiesManager showId={id} initialFuturities={futurities} classes={classes} />
    </StepLayout>
  );
}
