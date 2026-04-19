import Link from 'next/link';
import ShowTypeForm from '../ShowTypeForm';

export default function NewShowTypePage() {
  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Link href="/admin/shows/types" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Show Types
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Add Show Type</h1>
      </div>
      <ShowTypeForm />
    </main>
  );
}
