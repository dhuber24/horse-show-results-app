import type { StepDef, WizardStepKey } from './WizardStepper';

export type WizardStepsInput = {
  showId: string;
  judgeCount: number;
  sanctioningCount: number;
  lodgingFeeCount: number;
  feesCount: number;
};

export function buildSteps({
  showId,
  judgeCount,
  sanctioningCount,
  lodgingFeeCount,
  feesCount,
}: WizardStepsInput): StepDef[] {
  return [
    {
      key: 'basic',
      label: '1. Basics',
      href: `/admin/shows/${showId}/edit`,
      done: true,
    },
    {
      key: 'judges',
      label: '2. Judges',
      href: `/admin/shows/${showId}/setup/judges`,
      done: judgeCount > 0,
    },
    {
      key: 'sanctioning',
      label: '3. Sanctioning',
      href: `/admin/shows/${showId}/setup/sanctioning`,
      done: sanctioningCount > 0,
    },
    {
      key: 'lodging',
      label: '4. Lodging',
      href: `/admin/shows/${showId}/setup/lodging`,
      done: lodgingFeeCount > 0,
    },
    {
      key: 'fees',
      label: '5. Fees',
      href: `/admin/shows/${showId}/setup/fees`,
      done: feesCount > 0,
    },
  ];
}

export function nextStepHref(
  steps: StepDef[],
  current: WizardStepKey,
): string | null {
  const idx = steps.findIndex((s) => s.key === current);
  if (idx === -1 || idx === steps.length - 1) return null;
  return steps[idx + 1].href;
}
