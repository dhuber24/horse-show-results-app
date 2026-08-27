import { notFound } from 'next/navigation';
import { fetchShow, fetchClasses } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadFuturity } from '../../loadFuturity';
import { BackToFuturity, COLORS, futurityCrumbs } from '../../futurity-shared';
import FuturitySettingsForm from './FuturitySettingsForm';

export default async function FuturitySettingsPage({
  params,
}: {
  params: Promise<{ id: string; futurityId: string }>;
}) {
  const { id, futurityId } = await params;
  const [show, classes, futurity] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    loadFuturity(id, futurityId),
  ]);
  if (!futurity) notFound();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={futurityCrumbs(id, show.name, futurity, 'Settings')} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
          {futurity.name} — everything the entry form states, from the deadline to
          the release.
        </p>
      </div>

      <FuturitySettingsForm showId={id} futurity={futurity} classes={classes} />

      <BackToFuturity showId={id} futurity={futurity} />
    </main>
  );
}
