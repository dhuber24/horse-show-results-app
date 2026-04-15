import Link from 'next/link';
import { fetchVenue } from '@/lib/api';
import EditVenueForm from './EditVenueForm';

export default async function AdminVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const venue = await fetchVenue(id);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Edit Venue</h1>
        <Link href="/admin" className="text-sm text-blue-500 hover:underline">← Back to Admin</Link>
      </div>

      <EditVenueForm venue={venue} />
    </main>
  );
}
