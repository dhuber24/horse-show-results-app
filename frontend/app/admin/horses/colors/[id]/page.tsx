import Link from 'next/link';
import { fetchHorseColor } from '@/lib/api';
import HorseColorForm from '../HorseColorForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function EditHorseColorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const color = await fetchHorseColor(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Horses', href: '/admin/horses' },
          { label: 'Colors', href: '/admin/horses/colors' },
          { label: color.name },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Edit Color</h1>
      </div>
      <HorseColorForm color={color} />
    </main>
  );
}
