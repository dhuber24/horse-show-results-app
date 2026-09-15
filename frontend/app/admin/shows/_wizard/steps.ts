import type { StepDef, WizardStepKey } from './WizardStepper';

/**
 * A step's name without its number — the tab's badge and the step's own title
 * already carry that.
 *
 * It lives here rather than beside the tab bar that uses it because `StepLayout`
 * is a server component and `WizardStepper` is a client one: exporting a plain
 * function from a `'use client'` module and calling it on the server is a
 * runtime error, not a type error, so nothing catches it until the page renders.
 */
export function stepName(label: string): string {
  return label.replace(/^\d+\.\s*/, '');
}

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
  /** How many kinds of health paper this show makes a horse arrive with —
   *  Coggins, a CVI, vaccination records. Never zero in practice unless the
   *  show has deliberately turned Coggins off, which is why the Paperwork step
   *  does not tick on a count. It is here so the hub can say what is required
   *  rather than only that the step exists. */
  healthPaperCount: number;
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
    // Classes keep their own URL rather than moving under /setup, the same way
    // Step 1 stays on /edit — the class wizard is deep-linked from the schedule
    // and the dashboard, and a step is a position in the flow, not a folder.
    {
      key: 'classes',
      label: '4. Class Builder',
      href: `/admin/shows/${showId}/classes`,
      done: classCount > 0,
    },
    // After the schedule exists, not before it. Club sanctioning is three
    // questions — which clubs, what each charges (an amount and a unit, since
    // migration 133), and which classes each one approves — and only the first
    // can be answered without a class list. Asking it before the schedule meant
    // the answer lived in three places: a step, a box on the fees step, and a
    // screen hanging off Classes.
    {
      key: 'sanctioning',
      label: '5. Sanctioning',
      href: `/admin/shows/${showId}/setup/sanctioning`,
      done: sanctioningCount > 0,
    },
    // After Classes for the same reason as Sanctioning: a futurity is defined
    // by which classes belong to it, and there is nothing to pick from until
    // the schedule exists. Keeps its own URL because the dashboard reaches it.
    {
      key: 'futurities',
      label: '6. Futurities',
      href: `/admin/shows/${showId}/futurities`,
      done: futurityCount > 0,
    },
    // After the two steps that price things of their own, so the fees step can
    // show what the clubs and the futurity already charge beside the show's own
    // class fees — one screen with the whole of what an exhibitor will be
    // billed, rather than a fees step that knew nothing about two of the ways a
    // show charges. Also after the schedule, so narrowing a fee to some classes
    // has classes to pick from; it used to sit before the Class Builder, where
    // that picker was always empty on a show set up in order.
    {
      key: 'fees',
      label: '7. Fees',
      href: `/admin/shows/${showId}/setup/fees`,
      done: feesCount > 0,
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
    // Before the show bill, which prints the health papers this step turns on —
    // the same reason Sanctioning and Futurities come before Fees. It is a step
    // at all because a manager building a show looks for "what do I require of
    // an exhibitor?" while they are building it; it keeps its desk address too,
    // because the answer is the desk's standing order and the people who revise
    // it are the people working registration. One screen, two doors.
    {
      key: 'paperwork',
      label: '9. Paperwork',
      href: `/admin/shows/${showId}/setup/paperwork`,
      // Always answered: every show requires a negative Coggins from the moment
      // it is created, so there is no un-started state to tick towards. Same
      // reasoning as Basics, and the opposite of the show bill — a tick that
      // would be true of every show on creation has to mean the show genuinely
      // has an answer, not that somebody has visited.
      done: true,
    },
    // Last, because the show bill is what every step before it adds up to — the
    // judges, the clubs, the fees, the class schedule and the papers a horse
    // arrives with, on one sheet. This is where the manager either checks that
    // sheet or hands over the one their club already had printed.
    {
      key: 'showbill',
      label: '10. Show Bill',
      href: `/admin/shows/${showId}/setup/showbill`,
      done: showbillReady,
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
