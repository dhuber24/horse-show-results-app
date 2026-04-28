import Link from 'next/link';
import { fetchHorses } from '@/lib/api';
import HorseList from './HorseList';

export default async function AdminHorsesPage() {
  const horses = await fetchHorses();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href="/admin" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Admin
        </Link>
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
