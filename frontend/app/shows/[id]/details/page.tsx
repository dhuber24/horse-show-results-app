import Link from 'next/link';
import { fetchShow } from '@/lib/api';
import { unitLabel } from '@/lib/fee-units';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';

/**
 * The show, described.
 *
 * One page, one audience, nothing personal on it. A spectator arriving from the
 * at-the-rail hub and an exhibitor arriving from their show menu are asking the
 * same question here — what is this show, where and when is it, who sanctions
 * it — and none of that depends on who is reading.
 *
 * It briefly carried the reader's own balance and a button to their entries.
 * Both belong with the reader, not with the show: *What I Owe* is a tile on the
 * show menu, and everything about a registration is on the registration screen,
 * which is now one screen rather than two.
 *
 * The **show bill** — judges, the class schedule, the fee schedule and the
 * rules — is not on this page. It was, embedded below the facts, and at a show
 * that uploaded its own bill that meant a PDF viewer followed by the whole
 * generated bill again under a second heading: the facts card this page exists
 * for became the first screen of three. The bill is `/shows/[id]/showbill`, a
 * tile of its own on the show menu and a link at the foot of this page.
 */

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-3 border-b last:border-b-0"
      style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="text-sm font-medium sm:w-40 shrink-0" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="text-sm" style={{ color: 'var(--foreground)' }}>{children}</div>
    </div>
  );
}

export default async function ShowDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, back] = await Promise.all([fetchShow(id), showHubBack(id)]);

  const clubs: {
    association_id: string;
    code: string;
    name: string;
    fee_amount_cents: number;
    fee_unit: string;
  }[] = show.sanctioning ?? [];

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />

      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Show Details</h2>

      <div className="rounded-lg border px-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
        <Row label="Show name">{show.name}</Row>
        {show.venue && <Row label="Location">📍 {show.venue}</Row>}
        <Row label="Dates">
          {formatDate(show.start_date)}
          {show.end_date !== show.start_date && <> – {formatDate(show.end_date)}</>}
        </Row>
        <Row label="Status">{show.status}</Row>
        {show.show_type_code && (
          <Row label="Show type">
            {show.show_type_name ? `${show.show_type_name} (${show.show_type_code})` : show.show_type_code}
          </Row>
        )}
        {show.affiliations && show.affiliations.length > 0 && (
          <Row label="Approved by">
            <div className="flex flex-wrap gap-1.5">
              {show.affiliations.map((a: { show_type_id: string; show_type_code: string; show_type_name?: string }) => (
                <span key={a.show_type_id}
                  className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}
                  title={a.show_type_name}>
                  {a.show_type_code}
                </span>
              ))}
            </div>
          </Row>
        )}
        {/* Clubs are a separate question from the breed approval above: an
            NSBA- or WSCA-sanctioned show is usually an Open or breed show
            carrying the club overlay, and which of your memberships earn
            points here is exactly what an exhibitor is trying to work out. */}
        {clubs.length > 0 && (
          <Row label="Clubs">
            <ul className="space-y-0.5">
              {clubs.map((club) => (
                <li key={club.association_id}>
                  <span className="font-mono font-semibold text-xs px-1.5 py-0.5 rounded mr-1.5"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}>
                    {club.code}
                  </span>
                  {club.name}
                  {club.fee_amount_cents > 0 && (
                    <span style={{ color: 'var(--muted)' }}>
                      {' '}— {formatMoney(club.fee_amount_cents)}{' '}
                      {unitLabel(club.fee_unit)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Row>
        )}
        <Row label="Shavings">
          {show.shavings_ban_outside
            ? 'Outside shavings are not allowed — bedding must be bought from the show.'
            : 'Outside shavings are allowed. Bags can also be ordered from the show.'}
        </Row>
        {show.apha_show_number && <Row label="APHA show #">{show.apha_show_number}</Row>}
        {show.aqha_show_number && <Row label="AQHA show #">{show.aqha_show_number}</Row>}
      </div>

      <div className="mt-5 flex flex-wrap gap-3 text-sm font-medium">
        <Link href={`/shows/${id}/showbill`} className="hover:underline" style={{ color: 'var(--accent)' }}>
          Show bill — judges, classes and fees →
        </Link>
        <Link href={`/shows/${id}/contact`} className="hover:underline" style={{ color: 'var(--accent)' }}>
          Message the show office →
        </Link>
      </div>
    </main>
  );
}
