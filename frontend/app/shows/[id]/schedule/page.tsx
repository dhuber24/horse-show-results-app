import { fetchShow, fetchClasses, fetchProgramIndex } from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';
import ScheduleBoard, { type ScheduleClass, type ProgramEntry } from './ScheduleBoard';

export default async function ShowSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, programIndex] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchProgramIndex(id),
  ]);
  const visible: ScheduleClass[] = classes.filter((c: ScheduleClass) => c.status !== 'DRAFT');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={`/shows/${id}/live`} backLabel="Back to Show Menu" />

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Class Schedule</h2>

      {visible.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No classes have been posted yet.</p>
      ) : (
        <ScheduleBoard
          showId={id}
          showStatus={show.status}
          classes={visible}
          programIndex={programIndex as Record<string, ProgramEntry[]>}
        />
      )}
    </main>
  );
}
