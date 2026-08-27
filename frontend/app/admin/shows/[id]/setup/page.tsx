import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import WizardStepper, { type WizardStepKey } from '../../_wizard/WizardStepper';
import { buildSteps, type WizardStepsInput } from '../../_wizard/steps';
import { fetchStepCounts } from './_lib/fetchStepCounts';

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  borderSoft: '#f0e6d2',
  bg: '#fff',
  warn: '#5c3d1e',
  warnSoft: '#fdf8eb',
} as const;

export default async function SetupHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const show = await fetchShow(id);

  // One source for what each step has on file — the step pages read the same
  // helper, so the hub and the stepper can never disagree about what is done.
  const counts = await fetchStepCounts(id, show.office_charge_cents ?? 0);
  const steps = buildSteps(counts);

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Setup' },
          ]}
        />
        <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
          Setup — {show.name}
        </h1>
        <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
          Step through to configure this show. You can skip steps and come back to them later.
        </p>
      </div>

      <WizardStepper current="basic" steps={steps} />

      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href ?? '#'}
              className="block p-4 rounded-lg border transition-colors hover:bg-amber-50"
              style={{
                borderColor: step.done ? '#bcd9c0' : COLORS.border,
                backgroundColor: step.done ? '#f3faf3' : COLORS.bg,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
                    {step.label}
                  </h2>
                  <p className="text-sm mt-0.5" style={{ color: COLORS.muted }}>
                    {stepHint(step.key, counts)}
                  </p>
                </div>
                {/* A configured step is still a link, so the badge names what
                    clicking it does rather than restating the green styling. */}
                <span
                  className="text-xs px-2 py-1 rounded shrink-0"
                  style={{
                    color: step.done ? '#1f4e1f' : COLORS.warn,
                    backgroundColor: step.done ? '#dff1df' : COLORS.warnSoft,
                  }}
                >
                  {step.done ? 'Edit' : 'Open'}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function stepHint(key: WizardStepKey, counts: WizardStepsInput): string {
  switch (key) {
    case 'basic':
      return 'Name, dates, venue, and show staff — managers, secretaries, scribes, gate stewards.';
    case 'judges':
      return counts.judgeCount === 0
        ? 'No judges added yet.'
        : `${counts.judgeCount} judge${counts.judgeCount === 1 ? '' : 's'} added.`;
    case 'sanctioning':
      return counts.sanctioningCount === 0
        ? 'No sanctioning associations selected. Skip if none apply.'
        : `${counts.sanctioningCount} sanctioning association${counts.sanctioningCount === 1 ? '' : 's'}.`;
    case 'lodging':
      return counts.lodgingFeeCount === 0
        ? 'Stall, shavings, and camping fees not configured.'
        : `${counts.lodgingFeeCount} lodging fee${counts.lodgingFeeCount === 1 ? '' : 's'} configured.`;
    case 'fees':
      return counts.feesCount > 0
        ? 'Office charge and class fees configured.'
        : 'Office charge, standard class fee, and jackpot.';
    case 'classes':
      return counts.classCount === 0
        ? 'No classes yet — build the schedule from disciplines and divisions.'
        : `${counts.classCount} class${counts.classCount === 1 ? '' : 'es'} on the schedule.`;
    case 'futurities':
      return counts.futurityCount === 0
        ? 'No futurity on this show. Skip unless you run one.'
        : `${counts.futurityCount} futurit${counts.futurityCount === 1 ? 'y' : 'ies'} set up.`;
  }
}
