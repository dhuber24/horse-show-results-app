import Link from 'next/link';
import Breadcrumbs from '@/components/Breadcrumbs';
import WizardStepper, { type WizardStepKey } from '../../../_wizard/WizardStepper';
import { buildSteps, type WizardStepsInput } from '../../../_wizard/steps';

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

export default function StepLayout({
  showId,
  showName,
  current,
  title,
  subtitle,
  stepsInput,
  children,
}: {
  showId: string;
  showName: string;
  current: WizardStepKey;
  title: string;
  subtitle: string;
  stepsInput: WizardStepsInput;
  children: React.ReactNode;
}) {
  const steps = buildSteps(stepsInput);
  const idx = steps.findIndex((s) => s.key === current);
  const prev = idx > 0 ? steps[idx - 1] : null;
  const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : null;

  return (
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
          <Link
            href={prev.href}
            className="text-sm rounded px-3 py-2 border"
            style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
          >
            ← Back to {prev.label.replace(/^\d+\.\s*/, '')}
          </Link>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/shows/${showId}/setup`}
            className="text-sm rounded px-3 py-2 border"
            style={{ borderColor: COLORS.border, color: COLORS.text, backgroundColor: '#fff' }}
          >
            Setup hub
          </Link>
          {next?.href && (
            <Link
              href={next.href}
              className="text-sm rounded px-4 py-2"
              style={{ backgroundColor: COLORS.warn, color: '#fff' }}
            >
              {next.label.replace(/^\d+\.\s*/, '')} →
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
