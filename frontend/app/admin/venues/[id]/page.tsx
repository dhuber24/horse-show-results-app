import { auth } from '@/auth';
import { fetchVenue } from '@/lib/api';
import EditVenueForm from './EditVenueForm';
import Breadcrumbs from '@/components/Breadcrumbs';

// No list of secretaries here. There was one, "Show Secretaries for this
// Venue", and nothing ever read it: a secretary works a show because they are
// on that show (`show_secretaries`) or on its show company (`show_access.py`),
// never because of where it is held.
export default async function AdminVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venue = await fetchVenue(id);
  const session = await auth();
  const user = session?.user as any;
  const isAdmin = user?.role === 'ADMIN';
  const isCreator =
    user?.role === 'SHOW_MANAGER' && !!user?.id && venue.created_by_user_id === user.id;
  const canEdit = isAdmin || isCreator;

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Venues', href: '/admin/venues' },
          { label: venue.name },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>
          {canEdit ? 'Edit Venue' : 'Venue Details'}
        </h1>
      </div>

      <div className="p-5 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        {canEdit ? (
          <EditVenueForm venue={venue} />
        ) : (
          <dl className="space-y-2 text-sm">
            <div><dt className="font-semibold inline" style={{ color: 'var(--foreground)' }}>Name: </dt><dd className="inline" style={{ color: 'var(--text-deep)' }}>{venue.name}</dd></div>
            <div><dt className="font-semibold inline" style={{ color: 'var(--foreground)' }}>Address: </dt><dd className="inline" style={{ color: 'var(--text-deep)' }}>{venue.address || '—'}</dd></div>
            <div><dt className="font-semibold inline" style={{ color: 'var(--foreground)' }}>City: </dt><dd className="inline" style={{ color: 'var(--text-deep)' }}>{venue.city || '—'}</dd></div>
            <div><dt className="font-semibold inline" style={{ color: 'var(--foreground)' }}>State: </dt><dd className="inline" style={{ color: 'var(--text-deep)' }}>{venue.state || '—'}</dd></div>
            <div><dt className="font-semibold inline" style={{ color: 'var(--foreground)' }}>Zip: </dt><dd className="inline" style={{ color: 'var(--text-deep)' }}>{venue.zip || '—'}</dd></div>
          </dl>
        )}
      </div>
    </main>
  );
}
