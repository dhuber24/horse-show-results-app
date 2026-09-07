import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import WizardStepper, { type WizardStepKey } from '../../_wizard/WizardStepper';
import { buildSteps, type WizardStepsInput } from '../../_wizard/steps';
import { fetchStepCounts } from './_lib/fetchStepCounts';

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  borderSoft: 'var(--bg-subtle)',
  bg: 'var(--surface)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
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
  const counts = await fetchStepCounts(id);
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
                borderColor: step.done ? 'var(--success-border)' : COLORS.border,
                backgroundColor: step.done ? 'var(--success-bg)' : COLORS.bg,
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
                    color: step.done ? 'var(--success-strong)' : COLORS.warn,
                    backgroundColor: step.done ? 'var(--success-bg)' : COLORS.warnSoft,
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
        ? 'No clubs sanction this show. Skip if none apply.'
        : `${counts.sanctioningCount} club${counts.sanctioningCount === 1 ? '' : 's'}, what each charges and how, and which classes it approves.`;
    case 'lodging':
      return counts.lodgingFeeCount === 0
        ? 'Stall, shavings, and camping fees not configured.'
        : `${counts.lodgingFeeCount} lodging fee${counts.lodgingFeeCount === 1 ? '' : 's'} configured.`;
    case 'fees':
      return counts.feesCount > 0
        ? 'Class fees configured — the office fee, assessments, an all-day pass.'
        : 'An office fee, an association assessment, an all-day pass, a jackpot line.';
    case 'classes':
      return counts.classCount === 0
        ? 'No classes yet — build the schedule from disciplines and divisions.'
        : `${counts.classCount} class${counts.classCount === 1 ? '' : 'es'} on the schedule.`;
    case 'futurities':
      return counts.futurityCount === 0
        ? 'No futurity on this show. Skip unless you run one.'
        : `${counts.futurityCount} futurit${counts.futurityCount === 1 ? 'y' : 'ies'} set up.`;
    case 'judgecards':
      if (counts.classCount === 0) return 'No classes to mark on a card yet.';
      if (counts.scoredClassCount === 0)
        return 'Nothing on this schedule is scored — rail classes are placed, not marked.';
      return counts.cardedClassCount === 0
        ? `${counts.scoredClassCount} scored class${counts.scoredClassCount === 1 ? '' : 'es'}, none given a card yet.`
        : `${counts.cardedClassCount} of ${counts.scoredClassCount} scored classes marked on a card.`;
    case 'showbill':
      return counts.showbillReady
        ? 'Check the show bill, or upload your own in place of it.'
        : 'The generated show bill has no classes on it yet.';
  }
}
