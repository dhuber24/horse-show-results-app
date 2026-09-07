'use client';

import { AutosaveNavLink } from '../[id]/setup/_lib/StepAutosave';

export type WizardStepKey =
  | 'basic'
  | 'judges'
  | 'lodging'
  | 'fees'
  | 'classes'
  | 'sanctioning'
  | 'futurities'
  | 'judgecards'
  | 'showbill';

export type StepDef = {
  key: WizardStepKey;
  label: string;
  href: string | null;
  done: boolean;
};

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  active: 'var(--text-deep)',
  done: 'var(--success)',
} as const;

/**
 * The step rail. A client component because leaving a step now saves it — each
 * link goes through `AutosaveNavLink`, which flushes whatever the step has
 * unsaved before it navigates. On the setup hub, where nothing is registered,
 * that flush is a no-op and these behave exactly like the links they were.
 */
export default function WizardStepper({
  steps,
  current,
}: {
  steps: StepDef[];
  current: WizardStepKey;
}) {
  return (
    <nav aria-label="Show setup steps" className="overflow-x-auto">
      <ol className="flex items-center gap-2 text-sm whitespace-nowrap">
        {steps.map((step, idx) => {
          const isCurrent = step.key === current;
          const badge = step.done ? '✓' : String(idx + 1);
          const badgeColor = step.done
            ? COLORS.done
            : isCurrent
              ? COLORS.active
              : COLORS.muted;
          const labelColor = isCurrent ? COLORS.text : COLORS.muted;
          const content = (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold border"
                style={{
                  borderColor: badgeColor,
                  color: 'var(--surface)',
                  backgroundColor: badgeColor,
                }}
              >
                {badge}
              </span>
              <span style={{ color: labelColor, fontWeight: isCurrent ? 600 : 400 }}>
                {step.label}
              </span>
            </span>
          );
          return (
            <li key={step.key} className="flex items-center gap-2">
              {step.href && !isCurrent ? (
                <AutosaveNavLink href={step.href}>{content}</AutosaveNavLink>
              ) : (
                <span aria-current={isCurrent ? 'step' : undefined}>{content}</span>
              )}
              {idx < steps.length - 1 && (
                <span aria-hidden style={{ color: COLORS.border }}>
                  ─
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
