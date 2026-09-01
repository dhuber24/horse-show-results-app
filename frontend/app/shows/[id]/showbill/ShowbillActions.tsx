'use client';

import type { ShowbillClassRow } from '../_components/ShowbillDocument';
import ClassListCsvButton from '../_components/ClassListCsvButton';

/**
 * The two ways to take the generated show bill away with you.
 *
 * **Print / Save as PDF** is the document. Every browser's print dialog has a
 * "Save as PDF" destination, so this produces the real thing — a paginated
 * page with the show's masthead on it — without the app carrying a PDF
 * renderer it would then have to keep looking like the web version. The page
 * has a print stylesheet for exactly this.
 *
 * **Download class list (CSV)** lives in its own component because it belongs
 * to the uploaded show bill too — see `ClassListCsvButton`.
 */
export default function ShowbillActions({
  showName,
  classes,
}: {
  showName: string;
  classes: ShowbillClassRow[];
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-5 no-print">
      <button
        type="button"
        onClick={() => window.print()}
        className="text-sm font-medium px-4 py-2 rounded"
        style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
      >
        ⬇ Download / print show bill
      </button>
      <ClassListCsvButton showName={showName} classes={classes} />
    </div>
  );
}
