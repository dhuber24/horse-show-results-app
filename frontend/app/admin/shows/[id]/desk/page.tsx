import Link from 'next/link';
import {
  fetchShow,
  fetchAssociations,
  fetchBreeds,
  fetchHorseColors,
  fetchHorsePatterns,
} from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import DeskClient from './DeskClient';

/**
 * The registration desk — entries, back numbers, and paperwork in one screen,
 * worked one exhibitor at a time.
 *
 * Side pots were a section here and are not any more. Entering a class an open
 * pot bundles is what buys somebody in (`backend/side_pot_membership.py`), so
 * the panel's per-pot toggle was a second way to do a thing the entry form
 * already does as part of the entry — and the more misleading of the two, since
 * it could put somebody in a pot whose classes they had not entered. What is
 * left is the count on the summary row. Adding or removing a buy-in outright
 * lives on the pot's own Entries screen, where the pot is the subject.
 *
 * These were three separate pages (`/entries`, `/back-numbers`, `/check-in`),
 * which meant finding the same person three times to do one person's worth of
 * work, and no page could tell you what was still outstanding on the other two.
 * Those routes now redirect here.
 *
 * The shell is thin on purpose: the desk's own data is one client fetch of
 * `/shows/{id}/desk`, so a save re-reads that payload rather than re-rendering
 * the page. The lookups below are the ones behind the add-a-horse form and
 * change once a year; they fail open to empty lists because a missing colour
 * list must not take the desk down at eight in the morning.
 */
export default async function ShowDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?exhibitor=<id>` opens that person's panel on arrival. This is the return
   *  half of the link Financials carries back here, so staff can go between an
   *  exhibitor's registration and their account without searching the roster
   *  again at each hop. Read on the server and passed down rather than through
   *  `useSearchParams`, which would need a Suspense boundary for no gain. */
  searchParams: Promise<{ exhibitor?: string }>;
}) {
  const { id } = await params;
  const { exhibitor } = await searchParams;
  const headers = await getAuthHeaders();

  const [show, associations, breeds, colors, patterns] = await Promise.all([
    fetchShow(id),
    fetchAssociations(headers || undefined).catch(() => []),
    fetchBreeds().catch(() => []),
    fetchHorseColors().catch(() => []),
    // The coat's second axis (migration 116). A Paint is "Bay Tobiano", and a
    // form offering only the colour makes staff drop the half that identifies
    // the horse across a warm-up pen.
    fetchHorsePatterns().catch(() => []),
  ]);

  return (
    <main className="max-w-6xl mx-auto p-4 md:p-6 space-y-5">
      <div>
        <Breadcrumbs
          crumbs={[
            { label: 'Admin', href: '/admin' },
            { label: 'Shows', href: '/admin/shows' },
            { label: show.name, href: `/admin/shows/${id}` },
            { label: 'Registration Desk' },
          ]}
        />
        <div className="flex items-start justify-between gap-3 flex-wrap mt-2">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
              Registration Desk
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              {show.name} — back numbers, class entries, and paperwork check-in.
            </p>
          </div>
          {/* What the desk checks against. Kept off the working screen itself —
              it is answered once a season and read all week — but reached from
              it, because the person who needs to change it is the one looking at
              a checklist that is asking for the wrong document. */}
          <Link
            href={`/admin/shows/${id}/desk/paperwork`}
            className="text-sm rounded px-3 py-2 border shrink-0 hover:bg-amber-50 transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--accent)', backgroundColor: 'var(--surface)' }}
          >
            Paperwork requirements
          </Link>
        </div>
      </div>

      <DeskClient
        showId={id}
        associations={associations}
        breeds={breeds}
        colors={colors}
        patterns={patterns}
        initialExhibitorId={exhibitor ?? null}
      />
    </main>
  );
}
