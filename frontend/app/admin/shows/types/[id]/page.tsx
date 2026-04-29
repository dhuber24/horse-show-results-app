import { fetchShowType } from '@/lib/api';
import ShowTypeForm from '../ShowTypeForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function EditShowTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showType = await fetchShowType(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: 'Show Types', href: '/admin/shows/types' },
          { label: showType?.name ?? 'Edit Show Type' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Edit Show Type</h1>
      </div>
      <ShowTypeForm showType={showType} />
    </main>
  );
}
