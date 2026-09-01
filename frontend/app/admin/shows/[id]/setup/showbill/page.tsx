import { fetchShow, fetchShowbill } from '@/lib/api';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts } from '../_lib/fetchStepCounts';
import ShowbillClient from './ShowbillClient';

/**
 * Step 8: which show bill this show publishes.
 *
 * Last in the flow because the show bill is what the seven steps before it add
 * up to — the judges, the clubs, the fees and the class schedule on one sheet.
 * A manager reaching this step is either checking that sheet or handing over
 * the one their club already had printed.
 */
export default async function SetupShowbillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [showbill, stepsInput] = await Promise.all([
    fetchShowbill(id),
    fetchStepCounts(id, show.office_charge_cents ?? 0),
  ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="showbill"
      title="Step 8: Show Bill"
      subtitle="Publish the show bill this app builds, or upload the one your club already has."
      stepsInput={stepsInput}
    >
      <ShowbillClient
        showId={id}
        classCount={stepsInput.classCount}
        initialSource={showbill.source}
        initialDocument={showbill.document}
      />
    </StepLayout>
  );
}
