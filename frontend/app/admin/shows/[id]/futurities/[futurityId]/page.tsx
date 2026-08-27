import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchShow } from '@/lib/api';
import Breadcrumbs from '@/components/Breadcrumbs';
import { loadFuturity } from '../loadFuturity';
import {
  COLORS,
  PricedClassWarning,
  formatCents,
  formatDate,
  formatDeadline,
  futurityCrumbs,
} from '../futurity-shared';
import DeleteFuturityButton from './DeleteFuturityButton';

/**
 * One futurity: what it is, what it charges, and buttons to the screens that do
 * the work. Same split as the side pot hub and Financials — the hub reads, the
 * sub-screens write.
 */

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: COLORS.muted }}>
        {label}
      </p>
      <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: COLORS.text }}>
        {value}
      </p>
      {detail && (
        <p className="text-xs mt-1" style={{ color: COLORS.muted }}>
          {detail}
        </p>
      )}
    </div>
  );
}

function Notice({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: COLORS.muted }}
      >
        {label}
      </p>
      <p className="whitespace-pre-wrap mt-1" style={{ color: COLORS.text }}>
        {body}
      </p>
    </div>
  );
}

function NavCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block p-5 rounded-lg border transition-colors hover:bg-amber-50"
      style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl" aria-hidden>
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
            {title}
          </h2>
          <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
            {description}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default async function FuturityPage({
  params,
}: {
  params: Promise<{ id: string; futurityId: string }>;
}) {
  const { id, futurityId } = await params;
  const [show, futurity] = await Promise.all([fetchShow(id), loadFuturity(id, futurityId)]);
  if (!futurity) notFound();

  const tierRange =
    futurity.fee_tiers.length === 0
      ? 'Not set'
      : futurity.fee_tiers.map((t) => formatCents(t.amount_cents)).join(' / ');

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <div>
        <Breadcrumbs crumbs={futurityCrumbs(id, show.name, futurity)} />
        <h1 className="text-2xl font-bold mt-2" style={{ color: COLORS.text }}>
          {futurity.name}
        </h1>
        {futurity.description && (
          <p className="text-sm mt-1" style={{ color: COLORS.muted }}>
            {futurity.description}
          </p>
        )}
      </div>

      <PricedClassWarning showId={id} classes={futurity.classes} />

      {futurity.fee_tiers.length === 0 && (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: '#c0392b', backgroundColor: '#fef0ef', color: '#922' }}
        >
          <strong>No entry fee categories yet.</strong> A futurity prices each class by
          the entrant&rsquo;s category, so entries are refused until at least one is set
          up in Settings.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Classes" value={String(futurity.classes.length)} />
        <Tile label="Entered" value={String(futurity.entry_count)} detail="horses" />
        <Tile label="Per class" value={tierRange} detail="by category" />
        <Tile
          label="Entries close"
          value={futurity.entry_deadline ? formatDate(futurity.entry_deadline) : 'Open'}
          detail={
            futurity.entry_deadline
              ? [
                  futurity.entry_deadline_time
                    ? formatDeadline(futurity).replace(
                        `${formatDate(futurity.entry_deadline)} `,
                        '',
                      )
                    : null,
                  futurity.late_fee_cents > 0
                    ? `then ${formatCents(futurity.late_fee_cents)}/class`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : undefined
          }
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <NavCard
          href={`/admin/shows/${id}/futurities/${futurityId}/settings`}
          icon="⚙️"
          title="Settings"
          description="The whole entry form: deadline, late fee, office fees, entry categories, club membership, classes, notices, and the release."
        />
        <NavCard
          href={`/admin/shows/${id}/futurities/${futurityId}/entries`}
          icon="🐴"
          title="Entries"
          description={`Enroll a horse, pick its category, and see what each one is charged. ${futurity.entry_count} entered.`}
        />
        <NavCard
          href={`/admin/shows/${id}/futurities/${futurityId}/hi-point`}
          icon="🏆"
          title="Hi-Point divisions"
          description={
            futurity.divisions.length === 0
              ? 'Set up the award brackets, what the champion and reserve win, and which classes count toward each.'
              : `${futurity.divisions.length} set up: ${futurity.divisions.map((d) => d.name).join(', ')}.`
          }
        />
        <NavCard
          href={`/admin/shows/${id}/futurities/${futurityId}/standings`}
          icon="📋"
          title="Standings"
          description="Hi-Point standings per division, computed from the placings on file."
        />
      </div>

      {/* The entry form as it will be published. Kept on the hub rather than
          buried in Settings: the office reads it back far more often than it
          edits it, and a notice nobody can see without opening an editor is a
          notice that quietly goes stale. */}
      {(futurity.award_notice ||
        futurity.rules_notice ||
        futurity.entry_instructions ||
        futurity.refund_policy ||
        futurity.membership_options.length > 0 ||
        futurity.waivers.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
            On the entry form
          </h2>
          <div
            className="rounded-lg border p-4 space-y-3 text-sm"
            style={{ borderColor: COLORS.border, backgroundColor: COLORS.bg }}
          >
            {futurity.award_notice && (
              <Notice label="Awards" body={futurity.award_notice} />
            )}
            {futurity.rules_notice && (
              <Notice label="Rules" body={futurity.rules_notice} />
            )}
            {futurity.entry_instructions && (
              <Notice label="Entry instructions" body={futurity.entry_instructions} />
            )}
            {futurity.membership_options.length > 0 && (
              <div>
                <p
                  className="text-xs font-medium uppercase tracking-wide"
                  style={{ color: COLORS.muted }}
                >
                  Club membership offered
                </p>
                <ul className="mt-1">
                  {futurity.membership_options.map((m) => (
                    <li key={m.id} style={{ color: COLORS.text }}>
                      {m.name} — {formatCents(m.amount_cents)}
                      {m.description && (
                        <span className="text-xs" style={{ color: COLORS.muted }}>
                          {' '}
                          · {m.description}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {futurity.refund_policy && (
              <Notice label="Refunds" body={futurity.refund_policy} />
            )}
            {futurity.waivers.map((w) => (
              <div key={w.id}>
                <p
                  className="text-xs font-medium uppercase tracking-wide"
                  style={{ color: COLORS.muted }}
                >
                  {w.title}
                  {w.is_required ? ' · required' : ' · optional'} ·{' '}
                  {w.signature_count} signed
                </p>
                <p className="whitespace-pre-wrap mt-1" style={{ color: COLORS.text }}>
                  {w.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold" style={{ color: COLORS.text }}>
          Classes
        </h2>
        {futurity.classes.length === 0 ? (
          <p className="text-sm" style={{ color: COLORS.muted }}>
            No classes assigned yet — add them in Settings.
          </p>
        ) : (
          <ul className="text-sm space-y-1">
            {futurity.classes.map((c) => (
              <li key={c.class_id} style={{ color: COLORS.text }}>
                <span className="font-mono text-xs">#{c.class_number}</span>{' '}
                {c.class_name}{' '}
                <span className="text-xs" style={{ color: COLORS.muted }}>
                  · {formatDate(c.class_date)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeleteFuturityButton
        showId={id}
        futurityId={futurityId}
        name={futurity.name}
        entryCount={futurity.entry_count}
      />
    </main>
  );
}
