import Link from 'next/link';
import { fetchShowType } from '@/lib/api';
import ShowTypeForm from '../ShowTypeForm';

export default async function EditShowTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showType = await fetchShowType(id);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/admin/shows/types" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Show Types
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Edit Show Type</h1>
      </div>
      <ShowTypeForm showType={showType} />
    </main>
  );
}
