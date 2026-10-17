import Link from 'next/link';
import { getAuthHeaders } from '@/lib/backend-fetch';
import ProLockedPanel from '@/components/ProLockedPanel';
import { LIVE_BOARDS, fetchMyFeatures, fetchShowPlan, showHasFeature } from '@/lib/show-companies';

/**
 * The Live Boards are GaitDesk Pro (migration 168): the Live Screens page and
 * every board behind it, in one check.
 *
 * The boards show nothing the public cannot read -- posted results, and the
 * gate's own endpoints the steward uses at every show -- so what is sold is
 * putting the show up on a wall, and this page is where that is decided. The
 * one endpoint only a board uses, the marquee's PUT, refuses a Basic show
 * itself.
 *
 * The lock sits on the boards' own dark panel, because it is usually read on
 * the TV's browser in the tab the board would have run in.
 */
export default async function BoardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headers = await getAuthHeaders();
  const plan = await fetchShowPlan(id, headers);
  if (showHasFeature(plan, LIVE_BOARDS)) return <>{children}</>;

  const mine = await fetchMyFeatures(headers);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ backgroundColor: 'var(--slate)' }}>
      <div className="mx-auto max-w-xl px-4 py-[8vh] space-y-4">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--on-slate)' }}>
          Live Screens
        </h1>
        <ProLockedPanel feature={LIVE_BOARDS} plan={plan} mine={mine} />
        <Link href={`/admin/shows/${id}`} className="inline-block text-sm hover:underline" style={{ color: 'var(--accent-light)' }}>
          ← Back to the show
        </Link>
      </div>
    </div>
  );
}
