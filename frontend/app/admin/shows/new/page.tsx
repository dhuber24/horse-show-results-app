import { fetchVenues, fetchShowTypes } from '@/lib/api';
import CreateShowForm from '../../CreateShowForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function NewShowPage() {
  const [venues, showTypes] = await Promise.all([fetchVenues(), fetchShowTypes()]);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: 'New Show' },
        ]} />
        <h1 className="text-3xl font-bold mt-2" style={{ color: '#2c1810' }}>Create New Show</h1>
      </div>

      <CreateShowForm venues={venues} showTypes={showTypes} />
    </main>
  );
}
