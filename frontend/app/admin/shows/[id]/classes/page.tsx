import { fetchShow, fetchClasses, fetchShowTypes, fetchRings, fetchDivisions } from '@/lib/api';
import CreateClassForm from '../CreateClassForm';
import ClassListWithReorder from '../ClassListWithReorder';
import APHAClassPicker from '../APHAClassPicker';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function ShowClassesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, showTypes, rings, divisions] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchShowTypes(),
    fetchRings(id),
    fetchDivisions(id),
  ]);

  const isApha = show.show_type_code === 'APHA';
  const existingAphaCodes = isApha
    ? classes.flatMap((c: any) =>
        (c.associations ?? [])
          .filter((a: any) => a.show_type_code === 'APHA')
          .map((a: any) => a.association_class_code)
      )
    : [];

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
        <div className="space-y-3">
          <CreateClassForm showId={id} showStartDate={show.start_date} showEndDate={show.end_date} rings={rings} divisions={divisions} />
          {isApha && (
            <APHAClassPicker showId={id} showStartDate={show.start_date} showEndDate={show.end_date} existingAphaCodes={existingAphaCodes} />
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>
          Show Schedule
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({classes.length})
          </span>
        </h2>
        {classes.length === 0 ? (
          <p style={{ color: '#8b7355' }}>No classes yet.</p>
        ) : (
          <ClassListWithReorder
            key={classes.map((c: any) => c.id).join(',')}
            initialClasses={classes}
            showId={id}
            showStartDate={show.start_date}
            showEndDate={show.end_date}
            showTypes={showTypes}
            rings={rings}
            divisions={divisions}
          />
        )}
      </section>
    </main>
  );
}
