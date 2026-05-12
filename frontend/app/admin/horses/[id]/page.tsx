import Link from 'next/link';
import { fetchHorse, fetchBreeds, fetchHorseColors, fetchShowTypes, fetchHorseRegistrations, fetchExhibitors, fetchTrainers } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import EditHorseForm from './EditHorseForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function AdminHorsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [horse, breeds, colors, exhibitors, showTypes, registrations, trainers] = await Promise.all([
    fetchHorse(id, headers || undefined),
    fetchBreeds(),
    fetchHorseColors(),
    fetchExhibitors(headers || undefined),
    fetchShowTypes(),
    fetchHorseRegistrations(id),
    fetchTrainers(headers || undefined),
  ]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Horses', href: '/admin/horses' },
          { label: horse.name },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          {horse.name}
        </h1>
      </div>

      <EditHorseForm
        horse={horse}
        breeds={breeds}
        colors={colors}
        exhibitors={exhibitors}
        showTypes={showTypes}
        registrations={registrations}
        trainers={trainers}
      />
    </main>
  );
}
