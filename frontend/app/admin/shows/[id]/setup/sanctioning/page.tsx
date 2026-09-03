import { fetchShow } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import SanctioningClient, {
  type AssociationOption,
  type ShowSanctioningRow,
} from './SanctioningClient';
import StepLayout from '../_lib/StepLayout';
import { fetchStepCounts } from '../_lib/fetchStepCounts';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

export default async function SetupSanctioningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [associations, current, stepsInput] = await Promise.all([
    fetchAuthed<AssociationOption[]>(`${API_URL}/sanctioned-associations/`, []),
    fetchAuthed<ShowSanctioningRow[]>(`${API_URL}/shows/${id}/sanctioning/`, []),
    fetchStepCounts(id),
  ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="sanctioning"
      title="Step 3: Sanctioning"
      subtitle="Pick the sanctioning associations whose points apply to some or all classes. Skip if none apply."
      stepsInput={{ ...stepsInput, sanctioningCount: current.length }}
    >
      <SanctioningClient
        showId={id}
        associations={associations}
        current={current}
      />
    </StepLayout>
  );
}
