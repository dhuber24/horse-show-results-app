import { unitLabel } from '@/lib/fee-units';
import { AutosaveNavLink } from '../_lib/StepAutosave';
import {
  formatCents,
  formatDeadline,
  type Futurity,
} from '../../futurities/futurity-shared';

/** One club on the show, as `GET /shows/{id}/classes/sanctioning` returns it —
 *  the rate and the classes it approves together, which is the pair that has
 *  to exist before the fee charges anybody. */
export type ClubFee = {
  association_id: string;
  code: string;
  name: string;
  fee_amount_cents: number;
  fee_unit: string;
  class_ids: string[];
};

const COLORS = {
  text: 'var(--foreground)',
  muted: 'var(--muted)',
  border: 'var(--border)',
  bg: 'var(--surface)',
  accent: 'var(--accent)',
  warn: 'var(--text-deep)',
  warnSoft: 'var(--warning-bg)',
} as const;

/**
 * What the two steps before this one already charge, read-only.
 *
 * Sanctioning and Futurities come ahead of Fees so that arriving here shows the
 * whole of what an exhibitor will be billed rather than a third of it. Those
 * fees are still *set* where they are decided — a club's rate beside the
 * classes it approves, a futurity's categories beside its deadline — so this
 * quotes them and links back rather than offering a second place to edit the
 * same number. The links leave through `AutosaveNavLink`, so anything unsaved
 * in the Class Fees box below is written first, the same as the footer's.
 */
export default function EarlierFees({
  showId,
  clubs,
  futurities,
}: {
  showId: string;
  clubs: ClubFee[];
  futurities: Futurity[];
}) {
  return (
    <section
      className="p-4 rounded-lg border space-y-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: COLORS.text }}>
          Already priced in earlier steps
        </h2>
        <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
          Charged on top of the class fees below. Change them on their own step.
        </p>
      </div>

      <div className="space-y-2">
        <Heading
          title="Club sanction fees"
          href={`/admin/shows/${showId}/setup/sanctioning`}
          linkLabel="Edit in Step 5: Sanctioning"
        />
        {clubs.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No club sanctions this show.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {clubs.map((club) => (
              <li key={club.association_id} className="text-sm" style={{ color: COLORS.text }}>
                <span className="font-medium">{club.code}</span>
                {club.name && club.name !== club.code && (
                  <span style={{ color: COLORS.muted }}> — {club.name}</span>
                )}
                <span>
                  {' · '}
                  {club.fee_amount_cents > 0
                    ? `${formatCents(club.fee_amount_cents)} ${unitLabel(club.fee_unit)}`
                    : 'no fee set'}
                </span>
                <span style={{ color: COLORS.muted }}>
                  {' · '}
                  {club.class_ids.length === 0
                    ? 'no approved classes ticked, so it charges nobody yet'
                    : `on its ${club.class_ids.length} approved class${club.class_ids.length === 1 ? '' : 'es'}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Heading
          title="Futurity pricing"
          href={`/admin/shows/${showId}/futurities`}
          linkLabel="Edit in Step 6: Futurities"
        />
        {futurities.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No futurity on this show.
          </p>
        ) : (
          <ul className="space-y-3">
            {futurities.map((futurity) => (
              <li key={futurity.id} className="text-sm space-y-0.5" style={{ color: COLORS.text }}>
                <p className="font-medium">
                  {futurity.name}
                  <span className="font-normal" style={{ color: COLORS.muted }}>
                    {' · '}
                    {futurity.classes.length} class{futurity.classes.length === 1 ? '' : 'es'}
                    {' · '}entries close {formatDeadline(futurity)}
                  </span>
                </p>
                <p>
                  {futurity.fee_tiers.length === 0
                    ? 'No entry categories yet — it cannot take an entry until it has one.'
                    : futurity.fee_tiers
                        .slice()
                        .sort((a, b) => a.sort_order - b.sort_order)
                        .map((tier) => `${tier.name} ${formatCents(tier.amount_cents)}`)
                        .join(' · ') + ' per class'}
                </p>
                <p style={{ color: COLORS.muted }}>
                  Office fee {formatCents(futurity.office_fee_member_cents)} members /{' '}
                  {formatCents(futurity.office_fee_nonmember_cents)} non-members per horse
                  {futurity.late_fee_cents > 0 &&
                    ` · late fee ${formatCents(futurity.late_fee_cents)} per class after the deadline`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Heading({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 flex-wrap">
      <h3 className="text-sm font-semibold" style={{ color: COLORS.text }}>
        {title}
      </h3>
      <AutosaveNavLink href={href} className="text-xs hover:underline" style={{ color: COLORS.accent }}>
        {linkLabel} →
      </AutosaveNavLink>
    </div>
  );
}
