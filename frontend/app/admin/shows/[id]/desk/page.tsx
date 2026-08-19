import Link from 'next/link';
import { fetchShow, fetchAssociations, fetchBreeds, fetchHorseColors } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import Breadcrumbs from '@/components/Breadcrumbs';
import DeskClient from './DeskClient';

/**
 * The registration desk — entries, back numbers, side pots, and paperwork in
 * one screen, worked one exhibitor at a time.
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
export default async function ShowDeskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = await getAuthHeaders();

  const [show, associations, breeds, colors] = await Promise.all([
    fetchShow(id),
    fetchAssociations(headers || undefined).catch(() => []),
    fetchBreeds().catch(() => []),
    fetchHorseColors().catch(() => []),
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
            <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>
              Registration Desk
            </h1>
            <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
              {show.name} — back numbers, class entries, side pots, and paperwork check-in.
            </p>
          </div>
          {/* What the desk checks against. Kept off the working screen itself —
              it is answered once a season and read all week — but reached from
              it, because the person who needs to change it is the one looking at
              a checklist that is asking for the wrong document. */}
          <Link
            href={`/admin/shows/${id}/desk/paperwork`}
            className="text-sm rounded px-3 py-2 border shrink-0 hover:bg-amber-50 transition-colors"
            style={{ borderColor: '#d4b896', color: '#8b4513', backgroundColor: '#ffffff' }}
          >
            Paperwork requirements
          </Link>
        </div>
      </div>

      <DeskClient showId={id} associations={associations} breeds={breeds} colors={colors} />
    </main>
  );
}
