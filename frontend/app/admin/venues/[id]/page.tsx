import Link from 'next/link';
import { auth } from '@/auth';
import { fetchVenue } from '@/lib/api';
import { API_URL } from '@/lib/backend-fetch';
import EditVenueForm from './EditVenueForm';
import VenueAdminPanel from './VenueAdminPanel';
import Breadcrumbs from '@/components/Breadcrumbs';

async function getVenueAdmins(venueId: string, headers: Record<string, string>) {
  const [adminsRes, allUsersRes] = await Promise.all([
    fetch(`${API_URL}/venues/${venueId}/admins`, { headers, cache: 'no-store' }),
    fetch(`${API_URL}/users/`, { headers, cache: 'no-store' }),
  ]);
  return {
    admins: adminsRes.ok ? await adminsRes.json() : [],
    allUsers: allUsersRes.ok ? await allUsersRes.json() : [],
  };
}

export default async function AdminVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venue = await fetchVenue(id);
  const session = await auth();
  const user = session?.user as any;
  const isAdmin = user?.role === 'ADMIN';
  const isCreator =
    user?.role === 'SHOW_MANAGER' && !!user?.id && venue.created_by_user_id === user.id;
  const canEdit = isAdmin || isCreator;

  let panelData = { admins: [], allUsers: [] };
  if (isAdmin && user?.id) {
    const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': INTERNAL_API_KEY,
      'X-User-Id': user.id,
      'X-User-Role': user.role,
    };
    panelData = await getVenueAdmins(id, headers);
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Venues', href: '/admin/venues' },
          { label: venue.name },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          {canEdit ? 'Edit Venue' : 'Venue Details'}
        </h1>
      </div>

      <div className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
        {canEdit ? (
          <EditVenueForm venue={venue} />
        ) : (
          <dl className="space-y-2 text-sm">
            <div><dt className="font-semibold inline" style={{ color: '#2c1810' }}>Name: </dt><dd className="inline" style={{ color: '#5c3d1e' }}>{venue.name}</dd></div>
            <div><dt className="font-semibold inline" style={{ color: '#2c1810' }}>Address: </dt><dd className="inline" style={{ color: '#5c3d1e' }}>{venue.address || '—'}</dd></div>
            <div><dt className="font-semibold inline" style={{ color: '#2c1810' }}>City: </dt><dd className="inline" style={{ color: '#5c3d1e' }}>{venue.city || '—'}</dd></div>
            <div><dt className="font-semibold inline" style={{ color: '#2c1810' }}>State: </dt><dd className="inline" style={{ color: '#5c3d1e' }}>{venue.state || '—'}</dd></div>
          </dl>
        )}
      </div>

      {isAdmin && (
        <div className="p-5 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#fff' }}>
          <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Show Secretaries for this Venue</h2>
          <VenueAdminPanel
            venueId={id}
            initialAdmins={panelData.admins}
            allUsers={panelData.allUsers}
          />
        </div>
      )}
    </main>
  );
}
