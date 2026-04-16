import { fetchShow, fetchClasses, fetchEntries, fetchExhibitor, fetchHorse } from '@/lib/api';
import BackNumberForm from './BackNumberForm';
import Link from 'next/link';

export default async function BackNumbersPage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  const [show, classes, entries] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchEntries(id, classId),
  ]);

  const cls = classes.find((c: any) => c.id === classId);

  const enriched = await Promise.all(
    entries.map(async (entry: any) => {
      const [exhibitor, horse] = await Promise.all([
        fetchExhibitor(entry.exhibitor_id),
        fetchHorse(entry.horse_id),
      ]);
      return { ...entry, exhibitorName: exhibitor.full_name, horseName: horse.name };
    })
  );

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href={`/admin/shows/${id}`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
        ← Back to {show.name}
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
          Back Numbers
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          {cls?.class_number} — {cls?.class_name}
        </p>
      </div>
      <BackNumberForm showId={id} classId={classId} entries={enriched} />
    </main>
  );
}
