import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadPot } from '../loadPot';
import {
  ELIGIBILITY_LABEL,
  SCORING_LABEL,
  StatusPill,
  formatCents,
  potCrumbs,
  potMoney,
} from '../pot-shared';
import DeletePotButton from './DeletePotButton';

/**
 * One side pot: what it is, what is in the pool, and three buttons to the screens
 * that do the work.
 *
 * This page used to stack every section — settings form, entry list, standings,
 * settle, payouts — into one scroll, which meant ticking a box on the last
 * exhibitor to pay took a trip past the whole class picker. Same split as
 * Financials: the hub reads, the sub-screens work.
 */

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
    >
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: '#8b7355' }}>
        {label}
      </p>
      <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: '#2c1810' }}>
        {value}
      </p>
      {detail && (
        <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
          {detail}
        </p>
      )}
    </div>
  );
}

function NavCard({
  href,
  icon,
  title,
  description,
  badge,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  badge?: { label: string; bg: string; fg: string };
}) {
  return (
    <Link
      href={href}
      className="block p-5 rounded-lg border transition-colors hover:bg-amber-50"
      style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl" aria-hidden>
          {icon}
        </div>
        <div>
          <h2
            className="text-lg font-semibold flex items-center flex-wrap gap-2"
            style={{ color: '#2c1810' }}
          >
            {title}
            {badge && (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: badge.bg, color: badge.fg }}
              >
                {badge.label}
              </span>
            )}
          </h2>
          <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default async function SidePotDetailPage({
  params,
}: {
  params: Promise<{ id: string; potId: string }>;
}) {
  const { id, potId } = await params;
  const [show, pot] = await Promise.all([fetchShow(id), loadPot(id, potId)]);

  if (!pot) notFound();

  const isSettled = pot.status === 'settled';
  const money = potMoney(pot, pot.paid_count);
  const base = `/admin/shows/${id}/side-pots/${potId}`;

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={potCrumbs(id, show.name, pot)} />
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
            {pot.name}
          </h1>
          <StatusPill status={pot.status} />
        </div>
        {pot.description && (
          <p className="text-sm mt-1" style={{ color: '#5c3d1e' }}>
            {pot.description}
          </p>
        )}
        {pot.settled_at && (
          <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
            Settled {new Date(pot.settled_at).toLocaleString()} — payouts are frozen.
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <NavCard
          href={`${base}/settings`}
          icon="⚙️"
          title="Settings"
          description="Buy-in, payback, scoring, and which classes are bundled."
          badge={isSettled ? { label: 'Locked', bg: '#d4d4d4', fg: '#404040' } : undefined}
        />
        <NavCard
          href={`${base}/entries`}
          icon="🎟️"
          title="Side Pot Entries"
          description="Add exhibitors to the pot, and see who is already in."
          badge={
            pot.entry_count > 0
              ? { label: String(pot.entry_count), bg: '#f0e8d8', fg: '#8b4513' }
              : undefined
          }
        />
        <NavCard
          href={`${base}/standings`}
          icon="🏆"
          title="Standings"
          description={
            isSettled
              ? 'Final ranking and the frozen payout sheet.'
              : 'Live ranking, projected payouts, and settling the pot.'
          }
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>
          Pool
        </h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <Tile
            label="In the pot"
            value={String(pot.entry_count)}
            detail={pot.entry_count === 1 ? 'exhibitor' : 'exhibitors'}
          />
          <Tile
            label="Buy-ins"
            value={formatCents(money.buyInsCents)}
            detail={`${formatCents(pot.entry_fee_cents)} × ${pot.paid_count}`}
          />
          <Tile
            label="Payout pool"
            value={formatCents(money.payoutPoolCents)}
            detail={`${pot.payback_percent}% payback · show keeps ${formatCents(
              money.retainedCents,
            )}`}
          />
        </div>
        <p className="text-xs" style={{ color: '#8b7355' }}>
          Everyone in the pot owes the buy-in and settles at the end of the show. Pot money
          is tracked apart from the exhibitor&rsquo;s show bill and is not part of their
          balance on Financials.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold" style={{ color: '#2c1810' }}>
          How it scores
        </h2>
        <dl className="text-sm rounded-lg border divide-y" style={{ borderColor: '#d4b896' }}>
          {[
            ['Scoring', SCORING_LABEL[pot.scoring_method]],
            ['Eligibility', ELIGIBILITY_LABEL[pot.eligibility_rule]],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2">
              <dt className="w-28 shrink-0" style={{ color: '#8b7355' }}>
                {label}
              </dt>
              <dd style={{ color: '#2c1810' }}>{value}</dd>
            </div>
          ))}
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-2">
            <dt className="w-28 shrink-0" style={{ color: '#8b7355' }}>
              Classes
            </dt>
            <dd className="flex flex-wrap gap-1" style={{ color: '#2c1810' }}>
              {pot.classes.length === 0 ? (
                <span style={{ color: '#8b7355' }}>None bundled yet.</span>
              ) : (
                pot.classes.map((c) => (
                  <span
                    key={c.class_id}
                    className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                    title={c.class_name}
                  >
                    #{c.class_number}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </section>

      {!isSettled && <DeletePotButton showId={id} potId={potId} />}
    </main>
  );
}
