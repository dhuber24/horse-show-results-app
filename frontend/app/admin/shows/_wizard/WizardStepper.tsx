import Link from 'next/link';

export type WizardStepKey =
  | 'basic'
  | 'judges'
  | 'sanctioning'
  | 'lodging'
  | 'fees'
  | 'classes';

export type StepDef = {
  key: WizardStepKey;
  label: string;
  href: string | null;
  done: boolean;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  active: '#5c3d1e',
  done: '#2f6b3f',
} as const;

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
                  color: '#fff',
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
              {step.href ? (
                <Link href={step.href} aria-current={isCurrent ? 'step' : undefined}>
                  {content}
                </Link>
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
