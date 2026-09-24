import Link from 'next/link';
import { SHOWBILL_IMPORT, hasFeature, planFor, upgradeText, type MyFeatures } from '@/lib/show-companies';

/**
 * The show bill import, sold.
 *
 * Shown to everybody who can create a show, because a feature nobody can see
 * is one nobody asks to buy. A company that has it (migration 142) gets the
 * button; one that does not gets the same button, disabled, with the plan to
 * upgrade to and whose company it is — the pitch is identical either way, so
 * the locked card tells somebody exactly what they are missing.
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
      className="rounded-xl border p-5 sm:p-6 space-y-4"
      style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-bg)' }}
      aria-labelledby="automate-show-heading"
    >
      <div className="space-y-2">
        <span
          className="inline-block text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          {plan}
        </span>
        <h2 id="automate-show-heading" className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
          Automate your show setup
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-deep)' }}>
          Upload the show bill you sent to the printer. GaitDesk reads the dates, venue, judges, clubs,
          every class and every fee into a draft show — you check it and press Create.
        </p>
      </div>

      <ul className="grid gap-1.5 sm:grid-cols-3 text-sm" style={{ color: 'var(--text-deep)' }}>
        {[
          'A day of typing, done in minutes',
          'Every class, price and judge laid out to check',
          'Nothing is created until you say so',
        ].map((point) => (
          <li key={point} className="flex items-start gap-2">
            <CheckIcon />
            <span>{point}</span>
          </li>
        ))}
      </ul>

      {unlocked ? (
        <Link
          href="/admin/shows/new/from-showbill"
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }}
        >
          <UploadIcon />
          Upload show bill &amp; automate my show
        </Link>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            disabled
            title={locked?.headline}
            aria-describedby="automate-show-locked"
            className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-3 rounded-lg border text-sm font-semibold cursor-not-allowed"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)', color: 'var(--text-dimmed)' }}
          >
            <LockIcon />
            Upload show bill &amp; automate my show
          </button>
          <p id="automate-show-locked" className="text-sm" style={{ color: 'var(--text-deep)' }}>
            <span className="font-semibold">{locked?.headline}</span>{' '}
            <span style={{ color: 'var(--muted)' }}>{locked?.detail}</span>
          </p>
        </div>
      )}
    </section>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--success)' }}>
      <path
        fill="currentColor"
        d="M8.1 13.3 4.8 10l-1.1 1.1 4.4 4.4 8.2-8.2-1.1-1.1z"
      />
    </svg>
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
    <svg aria-hidden viewBox="0 0 20 20" className="w-4 h-4 shrink-0">
      <path
        fill="currentColor"
        d="M10 2.5a3.8 3.8 0 0 0-3.8 3.8V8H5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1.2V6.3A3.8 3.8 0 0 0 10 2.5Zm-2.2 3.8a2.2 2.2 0 0 1 4.4 0V8H7.8Z"
      />
    </svg>
  );
}
