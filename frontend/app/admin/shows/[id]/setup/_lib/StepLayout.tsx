import Breadcrumbs from '@/components/Breadcrumbs';
import WizardStepper, { type WizardStepKey } from '../../../_wizard/WizardStepper';
import { buildSteps, type WizardStepsInput } from '../../../_wizard/steps';
import { StepAutosaveProvider, AutosaveNavLink } from './StepAutosave';

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  bg: 'var(--surface)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
} as const;

const navButton = 'text-sm rounded px-3 py-2 border';

export default function StepLayout({
  showId,
  showName,
  current,
  title,
  subtitle,
  stepsInput,
  skipLabel,
  children,
}: {
  showId: string;
  showName: string;
  current: WizardStepKey;
  title: string;
  subtitle: string;
  stepsInput: WizardStepsInput;
  /** Offered by a step nobody is required to complete — Futurities, where most
   *  shows run none. It goes to the same place the Next link does; what it adds
   *  is the manager being told, on the step, that walking past it is a
   *  supported answer rather than an omission they will be chased about. */
  skipLabel?: string;
  children: React.ReactNode;
}) {
  const steps = buildSteps(stepsInput);
  const idx = steps.findIndex((s) => s.key === current);
  const prev = idx > 0 ? steps[idx - 1] : null;
  const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null;

  return (
    // Everything inside the step, the stepper and the footer nav share one
    // autosave registry: a step's client registers what it has unsaved, and any
    // control that leaves writes it first. See StepAutosave.tsx.
    <StepAutosaveProvider>
      <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <Breadcrumbs
            crumbs={[
              { label: 'Admin', href: '/admin' },
              { label: 'Shows', href: '/admin/shows' },
              { label: showName, href: `/admin/shows/${showId}` },
              { label: 'Setup', href: `/admin/shows/${showId}/setup` },
              { label: title },
            ]}
          />
          <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
            {title}
          </h1>
          <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
            {subtitle}
          </p>
        </div>

        <WizardStepper current={current} steps={steps} />

        <div>{children}</div>

        <div
          className="p-4 rounded-lg border flex items-center justify-between gap-3 flex-wrap"
          style={{ borderColor: COLORS.border, backgroundColor: COLORS.warnSoft }}
        >
          {prev?.href ? (
            <AutosaveNavLink
              href={prev.href}
              className={navButton}
              style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
            >
              ← Back to {prev.label.replace(/^\d+\.\s*/, '')}
            </AutosaveNavLink>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <AutosaveNavLink
              href={`/admin/shows/${showId}/setup`}
              className={navButton}
              style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: 'var(--surface)' }}
            >
              Setup hub
            </AutosaveNavLink>
            {next?.href && skipLabel && (
              <AutosaveNavLink
                href={next.href}
                className={navButton}
                style={{ borderColor: COLORS.border, color: COLORS.muted, backgroundColor: 'var(--surface)' }}
              >
                {skipLabel}
              </AutosaveNavLink>
            )}
            {next?.href && (
              <AutosaveNavLink
                href={next.href}
                className="text-sm rounded px-4 py-2"
                style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
              >
                {next.label.replace(/^\d+\.\s*/, '')} →
              </AutosaveNavLink>
            )}
          </div>
        </div>
      </main>
    </StepAutosaveProvider>
  );
}
