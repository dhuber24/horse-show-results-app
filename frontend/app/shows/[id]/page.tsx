import Link from 'next/link';
import { fetchShow, fetchClasses } from '@/lib/api';
import { auth } from '@/auth';

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  const canScore = (role === 'ADMIN' || role === 'SCOREKEEPER');

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

      {show.status !== 'ACTIVE' && (
        <div
          className="mb-4 px-4 py-3 rounded border text-sm font-medium"
          style={{ backgroundColor: '#fef3c7', borderColor: '#d4b896', color: '#92400e' }}
        >
          Read-only — results can only be entered when the show is Active.
          Current status: <strong>{show.status}</strong>.
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Classes</h2>
      {classes.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No classes found.</p>
      ) : (
        <ul className="space-y-3">
          {classes.map((cls: any) => (
            <li key={cls.id}>
              <div
                className="flex items-stretch rounded-lg border overflow-hidden"
                style={{ borderColor: '#d4b896' }}
              >
                <Link
                  href={`/shows/${id}/classes/${cls.id}`}
                  className="flex-1 p-4 transition hover:bg-amber-50"
                  style={{ backgroundColor: '#ffffff' }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold" style={{ color: '#2c1810' }}>
                        {cls.class_number} — {cls.class_name}
                      </div>
                      <div className="text-sm mt-1" style={{ color: '#8b7355' }}>📅 {cls.class_date}</div>
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      {canScore && (
                        cls.placed_count > 0 ? (
                          <span
                            className="text-xs font-medium px-2 py-1 rounded-full"
                            style={{ backgroundColor: '#d1fae5', color: '#065f46' }}
                          >
                            {cls.placed_count} placed
                          </span>
                        ) : (
                          <span
                            className="text-xs font-medium px-2 py-1 rounded-full"
                            style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                          >
                            Pending
                          </span>
                        )
                      )}
                      <span
                        className="text-xs font-medium px-2 py-1 rounded-full"
                        style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}
                      >
                        {cls.status}
                      </span>
                    </div>
                  </div>
                </Link>
                {canScore && show.status === 'ACTIVE' && (
                  <Link
                    href={`/shows/${id}/classes/${cls.id}/scorekeeper`}
                    className="flex items-center px-4 text-sm font-medium border-l transition hover:opacity-80"
                    style={{ backgroundColor: '#2c1810', color: '#f5ede0', borderColor: '#3d2010' }}
                  >
                    Score
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
