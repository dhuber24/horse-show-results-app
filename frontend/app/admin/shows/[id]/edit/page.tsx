import Link from 'next/link';
import { fetchShow, fetchVenues, fetchShowTypes } from '@/lib/api';
import EditShowForm from '../EditShowForm';

export default async function EditShowDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, venues, showTypes] = await Promise.all([fetchShow(id), fetchVenues(), fetchShowTypes()]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href={`/admin/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Show
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Edit Show Details</h1>
      </div>

      <EditShowForm show={show} venues={venues} showTypes={showTypes} />
    </main>
  );
}
