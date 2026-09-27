import { fetchShow, fetchClasses, fetchShowPatterns } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import PatternsClient, { type PickerClass } from './PatternsClient';

/**
 * The show's patterns — added by the office, and optionally attached to the
 * classes that run them (migration 146). Exhibitors read them on the show's
 * public Patterns page and beside each class on the schedule.
 */
export default async function ShowPatternsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, patterns] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchShowPatterns(id),
  ]);

  const pickerClasses: PickerClass[] = classes.map((c: PickerClass) => ({
    id: c.id,
    class_number: c.class_number,
    class_name: c.class_name,
    class_date: c.class_date,
    discipline_name: c.discipline_name ?? null,
    score_type: c.score_type,
  }));

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name, href: `/admin/shows/${id}` },
          { label: 'Patterns' },
        ]} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--foreground)' }}>Patterns</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{show.name}</p>
      </div>

      <div
        className="rounded border px-4 py-3 text-sm"
        style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)', color: 'var(--text-deep)' }}
      >
        Add class patterns here. Once added to this section, they will be available to
        exhibitors to view/download. Attaching the patterns to their respective classes can be
        done below.
      </div>

      <PatternsClient showId={id} classes={pickerClasses} initialPatterns={patterns} />
    </main>
  );
}
