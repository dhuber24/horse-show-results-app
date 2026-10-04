import Link from 'next/link';
import { Fragment } from 'react';
import { fetchClasses } from '@/lib/api';
import { auth } from '@/auth';
import ShowHub from './_components/ShowHub';
import { loadShowHub } from './_components/loadShowHub';
import AutoRefresh from '@/components/AutoRefresh';

function formatClassDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const role = (session?.user as any)?.role;
  const canScore = (role === 'ADMIN' || role === 'SCRIBE');

  // Together, so a scribe working a running show waits on one round trip
  // rather than two. The class list is wasted only on staff opening a show
  // that is not running.
  const [hub, classes] = await Promise.all([
    loadShowHub(id),
    canScore ? fetchClasses(id) : Promise.resolve(null),
  ]);

  // Everybody gets the show menu — the public results hub, the same page
  // `/live` serves, with an exhibitor's own standing and tiles on top — except
  // a scribe or an admin while the show runs. Then the class numbers *are* the
  // menu: every row is a link into a scribe screen. Before the show and after
  // it no row can be scored, and the list was forty rows of something to read
  // under a "Read-only" banner, where everybody else got the menu.
  if (!classes || hub.show.status !== 'ACTIVE') {
    return <ShowHub {...hub} />;
  }
  const show = hub.show;

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>← Back to Shows</Link>
      <div className="mt-4 mb-6 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>{show.name}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          📍 {show.venue} &nbsp;·&nbsp; 📅 {show.start_date} – {show.end_date}
        </p>
        {show.affiliations?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {show.affiliations.map((a: any) => (
              <span
                key={a.show_type_id}
                className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}
                title={a.show_type_name}
              >
                {a.show_type_code}
              </span>
            ))}
            <span className="text-xs self-center" style={{ color: 'var(--muted)' }}>points eligible in select classes</span>
          </div>
        )}
      </div>

      {/* The exhibitor status banner used to sit here. It has moved to
          ShowHub, which is where an exhibitor now lands — reaching this
          branch means the caller is scoring a running show. The "Read-only"
          banner went too: before the show and after it, a scorer gets the
          show menu instead of this list. */}

      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--foreground)' }}>Classes</h2>
      {classes.length === 0 ? (
        <p style={{ color: 'var(--muted)' }}>No classes found.</p>
      ) : (() => {
        // Scribes working an active show care about what is left to score, so
        // finished classes fold away — but they are not hidden. A scribe
        // correcting a posted placing has to be able to reach a CLOSED class,
        // and a list that silently starts at 14 reads like broken numbering.
        // Classes close underneath the scribe as the show runs — the gate
        // steward closes one, and it should roll into the finished group
        // without anyone reloading, so the list polls. It only exists while
        // the show runs, so nothing here polls a show where nothing moves.
        const finished = classes.filter((cls: any) => cls.status === 'CLOSED');
        const remaining = classes.filter((cls: any) => cls.status !== 'CLOSED');

        const renderList = (list: any[]) => (
          <ul className="space-y-3">
            {list.map((cls: any, index: number) => (
              <Fragment key={cls.id}>
                {(index === 0 || list[index - 1].class_date !== cls.class_date) && (
                  <li className={`${index > 0 ? 'pt-4' : ''} pb-1`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ color: 'var(--accent)', backgroundColor: 'var(--bg-subtle)' }}>
                        {formatClassDate(cls.class_date)}
                      </span>
                      <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
                    </div>
                  </li>
                )}
                <li>
                  <Link
                    href={`/shows/${id}/classes/${cls.id}/scribe`}
                    className="flex-1 block p-4 rounded-lg border transition hover:bg-amber-50"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold" style={{ color: 'var(--foreground)' }}>
                          {cls.class_number} — {cls.class_name}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        {cls.placed_count > 0 ? (
                          <span
                            className="text-xs font-medium px-2 py-1 rounded-full"
                            style={{ backgroundColor: 'var(--success-border)', color: 'var(--success-strong)' }}
                          >
                            {cls.placed_count} placed
                          </span>
                        ) : (
                          <span
                            className="text-xs font-medium px-2 py-1 rounded-full"
                            style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning)' }}
                          >
                            Pending
                          </span>
                        )}
                        <span
                          className="text-xs font-medium px-2 py-1 rounded-full"
                          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--accent)' }}
                        >
                          {cls.status}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              </Fragment>
            ))}
          </ul>
        );

        return (
          <>
            <AutoRefresh />
            {finished.length > 0 && (
              // <details> rather than a client component: this page is server
              // rendered and the toggle needs no JS to work.
              <details className="mb-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}>
                <summary
                  className="cursor-pointer select-none px-4 py-3 text-sm font-medium"
                  style={{ color: 'var(--accent)' }}
                >
                  {finished.length} finished {finished.length === 1 ? 'class' : 'classes'} — show
                </summary>
                <div className="px-4 pb-4 pt-1">{renderList(finished)}</div>
              </details>
            )}
            {remaining.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>
                {finished.length > 0
                  ? 'Every class has been run.'
                  : 'No classes found.'}
              </p>
            ) : (
              renderList(remaining)
            )}
          </>
        );
      })()}
    </main>
  );
}
