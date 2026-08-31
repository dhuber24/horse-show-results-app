import { AphaShowMinimums } from '@/lib/apha';

/**
 * APHA SC-095.A — the classes a three-or-more-judge show must offer.
 *
 * A checklist, not a list of findings, for the reason the application window is
 * drawn on its own: it is still true when nothing is wrong. The backend raises
 * only the shortfalls that survive every reading of the rule, so what is printed
 * here is the evidence somebody checks by eye — especially the halter classes it
 * could not place, which is exactly where a wrong answer would hide.
 *
 * A pure render with no hooks, so it stays a server component.
 */

const COLORS = {
  text: '#2c1810',
  muted: '#8b7355',
  bg: '#faf6f0',
  body: '#5c3d1e',
  bad: '#b42318',
} as const;

function Found({ names, emptyIsBad }: { names: string[]; emptyIsBad: boolean }) {
  if (names.length === 0) {
    return (
      <span style={{ color: emptyIsBad ? COLORS.bad : COLORS.muted }}>
        {emptyIsBad ? 'none found' : 'none'}
      </span>
    );
  }
  const shown = names.slice(0, 4);
  return (
    <span style={{ color: COLORS.text }}>
      {names.length}
      <span style={{ color: COLORS.muted }}>
        {' — '}
        {shown.join(', ')}
        {names.length > shown.length ? `, +${names.length - shown.length} more` : ''}
      </span>
    </span>
  );
}

export default function AphaMinimums({ minimums }: { minimums: AphaShowMinimums }) {
  if (minimums.exempt_reason) {
    // Said separately from the judge count on purpose: "not required" and "under
    // three judges" are different answers, and only one of them changes if the
    // show adds a judge.
    return (
      <p className="text-xs" style={{ color: COLORS.muted }}>
        {minimums.exempt_reason}
      </p>
    );
  }

  if (!minimums.applies) {
    return (
      <p className="text-xs" style={{ color: COLORS.muted }}>
        SC-095.A&rsquo;s minimum class requirements apply at three or more judges. This
        show has {minimums.judge_count}.
      </p>
    );
  }

  return (
    <div className="rounded p-3 text-sm space-y-1" style={{ backgroundColor: COLORS.bg, color: COLORS.body }}>
      <p className="font-medium" style={{ color: COLORS.text }}>
        Minimum classes (SC-095.A) — {minimums.judge_count} judges
      </p>
      <p>
        <span className="text-xs" style={{ color: COLORS.muted }}>Open halter, Junior (2 &amp; under): </span>
        <Found names={minimums.open_junior_halter} emptyIsBad />
      </p>
      <p>
        <span className="text-xs" style={{ color: COLORS.muted }}>Open halter, Senior (3 &amp; over): </span>
        <Found names={minimums.open_senior_halter} emptyIsBad />
      </p>
      <p>
        <span className="text-xs" style={{ color: COLORS.muted }}>Open halter, age not stated: </span>
        <Found names={minimums.open_halter_unclassified} emptyIsBad={false} />
      </p>
      <p>
        <span className="text-xs" style={{ color: COLORS.muted }}>
          Performance contests, at most:{' '}
        </span>
        <span style={{ color: minimums.performance_upper_bound < minimums.required_performance ? COLORS.bad : COLORS.text }}>
          {minimums.performance_upper_bound}
        </span>
        <span className="text-xs" style={{ color: COLORS.muted }}>
          {' '}(of {minimums.required_performance} required)
        </span>
      </p>
      <p className="text-xs pt-1" style={{ color: COLORS.muted }}>
        Open division and the halter age split are read from each class name and its
        bracket, not from a column, so check the lists rather than trusting the
        counts. The performance figure counts every class that is not halter —
        SC-190.A decides what actually qualifies.
      </p>
    </div>
  );
}
