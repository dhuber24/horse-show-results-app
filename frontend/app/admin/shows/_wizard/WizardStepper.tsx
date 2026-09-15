'use client';

import { AutosaveNavLink } from '../[id]/setup/_lib/StepAutosave';
import { stepName } from './steps';

export type WizardStepKey =
  | 'basic'
  | 'judges'
  | 'lodging'
  | 'fees'
  | 'classes'
  | 'sanctioning'
  | 'futurities'
  | 'judgecards'
  | 'paperwork'
  | 'showbill';

export type StepDef = {
  key: WizardStepKey;
  label: string;
  href: string | null;
  done: boolean;
};

const COLORS = {
  muted: 'var(--muted)',
  border: 'var(--border)',
  subtle: 'var(--bg-subtle)',
  surface: 'var(--surface)',
  accent: 'var(--accent)',
  onAccent: 'var(--accent-foreground)',
  done: 'var(--success)',
  doneBg: 'var(--success-bg)',
  doneText: 'var(--success-strong)',
  doneBorder: 'var(--success-border)',
} as const;

const TAB =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs sm:text-sm leading-none transition-colors';

const BADGE =
  'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0';

/**
 * The setup wizard's tab bar.
 *
 * It was a numbered rail — `1 ─ 2 ─ 3 …` on one `overflow-x-auto` line — and at
 * nine steps with their labels that line is about 1,000px wide, so on every
 * screen this app is used on, steps five onwards were off the right-hand edge
 * with nothing to say they existed. A manager who wanted Fees had to scroll a
 * strip they had no reason to think scrolled. So the steps **wrap**: two rows on
 * a laptop, three or four on a phone, and every step is one press from every
 * other. That is the whole point of tabs here — the wizard has an order, but
 * nobody walks it in order twice.
 *
 * A client component because leaving a step now saves it — each tab goes through
 * `AutosaveNavLink`, which flushes whatever the step has unsaved before it
 * navigates. The tab you are on is a `<span>` rather than a link: it goes
 * nowhere, and a control that reloads the page you are already on would throw
 * away an unsaved form for nothing.
 *
 * **All steps** leads, pointing at the setup hub. It is a real destination — the
 * hub is where each step's status is written out in words — and having it here
 * is what let the footer stop carrying a *Setup hub* button beside the Back and
 * Next it is actually for.
 *
 * Sticky only from `sm` up. Pinned to the top of a phone screen, a four-row tab
 * bar is half the viewport, which is the opposite of getting somebody to the
 * work.
 */
export default function WizardStepper({
  steps,
  current,
  hubHref,
}: {
  steps: StepDef[];
  /** `'hub'` on the setup hub itself, where no step is open. */
  current: WizardStepKey | 'hub';
  /** Null on `/admin/shows/new`, where the show does not exist yet and so has
   *  no setup hub — and, for the same reason, no step has a link either. */
  hubHref: string | null;
}) {
  return (
    <nav
      aria-label="Show setup steps"
      className="sm:sticky sm:top-0 sm:z-30 py-2 border-b"
      style={{ backgroundColor: 'var(--background)', borderColor: COLORS.border }}
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {hubHref && (
          <li>
            <Tab
              href={hubHref}
              isCurrent={current === 'hub'}
              title="Every step, with what each one has on file"
            >
              All steps
            </Tab>
          </li>
        )}
        {steps.map((step, idx) => (
          <li key={step.key}>
            <Tab
              href={step.href}
              isCurrent={step.key === current}
              done={step.done}
              // The tick and the number are the only status on a tab, and
              // neither says what it means on its own.
              title={
                step.done
                  ? `Step ${idx + 1} — set up`
                  : `Step ${idx + 1} — nothing on file yet`
              }
              badge={step.done ? '✓' : String(idx + 1)}
            >
              {stepName(step.label)}
            </Tab>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Tab({
  href,
  isCurrent,
  done,
  badge,
  title,
  children,
}: {
  href: string | null;
  isCurrent: boolean;
  done?: boolean;
  badge?: string;
  title: string;
  children: React.ReactNode;
}) {
  const style: React.CSSProperties = isCurrent
    ? {
        backgroundColor: COLORS.accent,
        borderColor: COLORS.accent,
        color: COLORS.onAccent,
        fontWeight: 600,
      }
    : done
      ? {
          backgroundColor: COLORS.doneBg,
          borderColor: COLORS.doneBorder,
          color: COLORS.doneText,
        }
      : {
          backgroundColor: COLORS.surface,
          borderColor: COLORS.border,
          color: COLORS.muted,
        };

  const badgeStyle: React.CSSProperties = isCurrent
    ? { backgroundColor: COLORS.onAccent, color: COLORS.accent }
    : done
      ? { backgroundColor: COLORS.done, color: COLORS.surface }
      : { backgroundColor: COLORS.subtle, color: COLORS.muted };

  const inner = (
    <>
      {badge && (
        <span aria-hidden className={BADGE} style={badgeStyle}>
          {badge}
        </span>
      )}
      <span className="whitespace-nowrap">{children}</span>
    </>
  );

  if (isCurrent || !href) {
    return (
      <span
        className={TAB}
        style={style}
        title={title}
        aria-current={isCurrent ? 'step' : undefined}
      >
        {inner}
      </span>
    );
  }

  return (
    <AutosaveNavLink href={href} className={TAB} style={style} title={title}>
      {inner}
    </AutosaveNavLink>
  );
}
