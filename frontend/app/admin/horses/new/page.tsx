import { fetchBreeds, fetchHorseColors, fetchExhibitors, fetchAssociations, fetchTrainers } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import NewHorseForm from './NewHorseForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function NewHorsePage() {
  const headers = await getAuthHeaders();
  const [breeds, colors, exhibitors, associations, trainers] = await Promise.all([
    fetchBreeds(),
    fetchHorseColors(),
    fetchExhibitors(headers || undefined),
    fetchAssociations(headers || undefined),
    fetchTrainers(headers || undefined),
  ]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Horses', href: '/admin/horses' },
          { label: 'New Horse' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>New Horse</h1>
      </div>

      <NewHorseForm
        breeds={breeds}
        colors={colors}
        exhibitors={exhibitors}
        associations={associations}
        trainers={trainers}
      />
    </main>
  );
}
