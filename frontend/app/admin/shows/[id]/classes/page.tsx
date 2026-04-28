import Link from 'next/link';
import { fetchShow, fetchClasses } from '@/lib/api';
import CreateClassForm from '../CreateClassForm';
import EditClassCard from '../EditClassCard';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function ShowClassesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes] = await Promise.all([fetchShow(id), fetchClasses(id)]);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Classes' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>Classes</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>{show.name}</p>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Add Class</h2>
        <CreateClassForm showId={id} showStartDate={show.start_date} showEndDate={show.end_date} isAphaShow={show.show_type_code === 'APHA'} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>
          All Classes
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({classes.length})
          </span>
        </h2>
        {classes.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No classes yet.</p>
        ) : (
          <ul className="space-y-2">
            {classes.map((cls: any) => (
              <EditClassCard
                key={cls.id}
                cls={cls}
                showId={id}
                showStartDate={show.start_date}
                showEndDate={show.end_date}
                isAphaShow={show.show_type_code === 'APHA'}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
