import Link from 'next/link';
import { fetchHorses } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import HorseList from './HorseList';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function AdminHorsesPage() {
  const headers = await getAuthHeaders();
  const horses = await fetchHorses(headers || undefined);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Horses' },
        ]} />
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Horses</h1>
          <div className="flex gap-3">
            <Link
              href="/admin/horses/breeds"
              className="text-sm px-3 py-1.5 rounded border font-medium"
              style={{ borderColor: '#d4b896', color: '#8b4513' }}
            >
              Manage Breeds
            </Link>
            <Link
              href="/admin/horses/colors"
              className="text-sm px-3 py-1.5 rounded border font-medium"
              style={{ borderColor: '#d4b896', color: '#8b4513' }}
            >
              Manage Colors
            </Link>
            <Link
              href="/admin/trainers"
              className="text-sm px-3 py-1.5 rounded border font-medium"
              style={{ borderColor: '#d4b896', color: '#8b4513' }}
            >
              Manage Trainers
            </Link>
            <Link
              href="/admin/horses/new"
              className="text-sm px-3 py-1.5 rounded font-medium"
              style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
            >
              + New Horse
            </Link>
          </div>
        </div>
      </div>

      <HorseList horses={horses} />
    </main>
  );
}
