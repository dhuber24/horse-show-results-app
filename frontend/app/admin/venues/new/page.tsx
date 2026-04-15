import Link from 'next/link';
import CreateVenueForm from '../../CreateVenueForm';

export default function NewVenuePage() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Add New Venue</h1>
        <Link href="/admin" className="text-sm text-blue-500 hover:underline">← Back to Admin</Link>
      </div>

      <CreateVenueForm />
    </main>
  );
}
