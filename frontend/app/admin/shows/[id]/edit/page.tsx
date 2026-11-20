import { fetchShow, fetchVenues, fetchShowTypes, fetchShowCategories } from '@/lib/api';
import { API_URL, getAuthHeaders } from '@/lib/backend-fetch';
import EditShowForm from '../EditShowForm';
import RingsSection, { type ShowRing, type VenueRing } from '../RingsSection';
import ShowCompanyStaff, { type PendingInvite, type ShowCompanyStaffPayload } from '../ShowCompanyStaff';
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
    companyCrew,
    officeNotes,
    rings,
    venueRings,
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
    // The company's crew (migration 169), who the office assigns from.
    isAdmin ? Promise.resolve([]) : fetchAuthed<StaffUser[]>(`${API_URL}/shows/${id}/company-crew`, []),
    // The office's own notes (migration 184), off the public show payload.
    // Null when the read fails, which the form treats as "do not touch".
    fetchAuthed<{ office_notes: string | null } | null>(`${API_URL}/shows/${id}/office-notes`, null),
    // The show's rings and its venue's (migration 204). Null rings is "could
    // not be read", which the section says rather than offering an empty list.
    fetchAuthed<ShowRing[] | null>(`${API_URL}/shows/${id}/rings/`, null),
    show.venue_id
      ? fetchAuthed<VenueRing[]>(`${API_URL}/shows/${id}/rings/venue`, [])
      : Promise.resolve([] as VenueRing[]),
  ]);

  return (
    <StepLayout
      showId={id}
      showName={show.name}
      current="basic"
      title="Basics & Staff"
      subtitle="Name, dates, venue and its rings, show type, show notes, and who runs the show."
      stepsInput={stepsInput}
    >
      <div className="space-y-6">
        <EditShowForm
          show={show}
          venues={venues}
          showTypes={showTypes}
          showCategories={showCategories}
          officeNotes={officeNotes ? officeNotes.office_notes : undefined}
        />

        {/* Keyed on the saved venue: saving a different one above refreshes
            the page, and the section starts again at the new venue. */}
        <RingsSection
          key={show.venue_id ?? 'no-venue'}
          showId={id}
          venueName={show.venue_id ? (show.venue ?? 'this venue') : null}
          initialRings={rings}
          initialVenueRings={venueRings}
        />

        <div className="space-y-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              Show Staff
            </h2>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              The company that runs this show staffs it: its managers and secretaries run setup and
              the registration desk. Anybody hired for this show alone (a guest secretary, the
              scribes who enter placings, the gate stewards who run the in-gate) is listed from
              outside the company.
            </p>
          </div>
          {companyStaff ? (
            <ShowCompanyStaff
              showId={id}
              initial={companyStaff}
              availableManagers={availableManagers}
              availableSecretaries={availableSecretaries}
              scribes={scribes}
              gateStewards={gateStewards}
              pendingInvites={pendingInvites}
              allUsers={allUsers}
              companyCrew={companyCrew}
              isAdmin={isAdmin}
            />
          ) : (
            <p className="text-sm" role="alert" style={{ color: 'var(--error)' }}>
              The show&apos;s staff could not be loaded. Reload the page to try again.
            </p>
          )}
        </div>
      </div>
    </StepLayout>
  );
}
