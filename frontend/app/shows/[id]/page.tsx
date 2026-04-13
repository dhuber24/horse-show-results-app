import Link from 'next/link';
import { fetchShow, fetchClasses } from '@/lib/api';

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
  ]);

  return (
    <main className="max-w-3xl mx-auto p-6">
      <Link href="/" className="text-sm text-blue-500 hover:underline">← Back to Shows</Link>
      <h1 className="text-3xl font-bold mt-4">{show.name}</h1>
      <p className="text-gray-500 mb-6">{show.venue} · {show.start_date} – {show.end_date}</p>

      <h2 className="text-xl font-semibold mb-3">Classes</h2>
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
