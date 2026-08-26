import Link from 'next/link';
import {
  fetchShow,
  fetchClasses,
  fetchShowJudgesPublic,
  fetchShowFeesPublic,
  fetchShowFuturitiesPublic,
} from '@/lib/api';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';
import ShowbillDocument, { type ShowbillClassRow } from '../_components/ShowbillDocument';
import ShowbillActions from './ShowbillActions';

/**
 * The show bill as a document you can take away.
 *
 * The sheet itself is `ShowbillDocument`, shared with Show Details, which now
 * renders it inline — reading the bill is not a separate errand from reading
 * the show. What this route keeps is the part Details cannot do: a masthead, a
 * print stylesheet, and the two buttons that turn the page into a PDF or a
 * spreadsheet. See `ShowbillActions` for why print-to-PDF rather than a
 * server-side renderer.
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

  const [show, allClasses, judges, fees, futurities, back] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    fetchShowJudgesPublic(id),
    fetchShowFeesPublic(id),
    fetchShowFuturitiesPublic(id),
    showHubBack(id),
  ]);

  // DRAFT classes are the secretary's working copy — they are not on offer yet
  // and printing them would advertise a class that may never run.
  const classes: ShowbillClassRow[] = (allClasses as ShowbillClassRow[]).filter(
    (c) => (c as unknown as { status: string }).status !== 'DRAFT',
  );

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print">
        <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />
      </div>

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
    </main>
  );
}
