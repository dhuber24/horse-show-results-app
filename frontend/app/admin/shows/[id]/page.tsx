import Link from 'next/link';
import { auth } from '@/auth';
import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL } from '@/lib/backend-fetch';
import ShowStatusControl from './ShowStatusControl';
import ShowStaffPanel from './ShowStaffPanel';
import Breadcrumbs from '@/components/Breadcrumbs';

const tiles = (showId: string) => [
  {
    href: `/admin/shows/${showId}/edit`,
    title: 'Edit Show Details',
    description: 'Update name, venue, dates, and status.',
    icon: '📝',
  },
  {
    href: `/admin/shows/${showId}/classes`,
    title: 'Add / Modify Classes',
    description: 'Create new classes and edit existing ones.',
    icon: '📋',
  },
  {
    href: `/admin/shows/${showId}/entries`,
    title: 'Add / Modify Entries',
    description: 'Enter horses and exhibitors in classes.',
    icon: '🎟️',
  },
  {
    href: `/admin/shows/${showId}/back-numbers`,
    title: 'Assign Back Numbers',
    description: 'Assign back numbers to exhibitors for this show.',
    icon: '🔢',
  },
];

const scoringTile = (showId: string) => ({
  href: `/shows/${showId}`,
  title: 'Score Classes',
  description: 'Enter placings for each class.',
  icon: '🏆',
});

type StaffUser = {
  id: string;
  full_name: string;
  email: string;
  role: string;
};

type ShowStaffData = {
  admins: StaffUser[];
  scorekeepers: StaffUser[];
  allUsers: StaffUser[];
};

async function getShowStaff(showId: string, headers: Record<string, string>, isAdmin: boolean) {
  const [adminsRes, keepersRes] = await Promise.all([
    fetch(`${API_URL}/shows/${showId}/admins`, { headers, cache: 'no-store' }),
    fetch(`${API_URL}/shows/${showId}/scorekeepers`, { headers, cache: 'no-store' }),
  ]);
  let allUsers: any[] = [];
  if (isAdmin) {
    const allUsersRes = await fetch(`${API_URL}/users/`, { headers, cache: 'no-store' });
    allUsers = allUsersRes.ok ? await allUsersRes.json() : [];
  }
  return {
    admins: adminsRes.ok ? await adminsRes.json() : [],
    scorekeepers: keepersRes.ok ? await keepersRes.json() : [],
    allUsers,
  };
}

export default async function AdminShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes] = await Promise.all([fetchShow(id), fetchClasses(id)]);
  const session = await auth();
  const user = session?.user as any;
  const isAdmin = user?.role === 'ADMIN';
  const isShowAdmin = user?.role === 'SHOW_SECRETARY';

  let staffData: ShowStaffData = { admins: [], scorekeepers: [], allUsers: [] };
  if ((isAdmin || isShowAdmin) && user?.id) {
    const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': INTERNAL_API_KEY,
      'X-User-Id': user.id,
      'X-User-Role': user.role,
    };
    staffData = await getShowStaff(id, headers, isAdmin);
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name },
        ]} />
        <div className="flex items-center gap-2 mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
          {show.show_type_code && (
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {show.show_type_code}
            </span>
          )}
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          📍 {show.venue} · 📅 {show.start_date} – {show.end_date}
        </p>
        <div className="mt-2">
          <ShowStatusControl
            showId={id}
            currentStatus={show.status}
            classCount={classes.length}
            endDate={show.end_date}
          />
        </div>
        {(isAdmin || isShowAdmin) && (
          <p className="text-sm mt-2" style={{ color: '#8b7355' }}>
            {staffData.scorekeepers.length > 0
              ? <>Scorekeepers: {(staffData.scorekeepers as any[]).map((s: any) => s.full_name).join(' · ')}</>
              : 'No scorekeepers assigned yet — add one below.'}
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {tiles(id).map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="block p-6 rounded-lg border transition-colors hover:bg-amber-50"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <div className="flex items-start gap-4">
              <div className="text-3xl" aria-hidden>{tile.icon}</div>
              <div>
                <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>
                  {tile.title}
                </h2>
                <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
                  {tile.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
        {show.status === 'ACTIVE' && (() => {
          const tile = scoringTile(id);
          return (
            <Link
              href={tile.href}
              className="block p-6 rounded-lg border transition-colors hover:opacity-90"
              style={{ borderColor: '#2c1810', backgroundColor: '#2c1810' }}
            >
              <div className="flex items-start gap-4">
                <div className="text-3xl" aria-hidden>{tile.icon}</div>
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: '#f5ede0' }}>
                    {tile.title}
                  </h2>
                  <p className="text-sm mt-1" style={{ color: '#d4b896' }}>
                    {tile.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })()}
      </div>

      {show.show_type_code === 'APHA' && (
        <div className="border rounded-lg p-4" style={{ borderColor: '#d4b896' }}>
          <h2 className="font-semibold mb-2" style={{ color: '#2c1810' }}>APHA Submission</h2>
          {show.apha_show_number ? (
            <div className="flex items-center gap-4">
              <span className="text-sm" style={{ color: '#8b7355' }}>
                Show #: <span className="font-mono font-medium" style={{ color: '#2c1810' }}>{show.apha_show_number}</span>
              </span>
              <a
                href={`/api/shows/${id}/apha-export`}
                download
                className="px-4 py-2 rounded text-sm font-medium"
                style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
              >
                Export APHA Results (CSV)
              </a>
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#8b7355' }}>
              Set the APHA Show Number in{' '}
              <a href={`/admin/shows/${id}/edit`} className="hover:underline" style={{ color: '#8b4513' }}>
                Edit Show Details
              </a>{' '}
              to enable export.
            </p>
          )}
        </div>
      )}

      {(isAdmin || isShowAdmin) && (
        <ShowStaffPanel
          showId={id}
          currentUserRole={user?.role ?? ''}
          initialAdmins={staffData.admins}
          initialScorekeepers={staffData.scorekeepers}
          allUsers={staffData.allUsers}
          isAdmin={isAdmin}
        />
      )}
    </main>
  );
}
