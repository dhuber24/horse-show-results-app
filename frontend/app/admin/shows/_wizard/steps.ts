import type { StepDef, WizardStepKey } from './WizardStepper';

export type WizardStepsInput = {
  showId: string;
  judgeCount: number;
  sanctioningCount: number;
  lodgingFeeCount: number;
  feesCount: number;
  /** Classes on the schedule. Building them is the biggest job in setting up a
   *  show, so it is a step in the wizard rather than an errand you are expected
   *  to remember from the dashboard. */
  classCount: number;
};

export function buildSteps({
  showId,
  judgeCount,
  sanctioningCount,
  lodgingFeeCount,
  feesCount,
  classCount,
}: WizardStepsInput): StepDef[] {
  return [
    {
      key: 'basic',
      label: '1. Basics & Staff',
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
    // Classes keep their own URL rather than moving under /setup, the same way
    // Step 1 stays on /edit — the class wizard is deep-linked from the schedule
    // and the dashboard, and a step is a position in the flow, not a folder.
    {
      key: 'classes',
      label: '6. Classes',
      href: `/admin/shows/${showId}/classes`,
      done: classCount > 0,
    },
    // Paperwork is deliberately not a step. What a show requires of an exhibitor
    // — health documents, the entry blank, the release — is answered during
    // registration, so it lives at `/admin/shows/{id}/desk/paperwork` beside the
    // desk that checks it. Setting it up once and never reopening it is exactly
    // the failure mode; the desk reads it every time somebody registers.
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
