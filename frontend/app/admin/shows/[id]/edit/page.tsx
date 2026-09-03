import { fetchShow, fetchVenues, fetchShowTypes, fetchShowCategories } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import EditShowForm from '../EditShowForm';
import ShowStaffPanel, { type PendingInvite } from '../ShowStaffPanel';
import StepLayout from '../setup/_lib/StepLayout';
import { fetchStepCounts } from '../setup/_lib/fetchStepCounts';
import { auth } from '@/auth';

type StaffUser = { id: string; full_name: string; email: string; role: string };

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
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role ?? '';
  const isAdmin = role === 'ADMIN';

  const show = await fetchShow(id);
  const [
    venues,
    showTypes,
    showCategories,
    managers,
    availableManagers,
    secretaries,
    availableSecretaries,
    scribes,
    gateStewards,
    pendingInvites,
    allUsers,
    stepsInput,
  ] = await Promise.all([
    fetchVenues(),
    fetchShowTypes(),
    fetchShowCategories(),
    fetchAuthed<StaffUser[]>(`${API_URL}/shows/${id}/managers`, []),
    fetchAuthed<StaffUser[]>(`${API_URL}/users/by-role?role=SHOW_MANAGER`, []),
    fetchAuthed<StaffUser[]>(`${API_URL}/shows/${id}/admins`, []),
    fetchAuthed<StaffUser[]>(`${API_URL}/users/by-role?role=SHOW_SECRETARY`, []),
    fetchAuthed<StaffUser[]>(`${API_URL}/shows/${id}/scribes`, []),
    fetchAuthed<StaffUser[]>(`${API_URL}/shows/${id}/gate-stewards`, []),
    fetchAuthed<PendingInvite[]>(`${API_URL}/user-invites/by-show/${id}`, []),
    isAdmin ? fetchAuthed<StaffUser[]>(`${API_URL}/users/`, []) : Promise.resolve([]),
    fetchStepCounts(id),
  ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="basic"
      title="Step 1: Basics & Staff"
      subtitle="Name, dates, venue, show type, and who runs the show."
      stepsInput={stepsInput}
    >
      <div className="space-y-6">
        <EditShowForm
          show={show}
          venues={venues}
          showTypes={showTypes}
          showCategories={showCategories}
        />

        <div className="space-y-2">
          <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>
            Show Staff
          </h2>
          <p className="text-sm" style={{ color: '#8b7355' }}>
            Everyone who works this show. Managers and secretaries run setup and the
            registration desk; scribes enter placings; gate stewards run the in-gate.
          </p>
          <ShowStaffPanel
            showId={id}
            currentUserRole={role}
            initialManagers={managers}
            availableManagers={availableManagers}
            initialAdmins={secretaries}
            availableSecretaries={availableSecretaries}
            initialScribes={scribes}
            initialGateStewards={gateStewards}
            allUsers={allUsers}
            isAdmin={isAdmin}
            initialPendingInvites={pendingInvites}
          />
        </div>
      </div>
    </StepLayout>
  );
}
