import Link from 'next/link';
import { auth } from '@/auth';
import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL } from '@/lib/backend-fetch';
import ShowStatusControl from './ShowStatusControl';
import { registrationAnswered } from '@/lib/registration-window';
import Breadcrumbs from '@/components/Breadcrumbs';
import ValidationIssues, { ValidationResult } from '@/components/ValidationIssues';
import AphaMinimums from './AphaMinimums';
import { featureDeclined, featureStepHref } from '../_wizard/steps';
import { fetchStepCounts } from './setup/_lib/fetchStepCounts';
import { showSections, type ShowSection as Tile } from './sections';
import {
  APPLICATION_BANDS,
  APPLICATION_BASIS_LABELS,
  RESULTS_BANDS,
  AphaApplicationWindow,
  AphaResultsWindow,
  AphaShowMinimums,
} from '@/lib/apha';

/**
 * A tile whose setup step was skipped (migration 154): the show said it does not
 * use this. Greyed out and not a link, like a disabled Score Classes, so the
 * dashboard stops offering something the show has declined — with the one way
 * back named on the tile, since the setup step is where that decision lives.
 */
function SkippedTile({ tile, stepHref }: { tile: Tile; stepHref: string }) {
  const reason = `Skipped in setup — this show does not use ${tile.title === 'High Point' ? 'a high point' : tile.title.toLowerCase()}.`;
  return (
    <div
      className="block p-6 rounded-lg border border-dashed cursor-not-allowed"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}
      aria-disabled="true"
      title={reason}
    >
      <div className="flex items-start gap-4">
        <div className="text-3xl opacity-40" aria-hidden>{tile.icon}</div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--muted)' }}>
            {tile.title}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            {reason}
          </p>
          <Link
            href={stepHref}
            className="inline-block text-sm mt-2 hover:underline cursor-pointer"
            style={{ color: 'var(--accent)' }}
          >
            Change this in setup →
          </Link>
        </div>
      </div>
    </div>
  );
}

function ScoringTile({ tile, status }: { tile: Tile; status: string }) {
  if (status === 'ACTIVE') {
    return (
      <Link
        href={tile.href}
        className="block p-6 rounded-lg border transition-colors hover:bg-amber-50"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      >
        <div className="flex items-start gap-4">
          <div className="text-3xl" aria-hidden>{tile.icon}</div>
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>
              {tile.title}
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {tile.description}
            </p>
          </div>
        </div>
      </Link>
    );
  }

  // Not active: shown disabled rather than omitted, so the tile is never
  // simply missing — the explanation is the reason to reach for the status
  // control above instead of a dead end.
  const reason =
    status === 'COMPLETED'
      ? 'Scoring is closed — this show is marked Completed.'
      : 'Set the show to "In Progress" above to enable scoring.';
  return (
    <div
      className="block p-6 rounded-lg border cursor-not-allowed"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-subtle)' }}
      aria-disabled="true"
      title={reason}
    >
      <div className="flex items-start gap-4">
        <div className="text-3xl opacity-40" aria-hidden>{tile.icon}</div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--muted)' }}>
            {tile.title}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            {reason}
          </p>
        </div>
      </div>
    </div>
  );
}

// Both readiness endpoints return the same shape, which is why the issue list
// is one component. APHA adds the SC-090 application window on top, because a
// countdown is not a finding — it is still true when nothing is wrong.
type AphaValidationData = ValidationResult & {
  application_window: AphaApplicationWindow | null;
  minimums: AphaShowMinimums | null;
  category_requirements: string[];
  results_window: AphaResultsWindow | null;
  results_requirements: string[];
};

async function fetchScribeNames(
  showId: string,
  headers: Record<string, string>,
): Promise<string[]> {
  const res = await fetch(`${API_URL}/shows/${showId}/scribes`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const rows: { full_name: string }[] = await res.json();
  return rows.map((r) => r.full_name);
}

async function getAssociationValidation(
  showId: string,
  association: 'aqha' | 'apha',
  headers: Record<string, string>,
) {
  const res = await fetch(`${API_URL}/shows/${showId}/${association}-validation`, {
    headers,
    cache: 'no-store',
  });
  return res.ok ? res.json() : null;
}

export default async function AdminShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, classes, stepCounts] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchStepCounts(id),
  ]);
  // Read the way the wizard reads it -- declined, and still none set up -- so a
  // tile is greyed out exactly when the setup step says the show has declined it.
  const declined = (feature: Tile['feature']) => (feature ? featureDeclined(stepCounts, feature) : false);
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const isAdmin = user?.role === 'ADMIN';
  const isShowAdmin = user?.role === 'SHOW_SECRETARY';

  let scribeNames: string[] = [];
  let aqhaValidation: ValidationResult | null = null;
  let aphaValidation: AphaValidationData | null = null;
  if ((isAdmin || isShowAdmin) && user?.id) {
    const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': INTERNAL_API_KEY,
      'X-User-Id': user.id,
      'X-User-Role': user.role ?? '',
    };
    scribeNames = await fetchScribeNames(id, headers);
    if (show.show_type_code === 'AQHA') {
      aqhaValidation = await getAssociationValidation(id, 'aqha', headers);
    } else if (show.show_type_code === 'APHA') {
      aphaValidation = await getAssociationValidation(id, 'apha', headers);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8">
      <div>
        <Breadcrumbs crumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Shows', href: '/admin/shows' },
          { label: show.name },
        ]} />
        <div className="flex items-center gap-2 mt-2">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{show.name}</h1>
          {show.show_type_code && (
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {show.show_type_code}
            </span>
          )}
        </div>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          📍 {show.venue} · 📅 {show.start_date} – {show.end_date}
        </p>
        <div className="mt-2">
          <ShowStatusControl
            showId={id}
            currentStatus={show.status}
            classCount={classes.length}
            startDate={show.start_date}
            endDate={show.end_date}
            venueId={show.venue_id ?? null}
            registrationAnswered={registrationAnswered(show)}
          />
        </div>
        {(isAdmin || isShowAdmin) && (
          <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
            {scribeNames.length > 0 ? (
              <>Scribes: {scribeNames.join(' · ')}</>
            ) : (
              <>
                No scribes assigned yet —{' '}
                <Link
                  href={`/admin/shows/${id}/edit`}
                  className="underline"
                  style={{ color: 'var(--accent)' }}
                >
                  manage staff
                </Link>
                .
              </>
            )}
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 desktop:grid-cols-3 gap-4">
        {showSections(id).map((tile) => tile.scoring ? (
          <ScoringTile key={tile.href} tile={tile} status={show.status} />
        ) : declined(tile.feature) ? (
          <SkippedTile key={tile.href} tile={tile} stepHref={featureStepHref(id, tile.feature!)} />
        ) : (
          <Link
            key={tile.href}
            href={tile.href}
            {...(tile.newTab ? { target: '_blank', rel: 'noopener' } : {})}
            className="block p-6 rounded-lg border transition-colors hover:bg-amber-50"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <div className="flex items-start gap-4">
              <div className="text-3xl" aria-hidden>{tile.icon}</div>
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--foreground)' }}>
                  {tile.title}
                </h2>
                <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                  {tile.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {show.show_type_code === 'APHA' && (
        <div className="border rounded-lg p-4" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-semibold mb-2" style={{ color: 'var(--foreground)' }}>APHA Submission</h2>
          {show.apha_show_number ? (
            <div className="flex items-center gap-4">
              <span className="text-sm" style={{ color: 'var(--muted)' }}>
                Show #: <span className="font-mono font-medium" style={{ color: 'var(--foreground)' }}>{show.apha_show_number}</span>
              </span>
              <a
                href={`/api/shows/${id}/apha-export`}
                download
                className="px-4 py-2 rounded text-sm font-medium"
                style={{ backgroundColor: 'var(--foreground)', color: 'var(--bg-subtle)' }}
              >
                Export APHA Results (CSV)
              </a>
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Set the APHA Show Number in{' '}
              <a href={`/admin/shows/${id}/edit`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                Edit Show Details
              </a>{' '}
              to enable export.
            </p>
          )}
        </div>
      )}

      {show.show_type_code === 'AQHA' && (
        <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>AQHA Approval</h2>
            <span className="text-xs font-mono px-2 py-1 rounded bg-amber-100 text-amber-800">
              {show.aqha_approval_status ?? 'NOT_SUBMITTED'}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <p>
              Show #: <span className="font-mono" style={{ color: 'var(--foreground)' }}>{show.aqha_show_number || 'Not assigned'}</span>
            </p>
            <p>
              Submitted: <span style={{ color: 'var(--foreground)' }}>{show.aqha_approval_submitted_at || 'Not submitted'}</span>
            </p>
          </div>
          {show.aqha_approval_notes && (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{show.aqha_approval_notes}</p>
          )}
          <div className="rounded p-3 text-sm" style={{ backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}>
            AQHA approval readiness: venue selected, class schedule built, AQHA class codes assigned, judge/show details confirmed, and show bill submitted with approval.
          </div>
          {aqhaValidation && <ValidationIssues label="AQHA validation" data={aqhaValidation} />}
          <a href={`/admin/shows/${id}/edit`} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
            Update AQHA approval details
          </a>
        </div>
      )}

      {show.show_type_code === 'APHA' && (
        <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold" style={{ color: 'var(--foreground)' }}>APHA Approval</h2>
            {/* APHA issues the show number on approval, and the results export
                refuses without it, so its presence is the closest thing the app
                holds to an approval flag. */}
            <span
              className="text-xs font-mono px-2 py-1 rounded"
              style={
                show.apha_show_number
                  ? { backgroundColor: 'var(--success-bg)', color: 'var(--success)' }
                  : { backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }
              }
            >
              {show.apha_show_number ? `SHOW #${show.apha_show_number}` : 'NO SHOW NUMBER'}
            </span>
          </div>

          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {show.show_category
              ? `${show.show_category.name} (${show.show_category.rule_reference ?? 'SC-105'})`
              : 'Kind of show not stated'}
            {show.offers_clinic ? ' · clinic alongside' : ''}
          </p>

          {aphaValidation?.application_window && (
            <div className="rounded p-3 text-sm" style={{ backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}>
              <div className="grid sm:grid-cols-3 gap-2">
                <p>
                  <span className="block text-xs" style={{ color: 'var(--muted)' }}>Application due</span>
                  <span className="font-mono">{aphaValidation.application_window.standard_deadline}</span>
                </p>
                <p>
                  <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                    Counted to the {APPLICATION_BASIS_LABELS[aphaValidation.application_window.basis]}
                  </span>
                  <span className="font-mono">{aphaValidation.application_window.basis_date}</span>
                </p>
                <p>
                  <span className="block text-xs" style={{ color: 'var(--muted)' }}>Days remaining</span>
                  <span className="font-mono">{aphaValidation.application_window.days_remaining}</span>
                </p>
              </div>
              <p
                className="mt-2 font-medium"
                style={{
                  color:
                    APPLICATION_BANDS[aphaValidation.application_window.band].tone === 'bad'
                      ? 'var(--error)'
                      : APPLICATION_BANDS[aphaValidation.application_window.band].tone === 'warn'
                        ? 'var(--warning)'
                        : 'var(--success)',
                }}
              >
                {APPLICATION_BANDS[aphaValidation.application_window.band].label}
              </p>
              {aphaValidation.application_window.basis === 'start_date' && (
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Counted from the show date because no entry deadline is set. SC-090.C
                  measures from the entry deadline where that comes first, so the real
                  cutoff may be earlier than this — set it on the show details.
                </p>
              )}
            </div>
          )}

          {aphaValidation?.minimums && <AphaMinimums minimums={aphaValidation.minimums} />}

          {/* SC-125. Rendered only once the show's last day has passed, which is
              also when `results_window` starts being non-null: before then there
              is nothing to file, and eight lines about submission would sit on
              the dashboard for eleven months teaching people to skip the panel. */}
          {aphaValidation?.results_window && (
            <div className="rounded p-3 text-sm space-y-1" style={{ backgroundColor: 'var(--background)', color: 'var(--text-deep)' }}>
              <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                Filing the results (SC-125)
              </p>
              <p>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>Due </span>
                <span className="font-mono">{aphaValidation.results_window.due}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {' '}·{' '}
                  {aphaValidation.results_window.days_remaining >= 0
                    ? `${aphaValidation.results_window.days_remaining} days left`
                    : `${-aphaValidation.results_window.days_remaining} days ago`}
                </span>
              </p>
              <p
                className="font-medium"
                style={{
                  color:
                    RESULTS_BANDS[aphaValidation.results_window.band].tone === 'bad'
                      ? 'var(--error)'
                      : RESULTS_BANDS[aphaValidation.results_window.band].tone === 'warn'
                        ? 'var(--warning)'
                        : 'var(--success)',
                }}
              >
                {RESULTS_BANDS[aphaValidation.results_window.band].label}
              </p>
              <ul className="space-y-1 list-disc pl-4 pt-1">
                {aphaValidation.results_requirements.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
              <p className="text-xs pt-1" style={{ color: 'var(--muted)' }}>
                The app cannot see a postmark. This is the calendar, not a claim
                that anything is outstanding.
              </p>
            </div>
          )}

          {aphaValidation && <ValidationIssues label="APHA readiness" data={aphaValidation} />}

          {/* SC-100 / SC-105 conditions the app cannot check — regional club
              sponsorship, the per-year caps, clinician approval. Text rather
              than findings: an item nobody can ever clear would train the office
              to scroll past the list above it. */}
          {aphaValidation && aphaValidation.category_requirements.length > 0 && (
            <div className="rounded p-3 text-sm space-y-1" style={{ backgroundColor: 'var(--background)' }}>
              <p className="font-medium" style={{ color: 'var(--foreground)' }}>
                Not checked here
              </p>
              <ul className="space-y-1 list-disc pl-4" style={{ color: 'var(--text-deep)' }}>
                {aphaValidation.category_requirements.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Read-only. Nothing here is filed with APHA, and none of it is verified
            against APHA&rsquo;s records — the approved-judge list and the approval
            itself are theirs.
          </p>
          <a href={`/admin/shows/${id}/edit`} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
            Update APHA show details
          </a>
        </div>
      )}

    </main>
  );
}
