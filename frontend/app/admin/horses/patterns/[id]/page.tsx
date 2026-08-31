import Link from 'next/link';
import { fetchHorsePattern } from '@/lib/api';
import HorsePatternForm from '../HorsePatternForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function EditHorsePatternPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pattern = await fetchHorsePattern(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Horses', href: '/admin/horses' },
          { label: 'Patterns', href: '/admin/horses/patterns' },
          { label: pattern.name },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Edit Pattern</h1>
      </div>
      <HorsePatternForm pattern={pattern} />
    </main>
  );
}
