import Breadcrumbs from '@/components/Breadcrumbs';
import { fetchTrainers } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import TrainersManager from './trainers-manager';

export default async function AdminTrainersPage() {
  const headers = await getAuthHeaders();
  const trainers = await fetchTrainers(headers || undefined);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Trainers' }]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Trainers</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Manage trainer registry entries for horse profiles.
        </p>
      </div>
      <TrainersManager initialTrainers={trainers} />
    </main>
  );
}
