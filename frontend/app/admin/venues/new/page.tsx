import CreateVenueForm from '../../CreateVenueForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default function NewVenuePage() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Venues', href: '/admin/venues' },
          { label: 'New Venue' },
        ]} />
        <h1 className="text-3xl font-bold mt-2" style={{ color: '#2c1810' }}>Add New Venue</h1>
      </div>

      <CreateVenueForm />
    </main>
  );
}
