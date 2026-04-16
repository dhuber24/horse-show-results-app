import Link from 'next/link';
import { fetchExhibitor, fetchExhibitorHorses, fetchHorses } from '@/lib/api';
import { auth } from '@/auth';
import { notFound } from 'next/navigation';
import EditExhibitorForm from './EditExhibitorForm';
import AttachHorseForm from './AttachHorseForm';

export default async function AdminExhibitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== 'ADMIN') notFound();

  const [exhibitor, horses, allHorses] = await Promise.all([
    fetchExhibitor(id).catch(() => null),
    fetchExhibitorHorses(id).catch(() => []),
    fetchHorses().catch(() => []),
  ]);

  if (!exhibitor) notFound();

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Link href="/admin/exhibitors" className="text-sm hover:underline" style={{ color: '#8b4513' }}>
          ← Back to Exhibitors & Horses
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: '#2c1810' }}>
          {exhibitor.full_name}
        </h1>
        {exhibitor.user_id && (
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            Linked to a user account
          </p>
        )}
      </div>

      {/* Edit name */}
      <section>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>Exhibitor Name</h2>
        <EditExhibitorForm exhibitor={exhibitor} />
      </section>

      {/* Horses */}
      <section>
        <h2 className="text-base font-semibold mb-3" style={{ color: '#2c1810' }}>
          Horses
          <span className="ml-2 text-sm font-normal" style={{ color: '#8b7355' }}>
            ({horses.length})
          </span>
        </h2>

        <AttachHorseForm
          exhibitorId={id}
          allHorses={allHorses}
          attachedHorseIds={horses.map((h: any) => h.id)}
        />
      </section>

      {/* Exhibitor ID for reference */}
      <section className="pt-4 border-t" style={{ borderColor: '#d4b896' }}>
        <p className="text-xs" style={{ color: '#8b7355' }}>
          Exhibitor ID: <span className="font-mono">{exhibitor.id}</span>
        </p>
        {exhibitor.user_id && (
          <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
            User ID: <span className="font-mono">{exhibitor.user_id}</span>
          </p>
        )}
      </section>
    </main>
  );
}
