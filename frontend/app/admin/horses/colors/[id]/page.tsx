import Link from 'next/link';
import { fetchHorseColor } from '@/lib/api';
import HorseColorForm from '../HorseColorForm';

export default async function EditHorseColorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const color = await fetchHorseColor(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/admin/horses/colors" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Horse Colors
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Edit Color</h1>
      </div>
      <HorseColorForm color={color} />
    </main>
  );
}
