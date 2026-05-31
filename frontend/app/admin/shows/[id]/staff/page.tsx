import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchShow } from '@/lib/api';
import { API_URL } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import ShowStaffPanel, { type PendingInvite } from '../ShowStaffPanel';

type StaffUser = {
  id: string;
  full_name: string;
  email: string;
  role: string;
};

async function fetchStaff(
  showId: string,
  headers: Record<string, string>,
  isAdmin: boolean,
): Promise<{
  admins: StaffUser[];
  scorekeepers: StaffUser[];
  allUsers: StaffUser[];
  pendingInvites: PendingInvite[];
}> {
  const [adminsRes, keepersRes, invitesRes] = await Promise.all([
    fetch(`${API_URL}/shows/${showId}/admins`, { headers, cache: 'no-store' }),
    fetch(`${API_URL}/shows/${showId}/scorekeepers`, { headers, cache: 'no-store' }),
    fetch(`${API_URL}/user-invites/by-show/${showId}`, { headers, cache: 'no-store' }),
  ]);
  let allUsers: StaffUser[] = [];
  if (isAdmin) {
    const allUsersRes = await fetch(`${API_URL}/users/`, { headers, cache: 'no-store' });
    if (allUsersRes.ok) allUsers = await allUsersRes.json();
  }
  return {
    admins: adminsRes.ok ? await adminsRes.json() : [],
    scorekeepers: keepersRes.ok ? await keepersRes.json() : [],
    allUsers,
    pendingInvites: invitesRes.ok ? await invitesRes.json() : [],
  };
}

export default async function ShowStaffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const role = user?.role ?? '';
  if (!['ADMIN', 'SHOW_SECRETARY', 'SHOW_MANAGER'].includes(role) || !user?.id) {
    redirect(`/admin/shows/${id}`);
  }
  const isAdmin = role === 'ADMIN';

  const show = await fetchShow(id);
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': INTERNAL_API_KEY,
    'X-User-Id': user.id,
    'X-User-Role': role,
  };
  const staff = await fetchStaff(id, headers, isAdmin);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Show Staff' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Show Staff
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {show.name} — manage Show Secretaries and Scorekeepers.
        </p>
      </div>

      <ShowStaffPanel
        showId={id}
        currentUserRole={role}
        initialAdmins={staff.admins}
        initialScorekeepers={staff.scorekeepers}
        allUsers={staff.allUsers}
        isAdmin={isAdmin}
        initialPendingInvites={staff.pendingInvites}
      />
    </main>
  );
}
