import Link from 'next/link';
import { fetchVenues } from '@/lib/api';
import CreateShowForm from '../../CreateShowForm';

export default async function NewShowPage() {
  const venues = await fetchVenues();

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Create New Show</h1>
        <Link href="/admin" className="text-sm text-blue-500 hover:underline">← Back to Admin</Link>
      </div>

      <CreateShowForm venues={venues} />
    </main>
  );
}
