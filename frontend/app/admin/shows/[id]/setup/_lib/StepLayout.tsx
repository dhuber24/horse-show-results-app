import Breadcrumbs from '@/components/Breadcrumbs';
import WizardStepper, { type WizardStepKey } from '../../../_wizard/WizardStepper';
import {
  buildSteps,
  neighbourStep,
  skipKeysFor,
  stepName,
  stepNumber,
  type WizardStepsInput,
} from '../../../_wizard/steps';
import { StepAutosaveProvider, AutosaveNavLink } from './StepAutosave';
import { SkipStepOffer, SkippedStepNotice } from './SkipStep';

/** What a skipped step greys out on the show dashboard, where it has a tile. */
const DASHBOARD_TILES: Partial<Record<WizardStepKey, string>> = {
  futurities: 'the Futurities and Side Pots tiles',
  judgecards: 'the High Point tile',
};

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  bg: 'var(--surface)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
} as const;

const navButton = 'text-sm rounded px-3 py-2 border';

/**
 * What a step offers somebody it does not apply to.
 *
 * `label` is the press — it names the answer being given ("no club sanctioning"),
 * not the act of leaving, because *Skip* on its own reads as putting off a job
 * rather than as recording that there is none. `note` says what skipping costs,
 * which is the half a manager cannot work out from the screen.
 */
export type StepSkip = {
  label: string;
  note: string;
};

/**
 * The frame every setup step renders in: breadcrumbs, the title, the tab bar,
 * the step's own content, and the Back / Next footer.
 *
 * **A step that can be skipped says so at the top, before the form.** It used to
 * say it at the bottom, as one more button in a footer row that already held
 * Back, Setup hub and Next — so the manager who most needed it (this step is not
 * their show's business at all) found out only after reading the whole screen
 * for something to fill in, if they scrolled that far. Above the content is
 * where a "this may not apply to you" belongs.
 *
 * It is offered **only while the step is empty**, by the page: a show that has
 * set a futurity up is not skipping anything, and the control would then be
 * offering to walk past work already done. Which steps offer one at all is the
 * same test it always was — leaving it empty has to be a supported answer, so
 * Basics, the Class Builder and the Show Bill have none. A show with no classes
 * is not a show, and telling somebody otherwise in a button is worse than
 * silence.
 *
 * The skip goes to the same place the Next link does, and since migration 154
 * it is **recorded**: the step then folds away in the tab bar and the hub, and
 * Back and Next walk past it. Skipping Futurities & Side Pots declines both, and
 * greys both of their dashboard tiles out. Standing on a skipped step says so,
 * and offers it back.
 *
 * The title is numbered here, from the step's position, rather than typed into
 * each page — a hand-typed number drifted the first time a step was inserted.
 */
export default function StepLayout({
  showId,
  showName,
  current,
  title,
  subtitle,
  stepsInput,
  skip,
  children,
}: {
  showId: string;
  showName: string;
  current: WizardStepKey;
  title: string;
  subtitle: string;
  stepsInput: WizardStepsInput;
  skip?: StepSkip;
  children: React.ReactNode;
}) {
  const steps = buildSteps(stepsInput);
  const prev = neighbourStep(steps, current, -1);
  const next = neighbourStep(steps, current, 1);
  const isSkipped = steps.find((s) => s.key === current)?.skipped ?? false;
  const hubHref = `/admin/shows/${showId}/setup`;
  const number = stepNumber(steps, current);
  const heading = number > 0 ? `Step ${number}: ${title.replace(/^Step d+:s*/, '')}` : title;

  return (
    // Everything inside the step, the tab bar and the footer nav share one
    // autosave registry: a step's client registers what it has unsaved, and any
    // control that leaves writes it first. See StepAutosave.tsx.
    <StepAutosaveProvider>
      <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
        <div>
          <Breadcrumbs
            crumbs={[
              { label: 'Admin', href: '/admin' },
              { label: 'Shows', href: '/admin/shows' },
              { label: showName, href: `/admin/shows/${showId}` },
              { label: 'Setup', href: hubHref },
              { label: heading },
            ]}
          />
          <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
            {heading}
          </h1>
          <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
            {subtitle}
          </p>
        </div>

        <WizardStepper current={current} steps={steps} hubHref={hubHref} />

        {isSkipped ? (
          <SkippedStepNotice showId={showId} keys={skipKeysFor(current)} dashboardTiles={DASHBOARD_TILES[current]} />
        ) : (
          skip && (
            <SkipStepOffer
              showId={showId}
              keys={skipKeysFor(current)}
              nextHref={next?.href ?? `/admin/shows/${showId}`}
              label={skip.label}
              note={skip.note}
            />
          )
        )}

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
              ← Back to {stepName(prev.label)}
            </AutosaveNavLink>
          ) : (
            <span />
          )}
          {/* No *Setup hub* button here any more: the tab bar leads with **All
              steps**, which is the same destination through the same flush, and
              the footer is for walking the flow one step at a time. Which is
              also why the last step gets a way out rather than a lone Back —
              a wizard whose final screen only goes backwards is one people
              leave through the browser. */}
          <AutosaveNavLink
            href={next?.href ?? `/admin/shows/${showId}`}
            className="text-sm rounded px-4 py-2"
            style={{ backgroundColor: COLORS.warn, color: 'var(--surface)' }}
          >
            {next ? `${stepName(next.label)} →` : 'Done — back to the show →'}
          </AutosaveNavLink>
        </div>
      </main>
    </StepAutosaveProvider>
  );
}
