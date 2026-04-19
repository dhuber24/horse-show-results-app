import Link from 'next/link';
import { fetchVenues, fetchShowTypes } from '@/lib/api';
import CreateShowForm from '../../CreateShowForm';

export default async function NewShowPage() {
  const [venues, showTypes] = await Promise.all([fetchVenues(), fetchShowTypes()]);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold" style={{ color: '#2c1810' }}>Create New Show</h1>
        <Link href="/admin/shows" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Shows
        </Link>
      </div>

      <CreateShowForm venues={venues} showTypes={showTypes} />
    </main>
  );
}
