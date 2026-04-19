import Link from 'next/link';
import { fetchHorse } from '@/lib/api';
import EditHorseForm from './EditHorseForm';

export default async function AdminHorsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const horse = await fetchHorse(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/admin/horses" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Horses
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          Edit Horse
        </h1>
      </div>

      <EditHorseForm horse={horse} />
    </main>
  );
}
