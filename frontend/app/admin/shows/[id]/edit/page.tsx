import { fetchShow, fetchVenues, fetchShowTypes } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import EditShowForm, { type Secretary } from '../EditShowForm';
import StepLayout from '../setup/_lib/StepLayout';
import { fetchStepCounts } from '../setup/_lib/fetchStepCounts';

async function fetchAuthed<T>(url: string, fallback: T): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) return fallback;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

export default async function EditShowDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);
  const [venues, showTypes, secretaries, availableSecretaries, stepsInput] =
    await Promise.all([
      fetchVenues(),
      fetchShowTypes(),
      fetchAuthed<Secretary[]>(`${API_URL}/shows/${id}/admins`, []),
      fetchAuthed<Secretary[]>(
        `${API_URL}/users/by-role?role=SHOW_SECRETARY`,
        [],
      ),
      fetchStepCounts(id, show.office_charge_cents ?? 0),
    ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="basic"
      title="Step 1: Basics"
      subtitle="Name, dates, venue, show type, and Show Secretary."
      stepsInput={stepsInput}
    >
      <EditShowForm
        show={show}
        venues={venues}
        showTypes={showTypes}
        initialSecretaries={secretaries}
        availableSecretaries={availableSecretaries}
      />
    </StepLayout>
  );
}
