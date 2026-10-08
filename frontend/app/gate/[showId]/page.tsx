import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchShow } from '@/lib/api';
import { getAuthHeaders, API_URL, readJsonBody } from '@/lib/backend-fetch';
import GatePanel, { type GateClassRow } from './GatePanel';

export default async function GateShowPage({
  params,
}: {
  params: Promise<{ showId: string }>;
}) {
  const { showId } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!session || !['GATE_STEWARD', 'ADMIN', 'SHOW_MANAGER', 'SHOW_SECRETARY'].includes(role)) {
    redirect('/');
  }

  // The gate's own class list, not the public one: ready is derived from the
  // riders and is not on the stored row, and the check-in counts come with it.
  const headers = await getAuthHeaders();
  const [show, classesRes] = await Promise.all([
    fetchShow(showId),
    fetch(`${API_URL}/shows/${showId}/gate/classes`, { headers: headers ?? {}, cache: 'no-store' }),
  ]);
  const classesBody = await readJsonBody(classesRes);
  const classes: GateClassRow[] | null = classesRes.ok && Array.isArray(classesBody) ? classesBody : null;

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div className="mt-2">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
          Gate — {show.name}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Check riders in for any class still to run, and start each class as it goes in.
        </p>
      </div>
      {classes ? (
        <GatePanel showId={showId} classes={classes} />
      ) : (
        <p className="text-sm" style={{ color: 'var(--error-strong)' }}>
          {classesRes.status === 403
            ? "You aren't on the gate for this show. Ask the show office to add you."
            : 'The classes could not be loaded. Refresh to try again.'}
        </p>
      )}
    </main>
  );
}
