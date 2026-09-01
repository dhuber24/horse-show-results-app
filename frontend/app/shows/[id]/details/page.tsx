import Link from 'next/link';
import {
  fetchShow,
  fetchClasses,
  fetchShowJudgesPublic,
  fetchShowFeesPublic,
  fetchShowbill,
} from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';
import ShowbillDocument, { type ShowbillClassRow } from '../_components/ShowbillDocument';
import UploadedShowbill from '../_components/UploadedShowbill';

/**
 * The show, described.
 *
 * One page, one audience, nothing personal on it. A spectator arriving from the
 * at-the-rail hub and an exhibitor arriving from their show menu are asking the
 * same question here — what is this show, who is judging it, what runs when,
 * what does it cost to enter — and none of that depends on who is reading.
 *
 * It briefly carried the reader's own balance and a button to their entries.
 * Both belong with the reader, not with the show: *What I Owe* is a tile on the
 * show menu, and everything about a registration is on the registration screen,
 * which is now one screen rather than two.
 *
 * The **show bill** — judges, the class schedule, the fee schedule and the
 * rules — renders below the facts. It had its own tile on the show menu and a
 * page that opened by restating these same facts, which made "what is this
 * show" and "what is in it" two errands instead of one. `/shows/[id]/showbill`
 * survives as the printable copy, reached from the link at the foot of this
 * page and from the at-the-rail hub; it draws the same `ShowbillDocument`.
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
  const [show, back, allClasses, judges, fees, showbill] = await Promise.all([
    fetchShow(id),
    showHubBack(id),
    fetchClasses(id),
    fetchShowJudgesPublic(id),
    fetchShowFeesPublic(id),
    fetchShowbill(id),
  ]);

  const clubs: { association_id: string; code: string; name: string; per_class_fee_cents: number }[] =
    show.sanctioning ?? [];

  // DRAFT classes are the secretary's working copy — not on offer yet, and
  // publishing one here would advertise a class that may never run.
  const classes: ShowbillClassRow[] = (allClasses as ShowbillClassRow[]).filter(
    (c) => (c as unknown as { status: string }).status !== 'DRAFT',
  );

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

      <h2 className="text-lg font-semibold mt-6 mb-3" style={{ color: '#2c1810' }}>Show Bill</h2>
      {showbill.effective_source === 'uploaded' && showbill.document && (
        <div className="mb-6">
          <UploadedShowbill
            showId={id}
            showName={show.name}
            document={showbill.document}
            embedded
          />
        </div>
      )}

      {/* The generated document stays on this page whichever bill the show
          chose. It is drawn from the classes, judges and fees actually on file
          — the same fee list `GET /shows/{id}/fees/public` charges from — so
          hiding it behind an uploaded PDF would leave an exhibitor no way to
          check what they will really be billed. A second heading rather than a
          silent replacement: the two can disagree, and the reader has to be
          able to see which is which. */}
      {showbill.effective_source === 'uploaded' && showbill.document && (
        <h3 className="text-base font-semibold mb-2" style={{ color: '#2c1810' }}>
          Classes, judges and fees as entered in this app
        </h3>
      )}
      <ShowbillDocument show={show} classes={classes} judges={judges} fees={fees} embedded />

      <div className="mt-5 flex flex-wrap gap-3 text-sm font-medium">
        {/* The show's chosen bill with a masthead and a print stylesheet on it.
            Worth its own route even though the content is above: a program
            people carry round the grounds on paper is the point of it. */}
        <Link href={`/shows/${id}/showbill`} className="hover:underline" style={{ color: '#8b4513' }}>
          Print or save the show bill →
        </Link>
        <Link href={`/shows/${id}/contact`} className="hover:underline" style={{ color: '#8b4513' }}>
          Message the show office →
        </Link>
      </div>
    </main>
  );
}
