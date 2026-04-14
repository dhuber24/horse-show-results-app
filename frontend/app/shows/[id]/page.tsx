import Link from 'next/link';
import { fetchShow, fetchClasses } from '@/lib/api';

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes] = await Promise.all([fetchShow(id), fetchClasses(id)]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: '#8b4513' }}>← Back to Shows</Link>
      <div className="mt-4 mb-6 pb-4 border-b" style={{ borderColor: '#d4b896' }}>
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          📍 {show.venue} &nbsp;·&nbsp; 📅 {show.start_date} – {show.end_date}
        </p>
      </div>

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Classes</h2>
      {classes.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No classes found.</p>
      ) : (
        <ul className="space-y-3">
          {classes.map((cls: any) => (
            <li key={cls.id}>
              <Link href={`/shows/${id}/classes/${cls.id}`}
                className="block p-4 rounded-lg border transition hover:shadow-md"
                style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold" style={{ color: '#2c1810' }}>
                      {cls.class_number} — {cls.class_name}
                    </div>
                    <div className="text-sm mt-1" style={{ color: '#8b7355' }}>📅 {cls.class_date}</div>
                  </div>
                  <span className="text-xs font-medium px-2 py-1 rounded-full"
                    style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}>
                    {cls.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
