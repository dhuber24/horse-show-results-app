import Link from 'next/link';
import { auth } from '@/auth';
import { canActAsExhibitor } from '@/lib/exhibitor-access';
import { fetchShow, fetchClasses, fetchProgramIndex } from '@/lib/api';
import { fetchRegisteredClassIds } from '@/lib/my-class-ids';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';
import BackToShow from '../_components/BackToShow';
import ScheduleBoard, { type ScheduleClass, type ProgramEntry } from './ScheduleBoard';

export default async function ShowSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const isExhibitor = session ? await canActAsExhibitor() : false;

  const back = showHubBack(id);
  const [show, classes, programIndex, registeredClassIds] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchProgramIndex(id),
    isExhibitor
      ? fetchRegisteredClassIds(id, (session!.user as { id: string }).id)
      : Promise.resolve([]),
  ]);
  const visible: ScheduleClass[] = classes.filter((c: ScheduleClass) => c.status !== 'DRAFT');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />

      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Class Schedule</h2>
        {visible.some((c) => c.pattern_id) && (
          <Link href={`/shows/${id}/patterns`} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
            All patterns →
          </Link>
        )}
      </div>

      {visible.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No classes have been posted yet.</p>
      ) : (
        <ScheduleBoard
          showId={id}
          showStatus={show.status}
          classes={visible}
          programIndex={programIndex as Record<string, ProgramEntry[]>}
          isExhibitor={isExhibitor}
          registeredClassIds={registeredClassIds}
        />
      )}

      <BackToShow showId={id} />
    </main>
  );
}
