import { fetchShow, fetchVenues, fetchShowTypes, fetchShowCategories } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import EditShowForm from '../EditShowForm';
import ShowCompanyStaff, { type ShowCompanyStaffPayload } from '../ShowCompanyStaff';
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
    companyStaff,
    availableManagers,
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
    fetchAuthed<ShowCompanyStaffPayload | null>(`${API_URL}/shows/${id}/company-staff`, null),
    fetchAuthed<StaffUser[]>(`${API_URL}/users/by-role?role=SHOW_MANAGER`, []),
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
      title="Basics & Staff"
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

        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              Show Staff
            </h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              The company that runs this show staffs it: its managers and secretaries run setup and
              the registration desk. Scribes, who enter placings, and gate stewards, who run the
              in-gate, are hired for this show.
            </p>
          </div>
          {companyStaff ? (
            <ShowCompanyStaff
              showId={id}
              initial={companyStaff}
              availableManagers={availableManagers}
              availableSecretaries={availableSecretaries}
              isAdmin={isAdmin}
            />
          ) : (
            <p className="text-sm" role="alert" style={{ color: 'var(--error)' }}>
              The show&apos;s staff could not be loaded. Reload the page to try again.
            </p>
          )}
          <ShowStaffPanel
            showId={id}
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
