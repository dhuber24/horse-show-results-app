import Link from 'next/link';
import { fetchBreed } from '@/lib/api';
import BreedForm from '../BreedForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function EditBreedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const breed = await fetchBreed(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Horses', href: '/admin/horses' },
          { label: 'Breeds', href: '/admin/horses/breeds' },
          { label: breed.name },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Edit Breed</h1>
      </div>
      <BreedForm breed={breed} />
    </main>
  );
}
