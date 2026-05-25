import { redirect } from 'next/navigation';
import { fetchShow, fetchClasses, fetchShowTypes, fetchRings, fetchDivisions, fetchSections } from '@/lib/api';
import CreateClassForm from '../CreateClassForm';
import ClassListWithReorder from '../ClassListWithReorder';
import APHAClassPicker from '../APHAClassPicker';
import AQHAClassPicker from '../AQHAClassPicker';
import ScheduleBuilder from '../ScheduleBuilder';
import StandardLibraryClassPicker from '../StandardLibraryClassPicker';
import Breadcrumbs from '@/components/Breadcrumbs';

export default async function ShowClassesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, showTypes, rings, divisions, sections] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchShowTypes(),
    fetchRings(id),
    fetchDivisions(id),
    fetchSections(id),
  ]);

  // OPEN shows can use the Standard Library picker which auto-creates divisions/sections,
  // so skip the setup redirect for them even if rings/divisions are not yet configured.
  if (show.show_type_code !== 'OPEN' && (rings.length === 0 || divisions.length === 0)) {
    const missing: string[] = [];
    if (rings.length === 0) missing.push('rings');
    if (divisions.length === 0) missing.push('divisions');
    redirect(`/admin/shows/${id}/setup?missing=${missing.join(',')}`);
  }

  const isApha = show.show_type_code === 'APHA';
  const isAqha = show.show_type_code === 'AQHA';

  // Only expose show types that are relevant to this show (primary + affiliations)
  const validShowTypeIds = new Set([
    show.show_type_id,
    ...(show.affiliations ?? []).map((a: any) => a.show_type_id),
  ]);
  const relevantShowTypes = showTypes.filter((st: any) => validShowTypeIds.has(st.id));

  const existingAphaCodes = isApha
    ? classes.flatMap((c: any) =>
        (c.associations ?? [])
          .filter((a: any) => a.show_type_code === 'APHA')
          .map((a: any) => a.association_class_code)
      )
    : [];

  const existingAqhaCodes = isAqha
    ? classes.flatMap((c: any) =>
        (c.associations ?? [])
          .filter((a: any) => a.show_type_code === 'AQHA')
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

      <div className="flex flex-wrap gap-2">
        <CreateClassForm
          showId={id}
          showStartDate={show.start_date}
          showEndDate={show.end_date}
          rings={rings}
          divisions={divisions}
          sections={sections}
        />
        <ScheduleBuilder
          showId={id}
          showStartDate={show.start_date}
          showEndDate={show.end_date}
          rings={rings}
          divisions={divisions}
          sections={sections}
        />
        <StandardLibraryClassPicker
          showId={id}
          showTypeId={show.show_type_id}
          showStartDate={show.start_date}
          showEndDate={show.end_date}
          rings={rings}
        />
        {isApha && (
          <APHAClassPicker showId={id} showStartDate={show.start_date} showEndDate={show.end_date} existingAphaCodes={existingAphaCodes} />
        )}
        {isAqha && (
          <AQHAClassPicker showId={id} showStartDate={show.start_date} showEndDate={show.end_date} existingAqhaCodes={existingAqhaCodes} />
        )}
      </div>

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
            showTypes={relevantShowTypes}
            rings={rings}
            divisions={divisions}
            sections={sections}
          />
        )}
      </section>
    </main>
  );
}
