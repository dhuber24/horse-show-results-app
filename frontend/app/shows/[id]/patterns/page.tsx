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
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--accent)' }}>
                For your classes
              </h3>
              <PatternList showId={id} patterns={mine} />
            </section>
          )}
          <section>
            {mine.length > 0 && (
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--accent)' }}>
                All patterns
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
            className="p-4 rounded-lg border"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              {/* The name opens it too: on a phone the biggest target on the
                  card should be the one that does the thing people came for. */}
              <a
                href={patternFileHref(showId, pattern.id, { version })}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:underline"
                style={{ color: 'var(--foreground)' }}
              >
                {pattern.name}
              </a>
              <span className="flex gap-3 shrink-0 text-sm">
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
              <div className="mt-2">
                <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  Used in {pattern.classes.length} {pattern.classes.length === 1 ? 'class' : 'classes'}
                </p>
                <ul className="flex flex-wrap gap-1.5 mt-1">
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
              </div>
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
