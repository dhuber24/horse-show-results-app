import Link from 'next/link';

/**
 * The show's own show bill, when the show chose to supply one (migration 127).
 *
 * `ShowbillDocument` is the app's version — generated from the classes, judges
 * and fees on file, and still the default. This renders the alternative: a file
 * the show uploaded, shown as it was given to us.
 *
 * Three things it does on purpose, all for the same reason — an uploaded bill is
 * a snapshot and the app cannot tell when it stopped being true:
 *
 *   * It **stamps the upload date**. There is no staleness check to make here:
 *     that would need `updated_at` on classes, fees and judges, and none of them
 *     carries one. Printing the date is the honest substitute — a reader can see
 *     for themselves that the bill predates the schedule.
 *   * It **always links out to the live schedule and fee list**, which are what
 *     the app actually charges from. A show gets to choose what this button
 *     shows; it does not get to make the live data unreachable.
 *   * It **offers the file for download**, because a browser that will not draw
 *     a PDF inline is common on a phone at a horse show, and an empty grey box
 *     with no way out is worse than no viewer at all.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploaded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export type ShowbillDoc = {
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

export default function UploadedShowbill({
  showId,
  showName,
  document: doc,
  embedded = false,
  actions,
}: {
  showId: string;
  showName: string;
  document: ShowbillDoc;
  /** Drops the outward links — the caller already carries them. Show Details
   *  renders this above its own copy of the generated bill, so repeating
   *  "see the class schedule" there would point at the page it is already on. */
  embedded?: boolean;
  /** Anything else that belongs in the button row. The show bill page puts the
   *  class-list CSV here: the export is about the schedule in this app, not
   *  about which bill the show publishes, so it must not disappear because the
   *  show supplied its own PDF. */
  actions?: React.ReactNode;
}) {
  const fileHref = `/api/shows/${showId}/showbill-document/file`;
  const isImage = doc.mime_type.startsWith('image/');
  const uploaded = formatUploaded(doc.created_at);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 no-print">
        <a
          href={`${fileHref}?download=1`}
          className="text-sm font-medium px-4 py-2 rounded"
          style={{ backgroundColor: '#8b4513', color: '#ffffff' }}
        >
          ⬇ Download show bill
        </a>
        <a
          href={fileHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium px-4 py-2 rounded border"
          style={{ borderColor: '#d4b896', color: '#5c3d1e', backgroundColor: '#ffffff' }}
        >
          Open in a new tab
        </a>
        {actions}
      </div>

      <p className="text-xs mb-3" style={{ color: '#8b7355' }}>
        {showName}&rsquo;s own show bill
        {uploaded ? `, uploaded ${uploaded}` : ''} — {doc.original_filename} (
        {formatBytes(doc.file_size)}). Classes, fees and judges may have changed
        since; the schedule and fee list in this app are the current ones.
      </p>

      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: '#d4b896', backgroundColor: '#ffffff' }}
      >
        {isImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={fileHref}
            alt={`Show bill for ${showName}`}
            className="w-full h-auto block"
          />
        ) : (
          <iframe
            src={fileHref}
            title={`Show bill for ${showName}`}
            className="w-full block"
            style={{ height: '80vh', border: 'none' }}
          />
        )}
      </div>

      {!embedded && (
        <div className="no-print mt-5 flex flex-wrap gap-3 text-sm font-medium">
          <Link
            href={`/shows/${showId}/schedule`}
            className="hover:underline"
            style={{ color: '#8b4513' }}
          >
            Class schedule as entered →
          </Link>
          <Link
            href={`/shows/${showId}/details`}
            className="hover:underline"
            style={{ color: '#8b4513' }}
          >
            Show details and fee schedule →
          </Link>
          <Link
            href={`/shows/${showId}/contact`}
            className="hover:underline"
            style={{ color: '#8b4513' }}
          >
            Message the show office →
          </Link>
        </div>
      )}
    </div>
  );
}
