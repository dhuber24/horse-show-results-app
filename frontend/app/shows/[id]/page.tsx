import Link from 'next/link';
import { Fragment } from 'react';
import { fetchShow, fetchClasses, fetchMyShowStanding } from '@/lib/api';
import { getAuthHeaders } from '@/lib/backend-fetch';
import { auth } from '@/auth';
import type { MyShowStanding } from '@/lib/my-shows';
import ExhibitorShowHub from './_components/ExhibitorShowHub';
import VisitorShowView from './_components/VisitorShowView';
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
  const canSelfRegister = role === 'EXHIBITOR';

  // A visitor with no account gets the event details and the two things they
  // can act on, not a class list. The classes fetch is skipped entirely for
  // them — nothing on their screen reads it. The rail screens (/live,
  // /schedule, /results) stay open to everyone; this gates the browsing path.
  if (!session) {
    const show = await fetchShow(id);
    return <VisitorShowView showId={id} show={show} />;
  }

  const headers = canSelfRegister ? await getAuthHeaders() : null;
  const [show, classes, standing] = await Promise.all([
    fetchShow(id),
    fetchClasses(id),
    // Only exhibitors have a standing to report, and only they see the banner
    // it feeds — nobody else pays for the round trip.
    canSelfRegister
      ? (fetchMyShowStanding(id, headers || undefined) as Promise<MyShowStanding | null>)
      : Promise.resolve(null),
  ]);

  // Anyone who isn't entering scores gets a menu, not a class list. For a
  // scribe or an admin on an active show the class numbers *are* the menu —
  // every row is a link into a scribe screen — so they keep the list below.
  // Everybody else was landing on forty rows of something to read rather than
  // the four things they came to do.
  if (!canScore) {
    return (
      <ExhibitorShowHub
        showId={id}
        show={show}
        standing={standing}
        classCount={classes.filter((cls: any) => cls.status !== 'DRAFT').length}
        canSelfRegister={canSelfRegister}
      />
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-4 md:p-6">
      <Link href="/" className="text-sm hover:underline" style={{ color: '#8b4513' }}>← Back to Shows</Link>
      <div className="mt-4 mb-6 pb-4 border-b" style={{ borderColor: '#d4b896' }}>
        <h1 className="text-2xl font-bold" style={{ color: '#2c1810' }}>{show.name}</h1>
        <p className="text-sm mt-1" style={{ color: '#8b7355' }}>
          📍 {show.venue} &nbsp;·&nbsp; 📅 {show.start_date} – {show.end_date}
        </p>
        {show.affiliations?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {show.affiliations.map((a: any) => (
              <span
                key={a.show_type_id}
                className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                style={{ backgroundColor: '#f0e8d8', color: '#8b4513' }}
                title={a.show_type_name}
              >
                {a.show_type_code}
              </span>
            ))}
            <span className="text-xs self-center" style={{ color: '#8b7355' }}>points eligible in select classes</span>
          </div>
        )}
      </div>

      {/* The exhibitor status banner used to sit here. It has moved to
          ExhibitorShowHub, which is where an exhibitor now lands — reaching
          this branch means the caller can score, and no account is both a
          scribe and a self-registering exhibitor. */}

      {/* Only for people who could otherwise be entering scores. An exhibitor or
          spectator reading the class schedule has no scoring screen to be locked
          out of, so the banner told them nothing and read like a warning. */}
      {canScore && show.status !== 'ACTIVE' && (
        <div
          className="mb-4 px-4 py-3 rounded border text-sm font-medium"
          style={{ backgroundColor: '#fef3c7', borderColor: '#d4b896', color: '#92400e' }}
        >
          Read-only — results can only be entered when the show is Active.
          Current status: <strong>{show.status}</strong>.
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3" style={{ color: '#2c1810' }}>Classes</h2>
      {classes.length === 0 ? (
        <p style={{ color: '#8b7355' }}>No classes found.</p>
      ) : (() => {
        // Scribes working an active show care about what is left to score, so
        // finished classes fold away — but they are not hidden. A scribe
        // correcting a posted placing has to be able to reach a CLOSED class,
        // and a list that silently starts at 14 reads like broken numbering.
        // Classes close underneath the scribe as the show runs — the gate
        // steward closes one, and it should roll into the finished group
        // without anyone reloading. Only polls in this case: on a finished or
        // unstarted show nothing moves, so refreshing would be pure waste.
        const foldFinished = canScore && show.status === 'ACTIVE';
        const finished = foldFinished
          ? classes.filter((cls: any) => cls.status === 'CLOSED')
          : [];
        const remaining = foldFinished
          ? classes.filter((cls: any) => cls.status !== 'CLOSED')
          : classes;

        const renderList = (list: any[]) => (
          <ul className="space-y-3">
            {list.map((cls: any, index: number) => (
              <Fragment key={cls.id}>
                {(index === 0 || list[index - 1].class_date !== cls.class_date) && (
                  <li className={`${index > 0 ? 'pt-4' : ''} pb-1`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px" style={{ backgroundColor: '#e8d5b7' }} />
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ color: '#8b4513', backgroundColor: '#f0e8d8' }}>
                        {formatClassDate(cls.class_date)}
                      </span>
                      <div className="flex-1 h-px" style={{ backgroundColor: '#e8d5b7' }} />
                    </div>
                  </li>
                )}
                <li>
                  <Link
                    href={
                      canScore && show.status === 'ACTIVE'
                        ? `/shows/${id}/classes/${cls.id}/scribe`
                        : `/shows/${id}/classes/${cls.id}`
                    }
                    className="flex-1 block p-4 rounded-lg border transition hover:bg-amber-50"
                    style={{ backgroundColor: '#ffffff', borderColor: '#d4b896' }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold" style={{ color: '#2c1810' }}>
                          {cls.class_number} — {cls.class_name}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        {canScore && (
                          cls.placed_count > 0 ? (
                            <span
                              className="text-xs font-medium px-2 py-1 rounded-full"
                              style={{ backgroundColor: '#d1fae5', color: '#065f46' }}
                            >
                              {cls.placed_count} placed
                            </span>
                          ) : (
                            <span
                              className="text-xs font-medium px-2 py-1 rounded-full"
                              style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
                            >
                              Pending
                            </span>
                          )
                        )}
                        <span
                          className="text-xs font-medium px-2 py-1 rounded-full"
                          style={{ backgroundColor: '#f5ede0', color: '#8b4513' }}
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
            {foldFinished && <AutoRefresh />}
            {finished.length > 0 && (
              // <details> rather than a client component: this page is server
              // rendered and the toggle needs no JS to work.
              <details className="mb-4 rounded-lg border" style={{ borderColor: '#d4b896', backgroundColor: '#faf7f2' }}>
                <summary
                  className="cursor-pointer select-none px-4 py-3 text-sm font-medium"
                  style={{ color: '#8b4513' }}
                >
                  {finished.length} finished {finished.length === 1 ? 'class' : 'classes'} — show
                </summary>
                <div className="px-4 pb-4 pt-1">{renderList(finished)}</div>
              </details>
            )}
            {remaining.length === 0 ? (
              <p style={{ color: '#8b7355' }}>
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
