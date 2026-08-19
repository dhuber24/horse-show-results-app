import Link from 'next/link';
import { auth } from '@/auth';
import { fetchShow } from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';

/**
 * The show, described.
 *
 * Two audiences share this page. A spectator arrives from the at-the-rail hub
 * wanting to know where they are and who is running it; an exhibitor arrives
 * from their own show menu wanting the same facts *plus* the two things that
 * are about them — what they entered and what it costs. The second set is
 * added rather than the page being forked, because everything above the
 * buttons is identical and a second copy would drift.
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
      style={{ borderColor: '#e8d5b7' }}>
      <div className="text-sm font-medium sm:w-40 shrink-0" style={{ color: '#8b7355' }}>{label}</div>
      <div className="text-sm" style={{ color: '#2c1810' }}>{children}</div>
    </div>
  );
}

export default async function ShowDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [show, back, session] = await Promise.all([fetchShow(id), showHubBack(id), auth()]);
  const isExhibitor = (session?.user as { role?: string } | undefined)?.role === 'EXHIBITOR';

  const clubs: { association_id: string; code: string; name: string; per_class_fee_cents: number }[] =
    show.sanctioning ?? [];

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Show Details</h2>

      <div className="rounded-lg border px-4" style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}>
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
                  style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
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
                    style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}>
                    {club.code}
                  </span>
                  {club.name}
                  {club.per_class_fee_cents > 0 && (
                    <span style={{ color: '#8b7355' }}>
                      {' '}— {formatMoney(club.per_class_fee_cents)} per class
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

      {isExhibitor && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href={`/shows/${id}/register`}
            className="rounded-lg border p-4 transition hover:bg-amber-50"
            style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
          >
            <div className="font-semibold" style={{ color: '#2c1810' }}>My registration</div>
            <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
              The classes and horses you entered.
            </div>
          </Link>
          <Link
            href={`/shows/${id}/my-bill`}
            className="rounded-lg border p-4 transition hover:bg-amber-50"
            style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
          >
            <div className="font-semibold" style={{ color: '#2c1810' }}>What I owe</div>
            <div className="text-xs mt-0.5" style={{ color: '#8b7355' }}>
              Class fees, stalls, shavings and the office charge, itemised.
            </div>
          </Link>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3 text-sm font-medium">
        <Link href={`/shows/${id}/showbill`} className="hover:underline" style={{ color: '#8b4513' }}>
          Show bill →
        </Link>
        <Link href={`/shows/${id}/contact`} className="hover:underline" style={{ color: '#8b4513' }}>
          Message the show office →
        </Link>
      </div>
    </main>
  );
}
