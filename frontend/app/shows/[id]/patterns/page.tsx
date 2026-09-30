import { auth } from '@/auth';
import { canActAsExhibitor } from '@/lib/exhibitor-access';
import { fetchShow, fetchShowPatterns } from '@/lib/api';
import { fetchRegisteredClassIds } from '@/lib/my-class-ids';
import LocalTime from '@/components/LocalTime';
import {
  patternFileHref,
  patternsForClasses,
  wasReplaced,
  type ShowPattern,
} from '@/lib/patterns';
import ShowHubHeader from '../_components/ShowHubHeader';
import { showHubBack } from '../_components/showHubBack';

/**
 * Every pattern the office has put on file, and the classes each one runs
 * (migration 146).
 *
 * Public, like the schedule: it is read at the rail on a phone, usually by
 * somebody who never signed in. A signed-in exhibitor gets the patterns for
 * their own classes first, because "which pattern do I ride" is the question —
 * the whole list is the answer to a different one.
 *
 * Each card names the pattern, the classes it is used in, and links to view or
 * download it. Viewing opens the browser's own viewer, which zooms a PDF or a
 * photo far better than anything drawn here.
 */

/** The two section headings — the exhibitor's own classes, then the whole show.
 *  Sized to read as headings rather than small print, because the same pattern
 *  appears under both and which list you are in is the whole distinction. */
const SECTION_HEADING = 'text-lg font-semibold pb-1.5 mb-3 border-b';
const SECTION_HEADING_STYLE = { color: 'var(--accent)', borderColor: 'var(--border)' } as const;

export default async function ShowPatternsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const isExhibitor = session ? await canActAsExhibitor() : false;

  const [show, patterns, myClassIds, back] = await Promise.all([
    fetchShow(id),
    fetchShowPatterns(id),
    isExhibitor
      ? fetchRegisteredClassIds(id, (session!.user as { id: string }).id)
      : Promise.resolve([] as string[]),
    showHubBack(id),
  ]);
  const mine = patternsForClasses(patterns, myClassIds);

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <ShowHubHeader show={show} backHref={back.backHref} backLabel={back.backLabel} />

      <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Patterns</h2>
      <p className="text-sm mt-1 mb-4" style={{ color: 'var(--muted)' }}>
        The pattern posted at the in-gate is the official one. A pattern the judge changes is
        replaced here and marked with the time.
      </p>

      {patterns.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No patterns have been posted for this show yet.</p>
      ) : (
        <div className="space-y-6">
          {mine.length > 0 && (
            <section>
              <h3 className={SECTION_HEADING} style={SECTION_HEADING_STYLE}>
                Patterns for your registered classes
              </h3>
              <PatternList showId={id} patterns={mine} />
            </section>
          )}
          <section>
            {mine.length > 0 && (
              <h3 className={SECTION_HEADING} style={SECTION_HEADING_STYLE}>
                All show patterns
              </h3>
            )}
            <PatternList showId={id} patterns={patterns} />
          </section>
        </div>
      )}
    </main>
  );
}

function PatternList({ showId, patterns }: { showId: string; patterns: ShowPattern[] }) {
  return (
    <ul className="space-y-2">
      {patterns.map((pattern) => {
        const changed = wasReplaced(pattern);
        const version = pattern.file_uploaded_at;
        return (
          <li
            key={pattern.id}
            className="relative p-4 rounded-lg border transition hover:shadow-md"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              {/* The whole card opens the pattern, not just its name: on a phone
                  the biggest target should be the one that does the thing
                  people came for. The name's link is stretched over the card
                  (`after:inset-0`) rather than the card being wrapped in one,
                  because View and Download are links too, and a link inside a
                  link is not valid HTML — they sit above the stretch (`z-10`)
                  and keep working on their own. */}
              <a
                href={patternFileHref(showId, pattern.id, { version })}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:underline after:absolute after:inset-0 after:rounded-lg"
                style={{ color: 'var(--foreground)' }}
              >
                {pattern.name}
              </a>
              <span className="relative z-10 flex gap-3 shrink-0 text-sm">
                <a
                  href={patternFileHref(showId, pattern.id, { version })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  View ↗
                </a>
                <a
                  href={patternFileHref(showId, pattern.id, { version, download: true })}
                  className="hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Download
                </a>
              </span>
            </div>

            {pattern.classes.length > 0 ? (
              // Folded by default, so a card is its name and its two links: a
              // pattern run across a dozen classes was a dozen chips, and the
              // second pattern sat a screen down a phone. <details> rather than
              // a client component, like the finished classes on the show page —
              // it needs no JS. The summary sits above the card's stretched link
              // (`relative z-10`) so tapping it unfolds the list instead of
              // opening the pattern, and is only as wide as its text so the rest
              // of that row still opens it; the list itself stays under the
              // stretch, so tapping a class opens the pattern like the card does.
              <details className="group mt-1">
                <summary
                  className="relative z-10 w-fit cursor-pointer select-none list-none py-1 text-xs font-medium [&::-webkit-details-marker]:hidden"
                  style={{ color: 'var(--muted)' }}
                >
                  <span aria-hidden="true" className="inline-block w-3 group-open:hidden">▸</span>
                  <span aria-hidden="true" className="hidden w-3 group-open:inline-block">▾</span>
                  Used in {pattern.classes.length} {pattern.classes.length === 1 ? 'class' : 'classes'}
                </summary>
                <ul className="flex flex-wrap gap-1.5 mt-1.5">
                  {pattern.classes.map((cls) => (
                    <li
                      key={cls.id}
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-deep)' }}
                    >
                      <span className="font-semibold">{cls.class_number}</span> {cls.class_name}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                Not attached to a class
              </p>
            )}

            {pattern.notes && (
              <p className="text-sm mt-2 whitespace-pre-line" style={{ color: 'var(--text-deep)' }}>
                {pattern.notes}
              </p>
            )}
            {changed && (
              <p className="text-xs mt-2 font-medium" style={{ color: 'var(--warning)' }}>
                Changed <LocalTime iso={pattern.file_uploaded_at} />
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
