import { fetchShow, fetchClasses, fetchEntries, fetchExhibitor, fetchHorse } from '@/lib/api';
import BackNumberForm from './BackNumberForm';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function BackNumbersPage({ params }: { params: Promise<{ id: string; classId: string }> }) {
  const { id, classId } = await params;
  const apiHeaders = { 'X-API-Key': process.env.INTERNAL_API_KEY || '' };
  const [show, classes, entries] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchEntries(id, classId),
  ]);

  const cls = classes.find((c: any) => c.id === classId);

  const enriched = await Promise.all(
    entries.map(async (entry: any) => {
      const [exhibitor, horse] = await Promise.all([
        fetchExhibitor(entry.exhibitor_id, apiHeaders),
        fetchHorse(entry.horse_id, apiHeaders),
      ]);
      return { ...entry, exhibitorName: exhibitor.full_name, horseName: horse.name };
    })
  );

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <div className="mb-6">
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Back Numbers' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
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
