import type { StepDef, WizardStepKey } from './WizardStepper';

/**
 * What the office can say does not apply to this show (migration 154) — one key
 * per skippable step, plus the second feature of each step that sets up two:
 * `sidepots` (Futurities & Side Pots) and `highpoint` (Scoring, beside the
 * judge cards). Mirrors `SKIPPABLE_STEPS` in
 * `backend/routers/show_setup.py`, which refuses any other key. Basics, the
 * Class Builder, Paperwork and the Show Bill have none: a show cannot do
 * without them.
 */
export type SkipKey = WizardStepKey | 'sidepots' | 'highpoint';

/** A feature with a tile of its own on the show dashboard, greyed out there
 *  once the office declines it in setup. */
export type DeclinableFeature = 'futurities' | 'sidepots' | 'highpoint';

/** The keys a step records when it is skipped as a whole. Futurities & Side
 *  Pots and Scoring are two features each, declined one at a time on the step
 *  itself; skipping the whole step declines both. */
const STEP_SKIP_KEYS: Partial<Record<WizardStepKey, SkipKey[]>> = {
  judges: ['judges'],
  lodging: ['lodging'],
  sanctioning: ['sanctioning'],
  futurities: ['futurities', 'sidepots'],
  fees: ['fees'],
  judgecards: ['judgecards', 'highpoint'],
};

export function skipKeysFor(step: WizardStepKey): SkipKey[] {
  return STEP_SKIP_KEYS[step] ?? [];
}

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
  /** Side pots on this show. They share the Futurities step: a pot, like a
   *  futurity, is a set of classes with money of its own, decided before the
   *  show runs, and a show that runs none should be able to say so once rather
   *  than carry a Side Pots tile that looks like forgotten work. */
  sidePotCount: number;
  /** Classes a judge marks on a card — `pattern` and `time`. A rail class is
   *  placed, not scored, and has nothing for the Judge Cards step to ask about. */
  scoredClassCount: number;
  /** How many of those actually carry a `judging_system_id`. */
  cardedClassCount: number;
  /** Classes whose card type somebody chose on the Scoring step (migration 155)
   *  rather than left to the default the discipline implies. */
  scoringChosenCount: number;
  /** How many classes are placed by each card type, derived defaults included —
   *  what the setup hub reports for the Scoring step. */
  cardTypeCounts: Record<'placing' | 'scored' | 'equitation' | 'timed', number>;
  /** Whether the show has a points chart for its high point. It shares the
   *  Scoring step with the judge cards: both are how a posted class turns into
   *  a result, and the chart is set up once, before the show, like the cards. */
  highPointChosen: boolean;
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
  /** What the office said does not apply (migration 154). Only counted while
   *  the step is also empty — see `skipped` in `buildSteps`. Optional so a
   *  screen with no show yet (`/admin/shows/new`) need not pass it. */
  skippedSteps?: SkipKey[];
};

export function buildSteps({
  showId,
  judgeCount,
  sanctioningCount,
  lodgingFeeCount,
  feesCount,
  classCount,
  futurityCount,
  sidePotCount,
  scoredClassCount,
  cardedClassCount,
  scoringChosenCount,
  highPointChosen,
  showbillReady,
  skippedSteps = [],
}: WizardStepsInput): StepDef[] {
  const skipped = new Set(skippedSteps);
  // Numbered from their position, never by hand: a hand-typed number fell out
  // of step with the flow the first time a step was inserted (the Show Bill
  // read "Step 9" on a tab labelled 10), and every page title reads it from here.
  const steps: Omit<StepDef, 'skipped'>[] = [
    {
      key: 'basic',
      label: 'Basics & Staff',
      href: `/admin/shows/${showId}/edit`,
      done: true,
    },
    {
      key: 'judges',
      label: 'Judges',
      href: `/admin/shows/${showId}/setup/judges`,
      done: judgeCount > 0,
    },
    {
      key: 'lodging',
      label: 'Lodging',
      href: `/admin/shows/${showId}/setup/lodging`,
      done: lodgingFeeCount > 0,
    },
    // Classes keep their own URL rather than moving under /setup, the same way
    // Step 1 stays on /edit — the class wizard is deep-linked from the schedule
    // and the dashboard, and a step is a position in the flow, not a folder.
    {
      key: 'classes',
      label: 'Class Builder',
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
      label: 'Sanctioning',
      href: `/admin/shows/${showId}/setup/sanctioning`,
      done: sanctioningCount > 0,
    },
    // After Classes for the same reason as Sanctioning: a futurity is defined
    // by which classes belong to it, and there is nothing to pick from until
    // the schedule exists. Keeps its own URL because the dashboard reaches it.
    {
      key: 'futurities',
      // Side pots share the step: a pot is a set of classes with money of its
      // own, like a futurity, so it needs the schedule and comes before Fees.
      label: 'Futurities & Side Pots',
      href: `/admin/shows/${showId}/futurities`,
      done: futurityCount > 0 || sidePotCount > 0,
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
      label: 'Fees',
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
      // The judge cards and the show's points chart: how a posted class is
      // marked, and what its placings are worth on the leaderboard.
      label: 'Scoring',
      href: `/admin/shows/${showId}/classes/judging`,
      // Green once either half has an answer: somebody chose a class's card
      // type or gave one a sheet, or the show has a points chart. Every class
      // has a derived card type from the moment it exists, so "classes exist"
      // would tick the step for every show on arrival and say nothing — the
      // same reasoning that keeps the show bill from ticking itself.
      done: (classCount > 0 && (scoringChosenCount > 0 || cardedClassCount > 0)) || highPointChosen,
    },
    // Before the show bill, which prints the health papers this step turns on —
    // the same reason Sanctioning and Futurities come before Fees. It is a step
    // at all because a manager building a show looks for "what do I require of
    // an exhibitor?" while they are building it; it keeps its desk address too,
    // because the answer is the desk's standing order and the people who revise
    // it are the people working registration. One screen, two doors.
    {
      key: 'paperwork',
      label: 'Paperwork',
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
      label: 'Show Bill',
      href: `/admin/shows/${showId}/setup/showbill`,
      done: showbillReady,
    },
  ];
  return steps.map((step, index) => ({
    ...step,
    label: `${index + 1}. ${step.label}`,
    // A skip counts only while the step is empty: somebody who skipped a step
    // and then set something up on it has changed their mind, and it comes back
    // without their having to undo the skip first. A step of two features is
    // skipped only once both are declined.
    skipped:
      skipKeysFor(step.key).length > 0 &&
      skipKeysFor(step.key).every((key) => skipped.has(key)) &&
      !step.done,
  }));
}

/**
 * Whether the show declined a feature that has a dashboard tile, and still has
 * none of it — what greys that tile out. Per feature, not per step: a show
 * running a futurity and no side pots declines only the pots.
 */
export function featureDeclined(input: WizardStepsInput, feature: DeclinableFeature): boolean {
  const inUse =
    feature === 'futurities'
      ? input.futurityCount > 0
      : feature === 'sidepots'
        ? input.sidePotCount > 0
        : input.highPointChosen;
  return !inUse && (input.skippedSteps ?? []).includes(feature);
}

/** The setup step that asks about each feature — where a greyed-out tile's
 *  *Change this in setup* link goes. */
export function featureStepHref(showId: string, feature: DeclinableFeature): string {
  return feature === 'highpoint'
    ? `/admin/shows/${showId}/classes/judging`
    : `/admin/shows/${showId}/futurities`;
}

/** "Step 7" — the number a step's title carries, from its position. */
export function stepNumber(steps: StepDef[], key: WizardStepKey): number {
  return steps.findIndex((s) => s.key === key) + 1;
}

/** The nearest step in a direction that has not been skipped — what Back and
 *  Next walk to, so a skipped step is not a stop on the way through. */
export function neighbourStep(
  steps: StepDef[],
  current: WizardStepKey,
  direction: 1 | -1,
): StepDef | null {
  const idx = steps.findIndex((s) => s.key === current);
  if (idx === -1) return null;
  for (let i = idx + direction; i >= 0 && i < steps.length; i += direction) {
    if (!steps[i].skipped) return steps[i];
  }
  return null;
}

export function nextStepHref(
  steps: StepDef[],
  current: WizardStepKey,
): string | null {
  const idx = steps.findIndex((s) => s.key === current);
  if (idx === -1 || idx === steps.length - 1) return null;
  return steps[idx + 1].href;
}
