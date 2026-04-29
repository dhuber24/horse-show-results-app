import Link from 'next/link';
import {
  fetchShow,
  fetchClasses,
  fetchEntries,
  fetchHorses,
  fetchExhibitors,
} from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import CreateEntryForm from '../CreateEntryForm';
import EntryListSection from './EntryListSection';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function ShowEntriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const [show, classes, horses, exhibitors] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchHorses(headers || undefined),
    fetchExhibitors(headers || undefined),
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
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Entries' },
        ]} />
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>Entries</h1>
            <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{show.name}</p>
          </div>
          <Link
            href={`/admin/shows/${id}/back-numbers`}
            className="text-sm px-3 py-1.5 rounded border hover:bg-amber-50 transition-colors"
            style={{ borderColor: '#d4b896', color: '#8b4513' }}
          >
            Assign Back Numbers →
          </Link>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Entry</h2>
        <CreateEntryForm showId={id} classes={classes} horses={horses} exhibitors={exhibitors} isAphaShow={show.show_type_code === 'APHA'} />
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>Entries by Class</h2>
        <EntryListSection
          showId={id}
          entriesByClass={entriesByClass}
          isAphaShow={show.show_type_code === 'APHA'}
        />
      </section>
    </main>
  );
}
