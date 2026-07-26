import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fetchShow, fetchClasses } from '@/lib/api';
import GatePanel from './GatePanel';

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

  const [show, classes] = await Promise.all([fetchShow(showId), fetchClasses(showId)]);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div className="mt-2">
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
          Gate — {show.name}
        </h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          Pick a class to manage its order-of-go and send exhibitors into the ring.
        </p>
      </div>
      <GatePanel showId={showId} classes={classes} />
    </main>
  );
}
