import { fetchShow } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import JudgesEditor from '../../judges/JudgesEditor';
import { fetchJudgeSetupData } from '../../judges/fetchJudgeSetupData';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts } from '../_lib/fetchStepCounts';

export default async function SetupJudgesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, judgeData, stepsInput] = await Promise.all([
    fetchShow(id),
    fetchJudgeSetupData(id, headers || {}),
    fetchStepCounts(id),
  ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="judges"
      title="Step 2: Judges"
      subtitle="Pick the judges officiating this show. Their details come from the judge registry."
      stepsInput={{ ...stepsInput, judgeCount: judgeData.judges.length }}
      skip={
        judgeData.judges.length === 0
          ? {
              label: 'Skip — add judges later',
              note: 'The panel can be picked any time before the show. One thing waits on it: a club or show fee priced per judge quotes nothing until there is a panel to multiply by.',
            }
          : undefined
      }
    >
      <JudgesEditor
        showId={id}
        initialJudges={judgeData.judges}
        registryJudges={judgeData.registryJudges}
        associations={judgeData.associations}
      />
    </StepLayout>
  );
}
