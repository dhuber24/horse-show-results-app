import Link from 'next/link';
import {
  formatRate,
  upgradeScopeForShow,
  type MyFeatures,
  type ShowPlan,
} from '@/lib/show-companies';
import UpgradeToProLink from './UpgradeToProLink';

/**
 * A GaitDesk Pro screen at a show whose company is on Basic (migration 168).
 *
 * In place of the screen, not instead of the way to it: the tile, the button
 * and the link that lead here stay where they are, because a feature nobody
 * can see is one nobody asks to buy (the show bill import's rule). This says
 * what the screen does, whose plan it is missing from, and -- for somebody who
 * works for the show's company -- links to the plan chooser on My Company,
 * since the company picks Pro itself. A guest secretary from outside the
 * company gets no link: it is not their company's plan to change.
 *
 * Only ever the offer. Every Pro endpoint checks the show's plan itself
 * (`require_show_feature`), so a stale page costs a screen, never a feature.
 */
export default function ProLockedPanel({
  feature,
  plan,
  mine,
  backHref,
  backLabel,
}: {
  feature: string;
  plan: ShowPlan | null;
  mine: MyFeatures;
  backHref?: string;
  backLabel?: string;
}) {
  const info = mine.catalog.find((f) => f.key === feature);
  const pro = mine.plans.find((p) => p.key === 'pro');
  const proLabel = info?.plan ?? pro?.label ?? 'GaitDesk Pro';
  const scope = upgradeScopeForShow(mine, plan);
  const whose = plan?.company_name
    ? `${plan.company_name} is on ${plan.plan_label}.`
    : `This show is on ${plan?.plan_label ?? 'GaitDesk Basic'}.`;

  return (
    <section
      className="rounded-lg border p-5 space-y-3"
      style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-bg)' }}
      aria-labelledby="pro-locked-heading"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          {proLabel}
        </span>
        <h2 id="pro-locked-heading" className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
          {info?.label ?? 'A GaitDesk Pro feature'}
        </h2>
      </div>
      {info?.description && (
        <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
          {info.description}
        </p>
      )}
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        {whose} Upgrade to {proLabel} to use it at this show
        {pro ? ` — ${formatRate(pro.rate_cents)} per exhibitor, with everything else Pro includes` : ''}.
      </p>
      {scope ? (
        <UpgradeToProLink mine={scope} feature={feature} />
      ) : (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          Ask the show&apos;s manager about upgrading{plan?.company_name ? ` ${plan.company_name}` : ''}.
        </p>
      )}
      {backHref && (
        <Link href={backHref} className="inline-block text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          ← {backLabel ?? 'Back'}
        </Link>
      )}
    </section>
  );
}

