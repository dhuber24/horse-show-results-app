/** "Step 2 of 3", a title and a line saying what the step is for. */
export default function StepHeading({
  step,
  total,
  title,
  blurb,
}: {
  step: number;
  total: number;
  title: string;
  blurb?: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Step {step} of {total}
      </p>
      <h2 className="text-lg font-bold mt-0.5" style={{ color: 'var(--foreground)' }}>
        {title}
      </h2>
      {blurb && (
        <p className="text-sm mt-1" style={{ color: 'var(--text-deep)' }}>
          {blurb}
        </p>
      )}
    </div>
  );
}
