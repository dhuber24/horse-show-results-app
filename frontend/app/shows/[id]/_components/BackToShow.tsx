import Link from 'next/link';
import { showHubBack } from './showHubBack';

/**
 * The way back to the show's main page, at the foot of a section.
 *
 * The header carries the same link, but the schedule, the results and the
 * show bill are long pages read on a phone, and somebody who has scrolled to
 * the bottom of one should not have to scroll back up to leave it.
 */
export default function BackToShow({ showId }: { showId: string }) {
  const { backHref, backLabel } = showHubBack(showId);
  return (
    <div className="no-print mt-8 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
      <Link href={backHref} className="text-sm font-medium hover:underline" style={{ color: 'var(--accent)' }}>
        ← {backLabel}
      </Link>
    </div>
  );
}
