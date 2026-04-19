import Link from 'next/link';
import {
  fetchShow,
  fetchClasses,
  fetchEntries,
  fetchHorses,
  fetchExhibitors,
} from '@/lib/api';
import CreateEntryForm from '../CreateEntryForm';

export default async function ShowEntriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, horses, exhibitors] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchHorses(),
    fetchExhibitors(),
  ]);

  const entriesByClass = await Promise.all(
    classes.map(async (cls: any) => ({
      cls,
      entries: await fetchEntries(id, cls.id).catch(() => []),
    }))
  );

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href={`/admin/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Show
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Entries</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{show.name}</p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Entry</h2>
        <CreateEntryForm showId={id} classes={classes} horses={horses} exhibitors={exhibitors} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Entries by Class</h2>
        {entriesByClass.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No classes yet. Add a class first.</p>
        ) : (
          entriesByClass.map(({ cls, entries }) => (
            <div
              key={cls.id}
              className="p-4 rounded-lg border"
              style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold" style={{ color: '#2c1810' }}>
                  {cls.name}
                  <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
                    ({entries.length})
                  </span>
                </div>
              </div>
              {entries.length === 0 ? (
                <p className="text-sm" style={{ color: '#8b7355' }}>No entries yet.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {entries.map((entry: any) => (
                    <li key={entry.id} style={{ color: '#2c1810' }}>
                      {entry.back_number != null && (
                        <span className="font-mono mr-2" style={{ color: '#8b4513' }}>
                          #{entry.back_number}
                        </span>
                      )}
                      {entry.horse_name ?? entry.horse?.name ?? 'Horse'}
                      <span style={{ color: '#8b7355' }}> — </span>
                      {entry.exhibitor_name ?? entry.exhibitor?.full_name ?? 'Exhibitor'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </section>
    </main>
  );
}
