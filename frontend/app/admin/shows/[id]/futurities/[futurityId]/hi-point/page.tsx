import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadFuturity } from '../../loadFuturity';
import { BackToFuturity, COLORS, futurityCrumbs } from '../../futurity-shared';
import HiPointEditor from './HiPointEditor';

export default async function HiPointPage({
  params,
}: {
  params: Promise<{ id: string; futurityId: string }>;
}) {
  const { id, futurityId } = await params;
  const [show, futurity] = await Promise.all([fetchShow(id), loadFuturity(id, futurityId)]);
  if (!futurity) notFound();

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={futurityCrumbs(id, show.name, futurity, 'Hi-Point')} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
          Hi-Point divisions
        </h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
          {futurity.name} — an award bracket scored over some of the futurity&rsquo;s
          classes. A class either <strong>always counts</strong>, or competes with
          others in a named group for a single slot, so &ldquo;all three pleasure
          classes may be entered, but only the best one counts&rdquo; is expressible.
        </p>
      </div>

      <HiPointEditor showId={id} futurity={futurity} />

      <BackToFuturity showId={id} futurity={futurity} />
    </main>
  );
}
