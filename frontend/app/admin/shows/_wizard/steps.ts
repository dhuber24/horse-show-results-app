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
  /** Futurity programmes on this show. Optional — most shows run none — but it
   *  is a step rather than a dashboard errand because a futurity is set up
   *  *while* the show is, and because the alternative was a single "futurity
   *  fee" box in the fees step that could not describe one. */
  futurityCount: number;
  /** Classes a judge marks on a card — `pattern` and `time`. A rail class is
   *  placed, not scored, and has nothing for the Judge Cards step to ask about. */
  scoredClassCount: number;
  /** How many of those actually carry a `judging_system_id`. */
  cardedClassCount: number;
  /** Whether the show's bill is a bill yet — the generated one has classes on
   *  it, or the show uploaded its own file. Not "has the manager visited this
   *  step": every show has a generated bill by default, so a step that went
   *  green on arrival would say nothing. */
  showbillReady: boolean;
};

export function buildSteps({
  showId,
  judgeCount,
  sanctioningCount,
  lodgingFeeCount,
  feesCount,
  classCount,
  futurityCount,
  scoredClassCount,
  cardedClassCount,
  showbillReady,
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
      key: 'lodging',
      label: '3. Lodging',
      href: `/admin/shows/${showId}/setup/lodging`,
      done: lodgingFeeCount > 0,
    },
    {
      key: 'fees',
      label: '4. Fees',
      href: `/admin/shows/${showId}/setup/fees`,
      done: feesCount > 0,
    },
    // Classes keep their own URL rather than moving under /setup, the same way
    // Step 1 stays on /edit — the class wizard is deep-linked from the schedule
    // and the dashboard, and a step is a position in the flow, not a folder.
    {
      key: 'classes',
      label: '5. Class Builder',
      href: `/admin/shows/${showId}/classes`,
      done: classCount > 0,
    },
    // After the schedule exists, not before it. Club sanctioning is three
    // questions — which clubs, what each charges (an amount and a unit, since
    // migration 133), and which classes each one approves — and only the first
    // can be answered without a class list. Asking it third meant the answer lived in three places: a step, a
    // box on the fees step, and a screen hanging off Classes.
    {
      key: 'sanctioning',
      label: '6. Sanctioning',
      href: `/admin/shows/${showId}/setup/sanctioning`,
      done: sanctioningCount > 0,
    },
    // After Classes for the same reason as Sanctioning: a futurity is defined
    // by which classes belong to it, and there is nothing to pick from until
    // the schedule exists. Keeps its own URL because the dashboard reaches it.
    {
      key: 'futurities',
      label: '7. Futurities',
      href: `/admin/shows/${showId}/futurities`,
      done: futurityCount > 0,
    },
    // Which card each scored class is marked on. A step of its own rather than
    // a notice at the top of the Class Builder: it is a per-class designation
    // made once the schedule exists, and the screen is also the only place the
    // card shapes are explained — a secretary choosing between three of them
    // needs to see what each asks the judge for.
    {
      key: 'judgecards',
      label: '8. Judge Cards',
      href: `/admin/shows/${showId}/classes/judging`,
      // Green once the schedule can answer the question: nothing on it is
      // scored, or something on it has been given a card. Before there are any
      // classes there is nothing to have decided, the same reasoning that
      // keeps the show bill from ticking itself on arrival.
      done: classCount > 0 && (scoredClassCount === 0 || cardedClassCount > 0),
    },
    // Last, because the show bill is what every step before it adds up to — the
    // judges, the clubs, the fees and the class schedule, on one sheet. This is
    // where the manager either checks that sheet or hands over the one their
    // club already had printed.
    {
      key: 'showbill',
      label: '9. Show Bill',
      href: `/admin/shows/${showId}/setup/showbill`,
      done: showbillReady,
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
