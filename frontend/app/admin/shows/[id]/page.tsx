import Link from 'next/link';
import { auth } from '@/auth';
import { fetchShow, fetchClasses } from '@/lib/api';
import { API_URL } from '@/lib/backend-fetch';
import ShowStatusControl from './ShowStatusControl';
import Breadcrumbs from '@/components/Breadcrumbs';
import ValidationIssues, { ValidationResult } from '@/components/ValidationIssues';
import AphaMinimums from './AphaMinimums';
import {
  APPLICATION_BANDS,
  APPLICATION_BASIS_LABELS,
  RESULTS_BANDS,
  AphaApplicationWindow,
  AphaResultsWindow,
  AphaShowMinimums,
} from '@/lib/apha';

const tiles = (showId: string) => [
  // Staff and the class schedule were tiles of their own. Both are things you
  // set up once, before the show runs, so both are steps of the setup wizard —
  // staff in Step 1 next to the dates, classes in Step 6.
  {
    href: `/admin/shows/${showId}/setup`,
    title: 'Setup',
    description:
      'Basics and staff, judges, sanctioning, lodging, fees, classes, and paperwork — the setup wizard.',
    icon: '🎪',
  },
  // Entries, back numbers, and paperwork check-in were three tiles and three
  // screens; they are one conversation at the counter, so they are one tile and
  // one screen. The old routes redirect here.
  {
    href: `/admin/shows/${showId}/desk`,
    title: 'Registration Desk',
    description: 'Back numbers, class entries, side pot buy-ins, and paperwork check-in — one exhibitor at a time.',
    icon: '🎟️',
  },
  {
    href: `/admin/shows/${showId}/side-pots`,
    title: 'Side Pots',
    description: 'Divisional jackpots spanning several classes — buy-ins, standings, and payouts.',
    icon: '💰',
  },
  {
    href: `/admin/shows/${showId}/futurities`,
    title: 'Futurities',
    description:
      'Futurity classes, entry fee categories, entries, and Hi-Point award divisions.',
    icon: '🌟',
  },
  {
    href: `/admin/shows/${showId}/financials`,
    title: 'Financials',
    description: 'Registrations, revenue, outstanding balances, and reports.',
    icon: '💵',
  },
  // What the office sends the association afterwards. Its own tile rather than
  // a link under Financials: these reports are the record of what happened —
  // placings, entries, judges' cards, compliance — and none of them are money.
  {
    href: `/admin/shows/${showId}/reports`,
    title: 'Show Record',
    description:
      'Results, entry cards, judges’ cards and the compliance sheet — what the office sends on, plus the one-year retention bundle.',
    icon: '📁',
  },
  {
    href: `/admin/shows/${showId}/messages`,
    title: 'Messages',
    description: 'Questions sent from the show page, including from people without an account.',
    icon: '✉️',
  },
];

const scoringTile = (showId: string) => ({
  href: `/shows/${showId}`,
  title: 'Score Classes',
  description: 'Enter placings for each class.',
  icon: '🏆',
});

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

/** Just the badge number — the dashboard has no business pulling every
 *  message body to render a count. */
async function fetchUnreadMessageCount(
  showId: string,
  headers: Record<string, string>,
): Promise<number> {
  const res = await fetch(`${API_URL}/shows/${showId}/contact/messages/unread-count`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) return 0;
  const json = await res.json();
  return json.unread ?? 0;
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
  const [show, classes] = await Promise.all([fetchShow(id), fetchClasses(id)]);
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const isAdmin = user?.role === 'ADMIN';
  const isShowAdmin = user?.role === 'SHOW_SECRETARY';

  let scribeNames: string[] = [];
  let aqhaValidation: ValidationResult | null = null;
  let aphaValidation: AphaValidationData | null = null;
  let unreadMessages = 0;
  if ((isAdmin || isShowAdmin) && user?.id) {
    const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': INTERNAL_API_KEY,
      'X-User-Id': user.id,
      'X-User-Role': user.role ?? '',
    };
    [scribeNames, unreadMessages] = await Promise.all([
      fetchScribeNames(id, headers),
      fetchUnreadMessageCount(id, headers),
    ]);
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
          <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
          {show.show_type_code && (
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              {show.show_type_code}
            </span>
          )}
        </div>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
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
          />
        </div>
        {(isAdmin || isShowAdmin) && (
          <p className="text-sm mt-2" style={{ color: '#8b7355' }}>
            {scribeNames.length > 0 ? (
              <>Scribes: {scribeNames.join(' · ')}</>
            ) : (
              <>
                No scribes assigned yet —{' '}
                <Link
                  href={`/admin/shows/${id}/edit`}
                  className="underline"
                  style={{ color: '#8b4513' }}
                >
                  manage staff
                </Link>
                .
              </>
            )}
          </p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {tiles(id).map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="block p-6 rounded-lg border transition-colors hover:bg-amber-50"
            style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
          >
            <div className="flex items-start gap-4">
              <div className="text-3xl" aria-hidden>{tile.icon}</div>
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: '#2c1810' }}>
                  {tile.title}
                  {tile.title === 'Messages' && unreadMessages > 0 && (
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
                    >
                      {unreadMessages} new
                    </span>
                  )}
                </h2>
                <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
                  {tile.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
        {show.status === 'ACTIVE' && (() => {
          const tile = scoringTile(id);
          return (
            <Link
              href={tile.href}
              className="block p-6 rounded-lg border transition-colors hover:opacity-90"
              style={{ borderColor: '#2c1810', backgroundColor: '#2c1810' }}
            >
              <div className="flex items-start gap-4">
                <div className="text-3xl" aria-hidden>{tile.icon}</div>
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: '#f5ede0' }}>
                    {tile.title}
                  </h2>
                  <p className="text-sm mt-1" style={{ color: '#d4b896' }}>
                    {tile.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })()}
      </div>

      {show.show_type_code === 'APHA' && (
        <div className="border rounded-lg p-4" style={{ borderColor: '#d4b896' }}>
          <h2 className="font-semibold mb-2" style={{ color: '#2c1810' }}>APHA Submission</h2>
          {show.apha_show_number ? (
            <div className="flex items-center gap-4">
              <span className="text-sm" style={{ color: '#8b7355' }}>
                Show #: <span className="font-mono font-medium" style={{ color: '#2c1810' }}>{show.apha_show_number}</span>
              </span>
              <a
                href={`/api/shows/${id}/apha-export`}
                download
                className="px-4 py-2 rounded text-sm font-medium"
                style={{ backgroundColor: '#2c1810', color: '#f5ede0' }}
              >
                Export APHA Results (CSV)
              </a>
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#8b7355' }}>
              Set the APHA Show Number in{' '}
              <a href={`/admin/shows/${id}/edit`} className="hover:underline" style={{ color: '#8b4513' }}>
                Edit Show Details
              </a>{' '}
              to enable export.
            </p>
          )}
        </div>
      )}

      {show.show_type_code === 'AQHA' && (
        <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold" style={{ color: '#2c1810' }}>AQHA Approval</h2>
            <span className="text-xs font-mono px-2 py-1 rounded bg-amber-100 text-amber-800">
              {show.aqha_approval_status ?? 'NOT_SUBMITTED'}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-sm" style={{ color: '#8b7355' }}>
            <p>
              Show #: <span className="font-mono" style={{ color: '#2c1810' }}>{show.aqha_show_number || 'Not assigned'}</span>
            </p>
            <p>
              Submitted: <span style={{ color: '#2c1810' }}>{show.aqha_approval_submitted_at || 'Not submitted'}</span>
            </p>
          </div>
          {show.aqha_approval_notes && (
            <p className="text-sm" style={{ color: '#8b7355' }}>{show.aqha_approval_notes}</p>
          )}
          <div className="rounded p-3 text-sm" style={{ backgroundColor: '#faf6f0', color: '#5c3d1e' }}>
            AQHA approval readiness: venue selected, class schedule built, AQHA class codes assigned, judge/show details confirmed, and show bill submitted with approval.
          </div>
          {aqhaValidation && <ValidationIssues label="AQHA validation" data={aqhaValidation} />}
          <a href={`/admin/shows/${id}/edit`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
            Update AQHA approval details
          </a>
        </div>
      )}

      {show.show_type_code === 'APHA' && (
        <div className="border rounded-lg p-4 space-y-3" style={{ borderColor: '#d4b896' }}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold" style={{ color: '#2c1810' }}>APHA Approval</h2>
            {/* APHA issues the show number on approval, and the results export
                refuses without it, so its presence is the closest thing the app
                holds to an approval flag. */}
            <span
              className="text-xs font-mono px-2 py-1 rounded"
              style={
                show.apha_show_number
                  ? { backgroundColor: '#e6f2e9', color: '#2f6b3f' }
                  : { backgroundColor: '#fef3c7', color: '#92400e' }
              }
            >
              {show.apha_show_number ? `SHOW #${show.apha_show_number}` : 'NO SHOW NUMBER'}
            </span>
          </div>

          <p className="text-sm" style={{ color: '#8b7355' }}>
            {show.show_category
              ? `${show.show_category.name} (${show.show_category.rule_reference ?? 'SC-105'})`
              : 'Kind of show not stated'}
            {show.offers_clinic ? ' · clinic alongside' : ''}
          </p>

          {aphaValidation?.application_window && (
            <div className="rounded p-3 text-sm" style={{ backgroundColor: '#faf6f0', color: '#5c3d1e' }}>
              <div className="grid sm:grid-cols-3 gap-2">
                <p>
                  <span className="block text-xs" style={{ color: '#8b7355' }}>Application due</span>
                  <span className="font-mono">{aphaValidation.application_window.standard_deadline}</span>
                </p>
                <p>
                  <span className="block text-xs" style={{ color: '#8b7355' }}>
                    Counted to the {APPLICATION_BASIS_LABELS[aphaValidation.application_window.basis]}
                  </span>
                  <span className="font-mono">{aphaValidation.application_window.basis_date}</span>
                </p>
                <p>
                  <span className="block text-xs" style={{ color: '#8b7355' }}>Days remaining</span>
                  <span className="font-mono">{aphaValidation.application_window.days_remaining}</span>
                </p>
              </div>
              <p
                className="mt-2 font-medium"
                style={{
                  color:
                    APPLICATION_BANDS[aphaValidation.application_window.band].tone === 'bad'
                      ? '#b42318'
                      : APPLICATION_BANDS[aphaValidation.application_window.band].tone === 'warn'
                        ? '#92400e'
                        : '#2f6b3f',
                }}
              >
                {APPLICATION_BANDS[aphaValidation.application_window.band].label}
              </p>
              {aphaValidation.application_window.basis === 'start_date' && (
                <p className="text-xs mt-1" style={{ color: '#8b7355' }}>
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
            <div className="rounded p-3 text-sm space-y-1" style={{ backgroundColor: '#faf6f0', color: '#5c3d1e' }}>
              <p className="font-medium" style={{ color: '#2c1810' }}>
                Filing the results (SC-125)
              </p>
              <p>
                <span className="text-xs" style={{ color: '#8b7355' }}>Due </span>
                <span className="font-mono">{aphaValidation.results_window.due}</span>
                <span className="text-xs" style={{ color: '#8b7355' }}>
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
                      ? '#b42318'
                      : RESULTS_BANDS[aphaValidation.results_window.band].tone === 'warn'
                        ? '#92400e'
                        : '#2f6b3f',
                }}
              >
                {RESULTS_BANDS[aphaValidation.results_window.band].label}
              </p>
              <ul className="space-y-1 list-disc pl-4 pt-1">
                {aphaValidation.results_requirements.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
              <p className="text-xs pt-1" style={{ color: '#8b7355' }}>
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
            <div className="rounded p-3 text-sm space-y-1" style={{ backgroundColor: '#faf6f0' }}>
              <p className="font-medium" style={{ color: '#2c1810' }}>
                Not checked here
              </p>
              <ul className="space-y-1 list-disc pl-4" style={{ color: '#5c3d1e' }}>
                {aphaValidation.category_requirements.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs" style={{ color: '#8b7355' }}>
            Read-only. Nothing here is filed with APHA, and none of it is verified
            against APHA&rsquo;s records — the approved-judge list and the approval
            itself are theirs.
          </p>
          <a href={`/admin/shows/${id}/edit`} className="text-sm hover:underline" style={{ color: '#8b4513' }}>
            Update APHA show details
          </a>
        </div>
      )}

    </main>
  );
}
