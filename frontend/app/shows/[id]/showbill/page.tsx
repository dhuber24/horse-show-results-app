import Link from 'next/link';
import {
  fetchShow,
  fetchClasses,
  fetchShowJudgesPublic,
  fetchShowFeesPublic,
  fetchShowFuturitiesPublic,
  fetchShowbill,
} from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';
import ShowbillDocument, { type ShowbillClassRow } from '../_components/ShowbillDocument';
import UploadedShowbill from '../_components/UploadedShowbill';
import ClassListCsvButton from '../_components/ClassListCsvButton';
import ShowbillActions from './ShowbillActions';

/**
 * The show bill as a document you can take away.
 *
 * Two shapes, one destination. Most shows use the bill the app generates: the
 * sheet is `ShowbillDocument`, shared with Show Details, and what this route
 * adds is the part Details cannot do — a masthead, a print stylesheet, and the
 * buttons that turn the page into a PDF or a spreadsheet. See `ShowbillActions`
 * for why print-to-PDF rather than a server-side renderer.
 *
 * A show that uploaded its own bill (Setup step 8, migration 127) gets that
 * instead, through `UploadedShowbill`. The branch is on `effective_source`, not
 * on the show's stored choice: a show pointed at a file that is not on record
 * falls back to the generated bill rather than rendering an empty frame.
 */

/** Print rules. Kept on the page rather than in globals.css because they only
 *  make sense for a document — every other screen wants the chrome. */
const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  main { max-width: none !important; padding: 0 !important; }
  .showbill-section { break-inside: avoid; }
  .showbill-day { break-inside: avoid; }
  a[href]::after { content: ""; }
  body { background: #ffffff !important; }
}
`;

export default async function ShowbillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [show, allClasses, judges, fees, futurities, back, showbill] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchShowJudgesPublic(id),
    fetchShowFeesPublic(id),
    fetchShowFuturitiesPublic(id),
    showHubBack(id),
    fetchShowbill(id),
  ]);

  // DRAFT classes are the secretary's working copy — they are not on offer yet
  // and printing them would advertise a class that may never run.
  const classes: ShowbillClassRow[] = (allClasses as ShowbillClassRow[]).filter(
    (c) => (c as unknown as { status: string }).status !== 'DRAFT',
  );

  const uploaded = showbill.effective_source === 'uploaded' && showbill.document;

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print">
        <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />
      </div>

      {uploaded && showbill.document ? (
        <UploadedShowbill
          showId={id}
          showName={show.name}
          document={showbill.document}
          // The class list is about the schedule in this app, not about which
          // bill the show publishes — it stays on offer either way.
          actions={<ClassListCsvButton showName={show.name} classes={classes} />}
        />
      ) : (
        <>
          <ShowbillActions showName={show.name} classes={classes} />

          <ShowbillDocument
            show={show}
            classes={classes}
            judges={judges}
            fees={fees}
            futurities={futurities}
          />

          <div className="no-print mt-5 flex flex-wrap gap-3 text-sm font-medium">
            <Link href={`/shows/${id}/details`} className="hover:underline" style={{ color: '#8b4513' }}>
              Show details →
            </Link>
            <Link href={`/shows/${id}/schedule`} className="hover:underline" style={{ color: '#8b4513' }}>
              Class schedule →
            </Link>
            <Link href={`/shows/${id}/contact`} className="hover:underline" style={{ color: '#8b4513' }}>
              Message the show office →
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
