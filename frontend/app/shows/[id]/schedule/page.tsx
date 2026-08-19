import { auth } from '@/auth';
import { fetchShow, fetchClasses, fetchProgramIndex } from '@/lib/api';
import { getAuthHeaders, API_URL } from '@/lib/backend-fetch';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';
import ScheduleBoard, { type ScheduleClass, type ProgramEntry } from './ScheduleBoard';

/**
 * The classes the signed-in exhibitor is entered in at this show.
 *
 * Read from the dashboard endpoint, which is already the exhibitor's own
 * entry list — the schedule is a public spectator page and must keep working
 * for everyone else, so a failure here degrades to "no registered filter"
 * rather than breaking the page.
 */
async function fetchRegisteredClassIds(showId: string, userId: string): Promise<string[]> {
  try {
    const headers = await getAuthHeaders();
    if (!headers) return [];
    const res = await fetch(`${API_URL}/dashboard/exhibitor/${userId}`, {
      headers,
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.entries ?? [])
      .filter((e: { show_id: string }) => e.show_id === showId)
      .map((e: { class_id: string }) => e.class_id);
  } catch {
    return [];
  }
}

export default async function ShowSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const isExhibitor = (session?.user as { role?: string } | undefined)?.role === 'EXHIBITOR';

  const [show, classes, programIndex, registeredClassIds, back] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchProgramIndex(id),
    isExhibitor
      ? fetchRegisteredClassIds(id, (session!.user as { id: string }).id)
      : Promise.resolve([]),
    showHubBack(id),
  ]);
  const visible: ScheduleClass[] = classes.filter((c: ScheduleClass) => c.status !== 'DRAFT');

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Class Schedule</h2>

      {visible.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No classes have been posted yet.</p>
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
    </main>
  );
}
