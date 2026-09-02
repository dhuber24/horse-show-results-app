'use client';

/**
 * Where you are in registering for a show.
 *
 * The exhibitor's answer to the stepper show managers get while setting a show
 * up (`admin/shows/_wizard/WizardStepper`), and deliberately the same shape:
 * numbered badges that tick over as each step is finished, the current one in
 * bold, the whole row scrolling sideways on a phone rather than wrapping into
 * something that reads as two rows of steps.
 *
 * It differs in one way that matters. The setup wizard's steps are separate
 * routes and every one of them is reachable at any time, because a show
 * manager genuinely can price the stalls before booking the judges. Here the
 * steps are gated — classes need a completed sign-up, sign-up needs a
 * finished profile — so a step ahead of the furthest one available is not a
 * link. It is not greyed out silently either: the reason is in the `title`,
 * and the step's own header says which section to fill in first, because
 * "you can't do this yet" without a destination is the kind of message people
 * read as a fault in the app.
 */

export type RegistrationStep = {
  key: string;
  /** Short enough to sit in a row of five on a phone. The section headers
   *  below carry the full wording. */
  label: string;
  done: boolean;
  /** False while an earlier step is unfinished. The step still renders; it
   *  just cannot be jumped to. */
  available: boolean;
  /** Why it cannot be reached yet, for the tooltip. */
  lockedReason?: string;
};

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  border: '#d4b896',
  active: '#5c3d1e',
  done: '#2f6b3f',
  locked: '#c9b394',
} as const;

export default function RegistrationStepper({
  steps,
  current,
  onSelect,
}: {
  steps: RegistrationStep[];
  current: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Registration steps" className="overflow-x-auto -mx-1 px-1">
      <ol className="flex items-center gap-2 text-sm whitespace-nowrap">
        {steps.map((step, idx) => {
          const isCurrent = step.key === current;
          const badgeColor = step.done
            ? COLORS.done
            : !step.available
              ? COLORS.locked
              : isCurrent
                ? COLORS.active
                : COLORS.muted;
          const content = (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold border"
                style={{ borderColor: badgeColor, color: '#fff', backgroundColor: badgeColor }}
              >
                {step.done ? '✓' : idx + 1}
              </span>
              <span
                style={{
                  color: isCurrent ? COLORS.text : step.available ? COLORS.muted : COLORS.locked,
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                {step.label}
              </span>
            </span>
          );
          return (
            <li key={step.key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelect(step.key)}
                disabled={!step.available}
                aria-current={isCurrent ? 'step' : undefined}
                title={
                  !step.available
                    ? step.lockedReason ?? 'Finish the steps before this one first'
                    : `Go to ${step.label.toLowerCase()}`
                }
                className="disabled:cursor-not-allowed"
              >
                {content}
              </button>
              {idx < steps.length - 1 && (
                <span aria-hidden style={{ color: COLORS.border }}>
                  ─
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
