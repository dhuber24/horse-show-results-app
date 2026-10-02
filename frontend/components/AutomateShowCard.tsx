import Link from 'next/link';
import { SHOWBILL_IMPORT, hasFeature, planFor, upgradeText, type MyFeatures } from '@/lib/show-companies';
import UpgradeRequestButton from './UpgradeRequestButton';

/**
 * The show bill import, sold.
 *
 * Shown to everybody who can create a show, because a feature nobody can see
 * is one nobody asks to buy. The pitch is identical either way, so the locked
 * strip tells somebody exactly what they are missing; only the action differs.
 * A company that has it (migration 142) gets the upload button. One that does
 * not gets a lock line naming whose company it is, and the way out of it: a
 * Request upgrade button that asks GaitDesk on the company's behalf (migration
 * 144), so "upgrade" is something the office can do from here rather than an
 * instruction to go and find somebody to ask.
 *
 * A strip, not a panel: it sits above the show list and above Step 1's form,
 * so it is one row on a desk screen and the pitch is one sentence.
 *
 * The button is an offer, never the enforcement: every show-bill endpoint
 * checks the feature for itself.
 */
export default function AutomateShowCard({ mine }: { mine: MyFeatures }) {
  const unlocked = hasFeature(mine, SHOWBILL_IMPORT);
  const plan = planFor(mine, SHOWBILL_IMPORT);
  const locked = unlocked ? null : upgradeText(mine, SHOWBILL_IMPORT);

  return (
    <section
      className="rounded-lg border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-bg)' }}
      aria-labelledby="automate-show-heading"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            {plan}
          </span>
          <h2 id="automate-show-heading" className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
            Automate your show setup
          </h2>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
          Upload your show bill&apos;s PDF and GaitDesk reads every class, fee and judge into a draft show for
          you to check.
        </p>
        {locked && (
          // The pill and the Request upgrade button already say "upgrade to
          // GaitDesk Pro", so this line shows only whose company is missing it;
          // the headline stays for a screen reader and on hover.
          <p
            title={locked.headline}
            className="flex items-start gap-1.5 text-xs"
            style={{ color: 'var(--muted)' }}
          >
            <LockIcon />
            <span>
              <span className="sr-only">{locked.headline} </span>
              {locked.detail}
            </span>
          </p>
        )}
      </div>

      <div className="sm:shrink-0">
        {unlocked ? (
          <Link
            href="/admin/shows/new/from-showbill"
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            <UploadIcon />
            Upload show bill
          </Link>
        ) : (
          <UpgradeRequestButton mine={mine} feature={SHOWBILL_IMPORT} compact />
        )}
      </div>
    </section>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4 shrink-0">
      <path fill="currentColor" d="M10 3 5.5 7.5l1.1 1.1 2.6-2.6V13h1.6V6l2.6 2.6 1.1-1.1zM4 15h12v1.6H4z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="w-3.5 h-3.5 mt-px shrink-0">
      <path
        fill="currentColor"
        d="M10 2.5a3.8 3.8 0 0 0-3.8 3.8V8H5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1.2V6.3A3.8 3.8 0 0 0 10 2.5Zm-2.2 3.8a2.2 2.2 0 0 1 4.4 0V8H7.8Z"
      />
    </svg>
  );
}
