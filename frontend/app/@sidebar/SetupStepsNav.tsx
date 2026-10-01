'use client';

import { useState } from 'react';
import type { StepDef } from '../admin/shows/_wizard/WizardStepper';
import { stepBadge, stepName, stepStatusTitle } from '../admin/shows/_wizard/steps';
import SidebarLink from './SidebarLink';

const BADGE =
  'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0';

/**
 * The setup steps, listed down the sidebar under **Setup** while somebody is
 * in setup — the desktop's version of `WizardStepper`'s tab bar, which hides at
 * that width. The same statuses: a tick when the step has something on file, a
 * dash when the show skipped it, the number otherwise, and the same hover text
 * saying which.
 *
 * Skipped steps fold away behind an *N skipped* line, as they do in the tab bar
 * (migration 154), and the step somebody is standing on is always listed, even
 * skipped. The step itself is not a link: a link to the page you are on would
 * save and reload it for nothing.
 */
export default function SetupStepsNav({
  steps,
  pathname,
  activeHref,
}: {
  steps: StepDef[];
  pathname: string;
  /** The step the page belongs to — itself, or a page under it such as one
   *  class in the Class Builder. */
  activeHref: string | null;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const skippedCount = steps.filter((s) => s.skipped && s.href !== activeHref).length;

  return (
    <ol
      aria-label="Setup steps"
      className="mt-0.5 mb-1 ml-4 pl-2 border-l space-y-0.5 collapsed:ml-0 collapsed:pl-0 collapsed:border-l-0"
      style={{ borderColor: 'var(--border)' }}
    >
      {steps.map((step, idx) => {
        const isActive = step.href === activeHref;
        if (step.skipped && !isActive && !showSkipped) return null;
        const minimized = step.skipped && !isActive;

        const badgeStyle: React.CSSProperties = minimized
          ? { color: 'var(--muted)', border: '1px dashed var(--border)' }
          : isActive
            ? { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' }
            : step.done
              ? { backgroundColor: 'var(--success)', color: 'var(--surface)' }
              : { backgroundColor: 'var(--bg-subtle)', color: 'var(--muted)' };

        const rowClass = `flex items-center gap-2 rounded-md px-2 py-1 text-sm collapsed:justify-center collapsed:px-0 ${
          isActive ? '' : 'hover:bg-bg-subtle'
        }`;
        const rowStyle: React.CSSProperties = isActive
          ? { backgroundColor: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 600 }
          : { color: minimized ? 'var(--muted)' : 'var(--text-deep)' };

        const inner = (
          <>
            <span aria-hidden className={BADGE} style={badgeStyle}>
              {stepBadge(step, idx)}
            </span>
            <span className="truncate collapsed:sr-only">{stepName(step.label)}</span>
          </>
        );

        return (
          <li key={step.key}>
            {step.href && step.href !== pathname ? (
              <SidebarLink
                href={step.href}
                className={rowClass}
                style={rowStyle}
                title={`${stepName(step.label)}: ${stepStatusTitle(step, idx)}`}
              >
                {inner}
              </SidebarLink>
            ) : (
              <span
                className={rowClass}
                style={rowStyle}
                title={`${stepName(step.label)}: ${stepStatusTitle(step, idx)}`}
                aria-current={isActive ? 'step' : undefined}
              >
                {inner}
              </span>
            )}
          </li>
        );
      })}
      {skippedCount > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setShowSkipped((v) => !v)}
            aria-expanded={showSkipped}
            className="px-2 py-1 text-xs hover:underline collapsed:hidden"
            style={{ color: 'var(--muted)' }}
            title={showSkipped ? 'Fold the skipped steps away again' : 'Show the steps skipped for this show'}
          >
            {showSkipped ? 'Hide skipped' : `${skippedCount} skipped`}
          </button>
        </li>
      )}
    </ol>
  );
}
