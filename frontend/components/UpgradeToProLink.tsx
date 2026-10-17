import Link from 'next/link';
import { planFor, type MyFeatures } from '@/lib/show-companies';

/**
 * The way out of a locked Pro feature (migration 170): **Upgrade to GaitDesk
 * Pro**, to the plan chooser on My Company. A company picks Pro itself and is
 * billed after each show, so there is nothing to ask GaitDesk for -- the
 * Request upgrade button this replaced is gone with the per-feature switches.
 *
 * Renders nothing for somebody in no company, or (from a show's screen) one
 * who does not work for the show's company: it is not their plan to change,
 * and the locked text beside it says who to ask.
 *
 * `compact` is for the end of a strip (`AutomateShowCard`) whose plan pill
 * already names the plan.
 */
export default function UpgradeToProLink({
  mine,
  feature,
  compact = false,
}: {
  mine: MyFeatures;
  feature: string;
  compact?: boolean;
}) {
  if (mine.companies.length === 0) return null;
  const plan = planFor(mine, feature);
  return (
    <Link
      href="/admin/my-company"
      title={`Choose ${plan} on My Company — nothing is charged until after the show`}
      className={`inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-lg text-sm font-semibold ${compact ? 'px-4 py-2' : 'px-5 py-3'}`}
      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
    >
      <SparkIcon />
      {compact ? 'Upgrade' : `Upgrade to ${plan}`}
    </Link>
  );
}

function SparkIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4 shrink-0">
      <path fill="currentColor" d="M10 2.5 11.6 8.4 17.5 10l-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6z" />
    </svg>
  );
}
