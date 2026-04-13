import Link from 'next/link';
import { fetchClasses } from '@/lib/api';

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const classes = await fetchClasses(id);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <Link href="/" className="text-sm text-blue-500 hover:underline">← Back to Shows</Link>
      <h1 className="text-3xl font-bold my-6">Classes</h1>
      {classes.length === 0 ? (
        <p className="text-gray-500">No classes found.</p>
      ) : (
        <ul className="space-y-3">
          {classes.map((cls: any) => (
            <li key={cls.id}>
              <Link
                href={`/shows/${id}/classes/${cls.id}`}
                className="block p-4 border rounded-lg hover:bg-gray-50 transition"
              >
                <div className="font-semibold text-lg">{cls.class_number} — {cls.class_name}</div>
                <div className="text-sm text-gray-500">{cls.class_date} · <span className="uppercase">{cls.status}</span></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
