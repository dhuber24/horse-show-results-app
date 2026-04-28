import Link from 'next/link';
import { fetchBreeds, fetchHorseColors, fetchExhibitors, fetchShowTypes } from '@/lib/api';
import NewHorseForm from './NewHorseForm';

export default async function NewHorsePage() {
  const [breeds, colors, exhibitors, showTypes] = await Promise.all([
    fetchBreeds(),
    fetchHorseColors(),
    fetchExhibitors(),
    fetchShowTypes(),
  ]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/admin/horses" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Horses
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>New Horse</h1>
      </div>

      <NewHorseForm
        breeds={breeds}
        colors={colors}
        exhibitors={exhibitors}
        showTypes={showTypes}
      />
    </main>
  );
}
